-- ZEN_OS schema update. Safe to run more than once (idempotent).
-- Run this in the Supabase SQL editor AFTER supabase-schema.sql.

-- 1. Dante chat memory ---------------------------------------------------
CREATE TABLE IF NOT EXISTS dante_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
ALTER TABLE dante_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own dante_messages" ON dante_messages;
CREATE POLICY "Users see own dante_messages" ON dante_messages
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS dante_messages_user_created_idx ON dante_messages (user_id, created_at DESC);

-- 2. Morning briefing tracking -------------------------------------------
CREATE TABLE IF NOT EXISTS dante_briefing_meta (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  last_seen_date TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
ALTER TABLE dante_briefing_meta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own dante_briefing_meta" ON dante_briefing_meta;
CREATE POLICY "Users manage own dante_briefing_meta" ON dante_briefing_meta
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3. Meetings (previously only kept in memory and lost on refresh) --------
CREATE TABLE IF NOT EXISTS meetings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  person_name TEXT NOT NULL DEFAULT '',
  date TEXT,                 -- YYYY-MM-DD
  time TEXT,                 -- HH:MM
  subject TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'ongoing', 'completed')),
  elapsed_seconds INT NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  google_event_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own meetings" ON meetings;
CREATE POLICY "Users see own meetings" ON meetings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS meetings_user_date_idx ON meetings (user_id, date);

-- 4. Real completion history for streaks & analytics ----------------------
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
UPDATE tasks SET completed_at = created_at WHERE status = 'done' AND completed_at IS NULL;
CREATE INDEX IF NOT EXISTS tasks_user_created_idx ON tasks (user_id, created_at);

-- 5. Tighten existing policies so inserts can't target another user -------
DROP POLICY IF EXISTS "Users see own tasks" ON tasks;
CREATE POLICY "Users see own tasks" ON tasks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users see own categories" ON categories;
CREATE POLICY "Users see own categories" ON categories
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users see own vault" ON vault_items;
CREATE POLICY "Users see own vault" ON vault_items
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 6. Self-service account deletion. No client-supplied user ID or admin key.
-- Deleting the auth user cascades to all app tables, including briefing metadata.
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id uuid := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM auth.users WHERE id = current_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;

-- 7. Atomic, retry-safe import of this browser's local/demo workspace.
CREATE TABLE IF NOT EXISTS public.local_data_imports (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  PRIMARY KEY (user_id, batch_id)
);
ALTER TABLE public.local_data_imports ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.local_data_imports TO authenticated;
DROP POLICY IF EXISTS "Users see own import receipts" ON public.local_data_imports;
CREATE POLICY "Users see own import receipts" ON public.local_data_imports
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.import_local_data(payload jsonb, batch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  item jsonb;
  category_id uuid;
  category_map jsonb := '{}'::jsonb;
  task_map jsonb := '{}'::jsonb;
  category_label text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  -- Serialize imports for this account, including different browser batches.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text, 0));
  IF EXISTS (SELECT 1 FROM public.local_data_imports r WHERE r.user_id = uid AND r.batch_id = import_local_data.batch_id) THEN
    RETURN;
  END IF;
  FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(payload->'categories') LOOP
    category_label := pg_catalog.btrim(item->>'label');
    IF category_label IS NULL OR category_label = '' THEN RAISE EXCEPTION 'Invalid category label'; END IF;
    SELECT c.id INTO category_id FROM public.categories c
      WHERE c.user_id = uid AND pg_catalog.lower(pg_catalog.btrim(c.label)) = pg_catalog.lower(category_label)
      ORDER BY c.id LIMIT 1;
    IF category_id IS NULL THEN
      INSERT INTO public.categories(user_id, label, color, slug)
      VALUES (uid, category_label, item->>'color', item->>'id') RETURNING id INTO category_id;
    END IF;
    category_map := category_map || pg_catalog.jsonb_build_object(item->>'id', category_id::text);
  END LOOP;
  FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(payload->'tasks') LOOP
    IF item->>'id' IS NOT NULL THEN task_map := task_map || pg_catalog.jsonb_build_object(item->>'id', gen_random_uuid()::text); END IF;
  END LOOP;
  FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(payload->'tasks') LOOP
    INSERT INTO public.tasks(id, user_id, title, cat, status, date, reminder, note, progress, steps, completed_at, recurrence, recurrence_day, recurrence_source_id, postponed_count, exam_plan)
    VALUES (COALESCE((task_map->>(item->>'id'))::uuid, gen_random_uuid()), uid, item->>'title', COALESCE(category_map->>(item->>'cat'), item->>'cat', 'other'),
      COALESCE(item->>'status', 'todo'), item->>'date', item->>'reminder', item->>'note',
      COALESCE((item->>'progress')::integer, 0), COALESCE(item->'steps', '[]'::jsonb), (item->>'completedAt')::timestamptz,
      COALESCE(item->>'recurrence', 'none'), (item->>'recurrenceDay')::smallint, (task_map->>(item->>'recurrenceSourceId'))::uuid, COALESCE((item->>'postponedCount')::integer, 0), NULLIF(item->'examPlan', 'null'::jsonb));
  END LOOP;
  FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(payload->'meetings') LOOP
    INSERT INTO public.meetings(user_id, person_name, date, time, subject, status, elapsed_seconds, notes, google_event_id, created_at)
    VALUES (uid, COALESCE(item->>'personName', ''), item->>'date', item->>'time', COALESCE(item->>'subject', ''),
      COALESCE(item->>'status', 'upcoming'), COALESCE((item->>'elapsedSeconds')::integer, 0), item->>'notes',
      item->>'googleEventId', COALESCE((item->>'createdAt')::timestamptz, now()));
  END LOOP;
  FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(payload->'vault') LOOP
    INSERT INTO public.vault_items(user_id, type, name, detail, url, added_at)
    VALUES (uid, COALESCE(item->>'type', 'link'), item->>'name', item->>'detail', item->>'url',
      COALESCE((item->>'addedAt')::timestamp, now()));
  END LOOP;
  INSERT INTO public.local_data_imports(user_id, batch_id) VALUES (uid, batch_id);
END;
$$;
REVOKE ALL ON FUNCTION public.import_local_data(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_local_data(jsonb, uuid) TO authenticated;

-- 8. Daily Dante quotas. Browser clients may read only their own counters.
CREATE TABLE IF NOT EXISTS public.dante_usage (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  messages integer NOT NULL DEFAULT 0 CHECK (messages >= 0),
  transcriptions integer NOT NULL DEFAULT 0 CHECK (transcriptions >= 0),
  PRIMARY KEY (user_id, date)
);
ALTER TABLE public.dante_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own Dante usage" ON public.dante_usage;
CREATE POLICY "Users see own Dante usage" ON public.dante_usage
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
REVOKE ALL ON public.dante_usage FROM anon, authenticated;
GRANT SELECT ON public.dante_usage TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.dante_usage TO service_role;

-- Only the server's service role may reserve usage. Row locking serializes calls
-- across processes; over-limit attempts do not increment or reach the AI provider.
CREATE OR REPLACE FUNCTION public.consume_dante_usage(p_user_id uuid, p_kind text, p_limit integer)
RETURNS TABLE (allowed boolean, date date, messages integer, transcriptions integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  usage_date date := (now() AT TIME ZONE 'UTC')::date;
  usage_row public.dante_usage%ROWTYPE;
BEGIN
  IF p_kind NOT IN ('messages', 'transcriptions') OR p_kind IS NULL OR p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'Invalid usage reservation';
  END IF;
  INSERT INTO public.dante_usage(user_id, date) VALUES (p_user_id, usage_date)
    ON CONFLICT ON CONSTRAINT dante_usage_pkey DO NOTHING;
  SELECT u.* INTO STRICT usage_row FROM public.dante_usage u
    WHERE u.user_id = p_user_id AND u.date = usage_date FOR UPDATE;
  IF (p_kind = 'messages' AND usage_row.messages >= p_limit)
    OR (p_kind = 'transcriptions' AND usage_row.transcriptions >= p_limit) THEN
    RETURN QUERY SELECT false, usage_row.date, usage_row.messages, usage_row.transcriptions;
    RETURN;
  END IF;
  UPDATE public.dante_usage AS u SET
    messages = u.messages + CASE WHEN p_kind = 'messages' THEN 1 ELSE 0 END,
    transcriptions = u.transcriptions + CASE WHEN p_kind = 'transcriptions' THEN 1 ELSE 0 END
    WHERE u.user_id = p_user_id AND u.date = usage_date RETURNING u.* INTO usage_row;
  RETURN QUERY SELECT true, usage_row.date, usage_row.messages, usage_row.transcriptions;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_dante_usage(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_dante_usage(uuid, text, integer) TO service_role;

-- 9. Recurring tasks. Metadata preserves monthly anchors and deduplicates successors.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS recurrence text NOT NULL DEFAULT 'none'
  CHECK (recurrence IN ('none', 'daily', 'weekdays', 'weekly', 'monthly'));
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS recurrence_day smallint CHECK (recurrence_day BETWEEN 1 AND 31);
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS recurrence_source_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_recurrence_source_idx ON public.tasks(user_id, recurrence_source_id);

CREATE OR REPLACE FUNCTION public.create_next_task_occurrence()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  due date;
  next_due date;
  anchor_day integer;
  next_reminder text := '';
BEGIN
  IF NEW.status IS DISTINCT FROM 'done' OR OLD.status IS NOT DISTINCT FROM 'done' OR NEW.recurrence = 'none' THEN RETURN NEW; END IF;
  BEGIN due := NULLIF(NEW.date, '')::date;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN due := NULL; END;
  due := COALESCE(due, (NEW.completed_at AT TIME ZONE 'UTC')::date, (now() AT TIME ZONE 'UTC')::date);
  anchor_day := COALESCE(NEW.recurrence_day, extract(day FROM due)::integer);
  IF NEW.recurrence = 'monthly' THEN
    next_due := (date_trunc('month', due) + interval '1 month')::date;
    next_due := next_due + least(anchor_day, extract(day FROM (next_due + interval '1 month - 1 day'))::integer) - 1;
  ELSE
    next_due := due + CASE WHEN NEW.recurrence = 'weekly' THEN 7 ELSE 1 END;
    WHILE NEW.recurrence = 'weekdays' AND extract(isodow FROM next_due) > 5 LOOP next_due := next_due + 1; END LOOP;
  END IF;
  IF NEW.reminder ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$' THEN
    BEGIN next_reminder := to_char(NEW.reminder::timestamp + (next_due - due) * interval '1 day', 'YYYY-MM-DD"T"HH24:MI');
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN next_reminder := ''; END;
  END IF;
  INSERT INTO public.tasks(user_id, title, cat, status, date, reminder, note, progress, steps, completed_at, recurrence, recurrence_day, recurrence_source_id)
  VALUES (NEW.user_id, NEW.title, NEW.cat, 'todo', next_due::text, next_reminder, NEW.note, 0,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('label', step->>'label', 'done', false))
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.steps) = 'array' THEN NEW.steps ELSE '[]'::jsonb END) step
      WHERE jsonb_typeof(step) = 'object' AND step ? 'label'), '[]'::jsonb),
    NULL, NEW.recurrence, anchor_day, NEW.id)
  ON CONFLICT (user_id, recurrence_source_id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tasks_create_next_occurrence ON public.tasks;
CREATE TRIGGER tasks_create_next_occurrence AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.create_next_task_occurrence();

-- 10. Count actual later-date transitions, including concurrent or non-UI edits.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS postponed_count integer NOT NULL DEFAULT 0 CHECK (postponed_count >= 0);
CREATE OR REPLACE FUNCTION public.track_task_postponement()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  old_due date;
  new_due date;
BEGIN
  NEW.postponed_count := OLD.postponed_count;
  IF OLD.date IS NOT DISTINCT FROM NEW.date THEN RETURN NEW; END IF;
  IF OLD.date ~ '^\d{4}-\d{2}-\d{2}$' AND NEW.date ~ '^\d{4}-\d{2}-\d{2}$' THEN
    BEGIN
      old_due := OLD.date::date;
      new_due := NEW.date::date;
      IF new_due > old_due THEN NEW.postponed_count := least(OLD.postponed_count::bigint + 1, 2147483647)::integer; END IF;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tasks_track_postponement ON public.tasks;
CREATE TRIGGER tasks_track_postponement BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.track_task_postponement();

-- 11. Durable exam plans; save all sessions atomically under the caller's RLS.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS exam_plan jsonb;
CREATE OR REPLACE FUNCTION public.save_exam_plan(p_owner uuid, p_draft jsonb, p_sessions jsonb, p_expected jsonb DEFAULT NULL, p_start_date date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  cat_row categories%ROWTYPE;
  item jsonb;
  current_snapshot jsonb;
  plan_id text := p_draft->>'id';
  budget integer := (p_draft->>'minutesPerDay')::integer;
  metadata jsonb;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_owner THEN RAISE EXCEPTION 'Account changed'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_owner::text || ':exam-plans'));
  IF p_start_date IS NULL OR budget IS NULL OR p_draft->>'examDate' IS NULL OR p_sessions IS NULL OR plan_id IS NULL OR length(plan_id) > 100 OR nullif(trim(p_draft->>'name'),'') IS NULL
     OR length(p_draft->>'name') > 160 OR budget < 1 OR budget > 1440
     OR jsonb_typeof(p_sessions) <> 'array' OR jsonb_array_length(p_sessions) NOT BETWEEN 1 AND 100
     OR p_start_date NOT BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + 1
     OR (p_draft->>'examDate')::date <= p_start_date THEN RAISE EXCEPTION 'Invalid exam plan'; END IF;
  PERFORM 1 FROM tasks WHERE user_id = p_owner AND exam_plan->>'id' = plan_id FOR UPDATE;
  IF p_expected IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',id::text,'date',date,'status',status,'steps',coalesce(steps,'[]'::jsonb),'exam_plan',exam_plan) ORDER BY id::text),'[]'::jsonb)
      INTO current_snapshot FROM tasks
      WHERE user_id = p_owner AND exam_plan->>'id' = plan_id AND status <> 'done'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(steps,'[]'::jsonb)) step WHERE step->>'id' = exam_plan->>'topicId' AND step->>'done' = 'true');
    IF current_snapshot <> p_expected THEN RAISE EXCEPTION 'Plan changed. Refresh and try again.'; END IF;
    IF jsonb_array_length(p_expected) <> jsonb_array_length(p_sessions) THEN RAISE EXCEPTION 'Topic mismatch'; END IF;
  END IF;
  SELECT * INTO cat_row FROM categories WHERE user_id = p_owner AND lower(trim(label)) = 'exams' ORDER BY id LIMIT 1;
  IF cat_row.id IS NULL THEN
    INSERT INTO categories(user_id,label,color,slug) VALUES(p_owner,'Exams','#8151eb','exams') RETURNING * INTO cat_row;
  END IF;
  IF p_expected IS NULL AND EXISTS(SELECT 1 FROM tasks WHERE user_id = p_owner AND exam_plan->>'id' = plan_id) THEN
    RETURN jsonb_build_object('category',to_jsonb(cat_row),'tasks',(SELECT jsonb_agg(to_jsonb(t)) FROM tasks t WHERE user_id = p_owner AND exam_plan->>'id' = plan_id));
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_sessions) x GROUP BY x->>'topicId' HAVING count(*) > 1)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_sessions) x GROUP BY x->>'date' HAVING sum((x->>'minutes')::integer) > budget)
    THEN RAISE EXCEPTION 'Invalid study capacity'; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p_sessions) LOOP
    IF item->>'date' IS NULL OR item->>'minutes' IS NULL OR nullif(trim(item->>'topic'),'') IS NULL OR length(item->>'topic') > 200 OR nullif(item->>'topicId','') IS NULL
      OR (item->>'date')::date < p_start_date OR (item->>'date')::date >= (p_draft->>'examDate')::date
      OR (item->>'minutes')::integer <> least(25,budget) THEN RAISE EXCEPTION 'Invalid session'; END IF;
    metadata := jsonb_build_object('id',plan_id,'name',trim(p_draft->>'name'),'examDate',p_draft->>'examDate','minutesPerDay',budget,'topicId',item->>'topicId');
    IF p_expected IS NULL THEN
      INSERT INTO tasks(user_id,title,cat,status,date,reminder,note,progress,steps,exam_plan)
        VALUES(p_owner,trim(p_draft->>'name') || ': ' || trim(item->>'topic'),cat_row.id,'todo',item->>'date','','Study session: ' || (item->>'minutes') || ' minutes',0,
          jsonb_build_array(jsonb_build_object('id',item->>'topicId','label',trim(item->>'topic'),'done',false)),metadata);
    ELSE
      UPDATE tasks SET date = item->>'date', exam_plan = metadata
        WHERE user_id = p_owner AND exam_plan->>'id' = plan_id AND exam_plan->>'topicId' = item->>'topicId'
        AND id::text IN (SELECT x->>'id' FROM jsonb_array_elements(p_expected) x);
      IF NOT FOUND THEN RAISE EXCEPTION 'Topic changed'; END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('category',to_jsonb(cat_row),'tasks',(SELECT jsonb_agg(to_jsonb(t)) FROM tasks t WHERE user_id = p_owner AND exam_plan->>'id' = plan_id));
END; $$;
REVOKE ALL ON FUNCTION public.save_exam_plan(uuid,jsonb,jsonb,jsonb,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_exam_plan(uuid,jsonb,jsonb,jsonb,date) TO authenticated;

-- Stripe billing: clients can read their own plan but cannot grant entitlements.
CREATE TABLE IF NOT EXISTS public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,
  current_period_end timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  stripe_event_created bigint NOT NULL DEFAULT 0,
  stripe_event_revision bigint NOT NULL DEFAULT 0
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO service_role;
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.stripe_billing_events (
  event_id text PRIMARY KEY,
  customer_id text NOT NULL,
  created bigint NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stripe_billing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_billing_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.stripe_billing_events TO service_role;

-- Receipt and plan change commit together; row locking serializes concurrent deliveries.
CREATE OR REPLACE FUNCTION public.apply_stripe_billing_event(
  p_event_id text, p_created bigint, p_customer text,
  p_subscription text, p_period_end timestamptz, p_plan text, p_expected_revision bigint
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE owner_id uuid; previous_created bigint; previous_revision bigint;
BEGIN
  IF p_plan NOT IN ('free', 'pro') OR p_created < 0 OR p_event_id IS NULL THEN
    RAISE EXCEPTION 'Invalid billing event';
  END IF;
  SELECT user_id, stripe_event_created, stripe_event_revision INTO owner_id, previous_created, previous_revision
    FROM public.profiles WHERE stripe_customer_id = p_customer FOR UPDATE;
  IF owner_id IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.stripe_billing_events WHERE event_id = p_event_id) THEN RETURN; END IF;
  -- Stripe was read outside this transaction. A competing delivery must retry and
  -- reread canonical Stripe state instead of overwriting it with an older snapshot.
  IF previous_revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'Concurrent billing update; retry';
  END IF;
  INSERT INTO public.stripe_billing_events(event_id, customer_id, created)
    VALUES (p_event_id, p_customer, p_created) ON CONFLICT DO NOTHING;
  IF NOT FOUND OR p_created < previous_created THEN RETURN; END IF;
  UPDATE public.profiles SET plan = p_plan, stripe_subscription_id = p_subscription,
    current_period_end = p_period_end, updated_at = now(), stripe_event_created = p_created, stripe_event_revision = stripe_event_revision + 1
    WHERE user_id = owner_id;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_stripe_billing_event(text,bigint,text,text,timestamptz,text,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_stripe_billing_event(text,bigint,text,text,timestamptz,text,bigint) TO service_role;

-- Google provider refresh tokens are server-only, including for the owning user.
CREATE TABLE IF NOT EXISTS public.google_tokens (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_token text NOT NULL CHECK (length(refresh_token) > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.google_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_tokens TO service_role;
-- No browser-facing policies: requireUser endpoints access storage via service_role.

-- Per-user private Realtime Broadcast includes DELETE ownership; unlike Postgres
-- Changes DELETE subscriptions, it never broadcasts another user's rows to clients.
CREATE OR REPLACE FUNCTION public.broadcast_workspace_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    IF OLD.user_id IS NOT NULL THEN
      PERFORM realtime.broadcast_changes('zenos:workspace:' || OLD.user_id::text, 'DELETE', 'DELETE', TG_TABLE_NAME, TG_TABLE_SCHEMA, NULL, OLD);
    END IF;
    IF NEW.user_id IS NOT NULL THEN
      PERFORM realtime.broadcast_changes('zenos:workspace:' || NEW.user_id::text, 'INSERT', 'INSERT', TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, NULL);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.user_id IS NOT NULL THEN
      PERFORM realtime.broadcast_changes('zenos:workspace:' || OLD.user_id::text, TG_OP, TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD);
    END IF;
  ELSIF NEW.user_id IS NOT NULL THEN
    PERFORM realtime.broadcast_changes('zenos:workspace:' || NEW.user_id::text, TG_OP, TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.broadcast_workspace_change() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE table_name text;
BEGIN
  -- Non-Supabase PostgreSQL test/development databases need no Realtime service.
  IF to_regclass('realtime.messages') IS NULL THEN RETURN; END IF;
  IF to_regprocedure('realtime.broadcast_changes(text,text,text,text,text,record,record,text)') IS NULL THEN
    RAISE EXCEPTION 'Supabase Realtime Broadcast database support must be enabled first';
  END IF;
  -- Supabase owns this managed table and normally enables RLS already.
  -- Avoid ALTER TABLE when it is unnecessary: the SQL Editor role may not own it.
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'realtime.messages'::regclass) THEN
    ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
  END IF;
  DROP POLICY IF EXISTS zenos_workspace_receive ON realtime.messages;
  CREATE POLICY zenos_workspace_receive ON realtime.messages FOR SELECT TO authenticated
    USING (extension = 'broadcast' AND topic = 'zenos:workspace:' || (SELECT auth.uid())::text AND (SELECT realtime.topic()) = topic);
  -- Scoped restrictive policies preserve unrelated channels while preventing broad
  -- pre-existing allow policies from exposing or forging workspace broadcasts.
  DROP POLICY IF EXISTS zenos_workspace_isolation ON realtime.messages;
  CREATE POLICY zenos_workspace_isolation ON realtime.messages AS RESTRICTIVE FOR SELECT TO anon, authenticated
    USING (topic NOT LIKE 'zenos:workspace:%' OR (topic = 'zenos:workspace:' || (SELECT auth.uid())::text AND (SELECT realtime.topic()) = topic));
  DROP POLICY IF EXISTS zenos_workspace_server_only ON realtime.messages;
  CREATE POLICY zenos_workspace_server_only ON realtime.messages AS RESTRICTIVE FOR INSERT TO anon, authenticated
    WITH CHECK (topic NOT LIKE 'zenos:workspace:%');
  DROP POLICY IF EXISTS zenos_workspace_no_client_update ON realtime.messages;
  CREATE POLICY zenos_workspace_no_client_update ON realtime.messages AS RESTRICTIVE FOR UPDATE TO anon, authenticated
    USING (topic NOT LIKE 'zenos:workspace:%') WITH CHECK (topic NOT LIKE 'zenos:workspace:%');
  FOREACH table_name IN ARRAY ARRAY['tasks', 'categories', 'meetings', 'vault_items'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zenos_workspace_broadcast ON public.%I', table_name);
    EXECUTE format('CREATE TRIGGER zenos_workspace_broadcast AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.broadcast_workspace_change()', table_name);
  END LOOP;
EXCEPTION WHEN insufficient_privilege THEN
  -- This subtransaction rolls back ALL policy/trigger changes together. Never
  -- install publishers without their private-channel authorization policies.
  RAISE WARNING 'Workspace Realtime setup was not applied: the SQL Editor role cannot manage realtime.messages. Other migrations will continue. Ask the Supabase project administrator to apply this Realtime block with an authorized role; see docs/REALTIME.md.';
END;
$$;

-- Long-term Dante facts: own-account access, atomic per-user quota, account cascade.
CREATE TABLE IF NOT EXISTS public.dante_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fact text NOT NULL CHECK (char_length(btrim(fact)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, fact)
);
CREATE INDEX IF NOT EXISTS dante_memory_user_recent_idx ON public.dante_memory(user_id, created_at DESC, id DESC);
ALTER TABLE public.dante_memory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dante_memory FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.dante_memory TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dante_memory TO service_role;
DROP POLICY IF EXISTS dante_memory_own ON public.dante_memory;
CREATE POLICY dante_memory_own ON public.dante_memory FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.enforce_dante_memory_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  NEW.fact := btrim(NEW.fact);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.user_id::text, 507));
  IF TG_OP = 'INSERT' OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    IF (SELECT count(*) FROM public.dante_memory WHERE user_id = NEW.user_id) >= 100 THEN
      RAISE EXCEPTION 'Dante memory limit reached (100 facts)';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN NEW.created_at := now(); END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS dante_memory_limit ON public.dante_memory;
CREATE TRIGGER dante_memory_limit BEFORE INSERT OR UPDATE ON public.dante_memory
  FOR EACH ROW EXECUTE FUNCTION public.enforce_dante_memory_limit();
REVOKE ALL ON FUNCTION public.enforce_dante_memory_limit() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.remember_dante_fact(p_fact text, p_owner uuid DEFAULT auth.uid())
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE saved public.dante_memory%ROWTYPE; owner_id uuid := auth.uid(); normalized text := btrim(p_fact);
BEGIN
  IF owner_id IS NULL OR p_owner IS DISTINCT FROM owner_id THEN
    RAISE EXCEPTION 'Authentication required for this account' USING ERRCODE = '42501';
  END IF;
  IF normalized IS NULL OR char_length(normalized) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'A fact must contain 1-200 characters' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 507));
  SELECT * INTO saved FROM public.dante_memory WHERE user_id = owner_id AND fact = normalized;
  IF FOUND THEN RETURN to_jsonb(saved); END IF;
  INSERT INTO public.dante_memory(user_id, fact) VALUES(owner_id, normalized) RETURNING * INTO saved;
  RETURN to_jsonb(saved);
END;
$$;
REVOKE ALL ON FUNCTION public.remember_dante_fact(text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remember_dante_fact(text,uuid) TO authenticated;

-- Saved lecture study guides (audio remains temporary and is never stored here).
CREATE OR REPLACE FUNCTION public.valid_lecture_content(points jsonb, cards jsonb, actions jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE item jsonb;
BEGIN
  IF jsonb_typeof(points) IS DISTINCT FROM 'array' OR jsonb_typeof(cards) IS DISTINCT FROM 'array' OR jsonb_typeof(actions) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(points) NOT BETWEEN 1 AND 20 OR jsonb_array_length(cards) <> 10 OR jsonb_array_length(actions) > 20 THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(points) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'string' OR char_length(btrim(item #>> '{}')) NOT BETWEEN 1 AND 500 THEN RETURN false; END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(cards) LOOP
    IF jsonb_typeof(item->'question') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'answer') IS DISTINCT FROM 'string'
      OR char_length(btrim(item->>'question')) NOT BETWEEN 1 AND 300 OR char_length(btrim(item->>'answer')) NOT BETWEEN 1 AND 1000
      OR (item ? 'known' AND jsonb_typeof(item->'known') NOT IN ('boolean','null')) THEN RETURN false; END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(actions) LOOP
    IF jsonb_typeof(item->'title') IS DISTINCT FROM 'string' OR char_length(btrim(item->>'title')) NOT BETWEEN 1 AND 200
      OR (item ? 'task_id' AND jsonb_typeof(item->'task_id') NOT IN ('string','null')) OR length(item->>'task_id') > 64 THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;
CREATE TABLE IF NOT EXISTS public.lectures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  duration_seconds double precision NOT NULL CHECK (duration_seconds > 0 AND duration_seconds <= 3600),
  transcript text NOT NULL CHECK (char_length(btrim(transcript)) BETWEEN 1 AND 200000),
  summary text NOT NULL CHECK (char_length(btrim(summary)) BETWEEN 1 AND 4000),
  key_points jsonb NOT NULL,
  flashcards jsonb NOT NULL,
  action_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (public.valid_lecture_content(key_points, flashcards, action_items))
);
CREATE INDEX IF NOT EXISTS lectures_user_recent_idx ON public.lectures(user_id, created_at DESC);
ALTER TABLE public.lectures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lectures FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lectures TO authenticated, service_role;
DROP POLICY IF EXISTS lectures_own ON public.lectures;
CREATE POLICY lectures_own ON public.lectures FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.review_lecture_card(p_lecture_id uuid, p_index integer, p_known boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE saved public.lectures%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_index IS NULL OR p_index NOT BETWEEN 0 AND 9 OR p_known IS NULL THEN RAISE EXCEPTION 'Invalid review'; END IF;
  SELECT * INTO saved FROM public.lectures WHERE id = p_lecture_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lecture not found'; END IF;
  UPDATE public.lectures SET flashcards = jsonb_set(flashcards, ARRAY[p_index::text,'known'], to_jsonb(p_known), true)
    WHERE id = saved.id RETURNING * INTO saved;
  RETURN to_jsonb(saved);
END;
$$;
REVOKE ALL ON FUNCTION public.review_lecture_card(uuid,integer,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_lecture_card(uuid,integer,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_lecture_task(p_lecture_id uuid, p_index integer, p_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE saved public.lectures%ROWTYPE; item jsonb; added public.tasks%ROWTYPE; category text;
BEGIN
  IF auth.uid() IS NULL OR p_index IS NULL OR p_index < 0 OR p_date IS NULL OR abs(p_date - (now() AT TIME ZONE 'UTC')::date) > 1 THEN RAISE EXCEPTION 'Invalid lecture action'; END IF;
  SELECT * INTO saved FROM public.lectures WHERE id = p_lecture_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR p_index >= jsonb_array_length(saved.action_items) THEN RAISE EXCEPTION 'Lecture action not found'; END IF;
  item := saved.action_items->p_index;
  IF item->>'task_id' IS NOT NULL THEN
    SELECT * INTO added FROM public.tasks WHERE user_id = auth.uid() AND id::text = item->>'task_id';
    IF FOUND THEN RETURN jsonb_build_object('lecture',to_jsonb(saved),'task',to_jsonb(added)); END IF;
  END IF;
  SELECT id::text INTO category FROM public.categories WHERE user_id = auth.uid() ORDER BY (lower(label) = 'other') DESC,id LIMIT 1;
  INSERT INTO public.tasks(user_id,title,cat,status,date,reminder,note,progress,steps)
    VALUES(auth.uid(),item->>'title',coalesce(category,'other'),'todo',p_date::text,'','From lecture: ' || saved.title,0,'[]') RETURNING * INTO added;
  UPDATE public.lectures SET action_items = jsonb_set(action_items, ARRAY[p_index::text,'task_id'], to_jsonb(added.id::text), true)
    WHERE id = saved.id RETURNING * INTO saved;
  RETURN jsonb_build_object('lecture',to_jsonb(saved),'task',to_jsonb(added));
END;
$$;
REVOKE ALL ON FUNCTION public.add_lecture_task(uuid,integer,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_lecture_task(uuid,integer,date) TO authenticated;

-- Semantic note search. Supabase ships pgvector; plain test databases may omit it.
DO $search_setup$
DECLARE vector_schema text; source_table text; row_data jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    RAISE WARNING 'pgvector is unavailable; semantic search setup was skipped. Enable the vector extension before using semantic search.';
    RETURN;
  END IF;
  CREATE SCHEMA IF NOT EXISTS extensions;
  CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
  SELECT n.nspname INTO vector_schema FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector';
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO authenticated,service_role',vector_schema);
  -- Resolve the actual extension schema: existing public installs also work.
  EXECUTE replace($ddl$
CREATE TABLE IF NOT EXISTS public.embeddings (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('task','meeting','vault','lecture')),
  source_id uuid NOT NULL,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  title text NOT NULL,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2400),
  embedding __VECTOR_SCHEMA__.vector(1024),
  model text,
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,source_type,source_id,chunk_index)
);
CREATE INDEX IF NOT EXISTS embeddings_owner_model_idx ON public.embeddings(user_id,model);
CREATE INDEX IF NOT EXISTS embeddings_cosine_idx ON public.embeddings USING hnsw(embedding __VECTOR_SCHEMA__.vector_cosine_ops);
ALTER TABLE public.embeddings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.embeddings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.embeddings TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.embeddings TO service_role;
DROP POLICY IF EXISTS embeddings_select_own ON public.embeddings;
CREATE POLICY embeddings_select_own ON public.embeddings FOR SELECT TO authenticated USING (auth.uid()=user_id);

CREATE OR REPLACE FUNCTION public.search_source_document(kind text, item jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $fn$
DECLARE title text; body text;
BEGIN
  CASE kind
    WHEN 'task' THEN
      IF btrim(coalesce(item->>'note',''))='' THEN RETURN NULL; END IF;
      title := left(item->>'title',200); body := 'Task: ' || coalesce(item->>'title','') || E'\nNotes: ' || (item->>'note');
    WHEN 'meeting' THEN
      IF btrim(coalesce(item->>'notes',''))='' THEN RETURN NULL; END IF;
      title := left(coalesce(item->>'person_name','') || ': ' || coalesce(item->>'subject',''),200);
      body := 'Meeting with ' || coalesce(item->>'person_name','') || ' on ' || coalesce(item->>'date','') || ': ' || coalesce(item->>'subject','') || E'\nNotes: ' || (item->>'notes');
    WHEN 'vault' THEN
      title := left(item->>'name',200); body := coalesce(item->>'name','') || E'\n' || coalesce(item->>'detail','') || E'\n' || coalesce(item->>'url','');
    WHEN 'lecture' THEN
      title := left(item->>'title',200); body := 'Lecture: ' || coalesce(item->>'title','') || E'\nSummary: ' || coalesce(item->>'summary','');
    ELSE RETURN NULL;
  END CASE;
  IF btrim(body)='' THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('title',coalesce(nullif(btrim(title),''),'Untitled'),'content',btrim(body));
END;
$fn$;
REVOKE ALL ON FUNCTION public.search_source_document(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.search_source_document(text,jsonb) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.sync_search_document(kind text, item jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE doc jsonb := public.search_source_document(kind,item); owner_id uuid := (item->>'user_id')::uuid;
  item_id uuid := (item->>'id')::uuid; body text; pos integer; idx integer := 0; piece text;
BEGIN
  IF owner_id IS NULL THEN RETURN; END IF;
  IF doc IS NULL THEN DELETE FROM public.embeddings WHERE user_id=owner_id AND source_type=kind AND source_id=item_id; RETURN; END IF;
  body := doc->>'content'; pos := 1;
  WHILE pos <= char_length(body) LOOP
    piece := substring(body FROM pos FOR 2000);
    INSERT INTO public.embeddings AS saved(user_id,source_type,source_id,chunk_index,title,content)
      VALUES(owner_id,kind,item_id,idx,doc->>'title',piece)
      ON CONFLICT(user_id,source_type,source_id,chunk_index) DO UPDATE
      SET title=EXCLUDED.title,content=EXCLUDED.content,embedding=NULL,model=NULL,revision=gen_random_uuid(),updated_at=now()
      WHERE saved.content IS DISTINCT FROM EXCLUDED.content OR saved.title IS DISTINCT FROM EXCLUDED.title;
    idx := idx+1;
    IF pos+2000>char_length(body) THEN EXIT; END IF;
    pos := pos+1800;
  END LOOP;
  DELETE FROM public.embeddings WHERE user_id=owner_id AND source_type=kind AND source_id=item_id AND chunk_index>=idx;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sync_search_document(text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.queue_search_document()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE kind text := TG_ARGV[0];
BEGIN
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id) THEN
    DELETE FROM public.embeddings WHERE user_id=OLD.user_id AND source_type=kind AND source_id=OLD.id;
  END IF;
  IF TG_OP<>'DELETE' THEN PERFORM public.sync_search_document(kind,to_jsonb(NEW)); END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.queue_search_document() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.save_search_embedding(p_user_id uuid,p_source_type text,p_source_id uuid,p_chunk_index integer,p_revision uuid,p_model text,p_embedding __VECTOR_SCHEMA__.vector)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
BEGIN
  IF p_embedding IS NULL OR __VECTOR_SCHEMA__.vector_dims(p_embedding)<>1024 OR p_embedding OPERATOR(__VECTOR_SCHEMA__.<=>) p_embedding > 0.00001 THEN RAISE EXCEPTION 'Invalid 1024-dimensional embedding'; END IF;
  UPDATE public.embeddings SET embedding=p_embedding,model=p_model
    WHERE user_id=p_user_id AND source_type=p_source_type AND source_id=p_source_id AND chunk_index=p_chunk_index AND revision=p_revision;
  RETURN FOUND;
END;
$fn$;
REVOKE ALL ON FUNCTION public.save_search_embedding(uuid,text,uuid,integer,uuid,text,__VECTOR_SCHEMA__.vector) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_search_embedding(uuid,text,uuid,integer,uuid,text,__VECTOR_SCHEMA__.vector) TO service_role;

CREATE OR REPLACE FUNCTION public.match_search_notes(p_embedding __VECTOR_SCHEMA__.vector,p_model text)
RETURNS TABLE(source_type text,source_id uuid,title text,content text,score double precision)
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
  -- Materialize the owner slice before ranking; never let a global ANN cutoff
  -- underfill a user's results because other accounts have nearer vectors.
  WITH owned AS MATERIALIZED (
    SELECT * FROM public.embeddings WHERE user_id=auth.uid() AND model=p_model AND embedding IS NOT NULL
  ), ranked AS (
    SELECT e.source_type,e.source_id,e.title,e.content,1-(e.embedding OPERATOR(__VECTOR_SCHEMA__.<=>) p_embedding) AS score
    FROM owned e
  ), best AS (
    SELECT DISTINCT ON (source_type,source_id) * FROM ranked WHERE score>=0.25 ORDER BY source_type,source_id,score DESC
  ) SELECT * FROM best ORDER BY score DESC,source_type,source_id LIMIT 8;
$fn$;
REVOKE ALL ON FUNCTION public.match_search_notes(__VECTOR_SCHEMA__.vector,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.match_search_notes(__VECTOR_SCHEMA__.vector,text) TO authenticated;
$ddl$, '__VECTOR_SCHEMA__', quote_ident(vector_schema));

  FOREACH source_table IN ARRAY ARRAY['tasks','meetings','vault_items','lectures'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zenos_search_document ON public.%I',source_table);
    EXECUTE format('CREATE TRIGGER zenos_search_document AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.queue_search_document(%L)',source_table,CASE source_table WHEN 'tasks' THEN 'task' WHEN 'meetings' THEN 'meeting' WHEN 'vault_items' THEN 'vault' ELSE 'lecture' END);
    FOR row_data IN EXECUTE format('SELECT to_jsonb(t) FROM public.%I t',source_table) LOOP
      PERFORM public.sync_search_document(CASE source_table WHEN 'tasks' THEN 'task' WHEN 'meetings' THEN 'meeting' WHEN 'vault_items' THEN 'vault' ELSE 'lecture' END,row_data);
    END LOOP;
  END LOOP;
END;
$search_setup$;
