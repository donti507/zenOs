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

-- Private AI-created pages. Raw code is only ever rendered in an opaque iframe.
CREATE TABLE IF NOT EXISTS public.space_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slug text NOT NULL CHECK (char_length(slug) BETWEEN 1 AND 48 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  current_version_id uuid,
  permissions jsonb NOT NULL DEFAULT '{"tasks":false,"events":false}'::jsonb
    CHECK (jsonb_typeof(permissions->'tasks')='boolean' AND jsonb_typeof(permissions->'events')='boolean' AND permissions ? 'tasks' AND permissions ? 'events'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,slug), UNIQUE(id,user_id)
);
CREATE TABLE IF NOT EXISTS public.space_page_versions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('initial','ai','restore')),
  html text NOT NULL CHECK (octet_length(html)<=96000 AND char_length(html)<=24000),
  css text NOT NULL CHECK (octet_length(css)<=64000 AND char_length(css)<=16000),
  js text NOT NULL CHECK (octet_length(js)<=96000 AND char_length(js)<=24000),
  prompt text NOT NULL DEFAULT '' CHECK (char_length(prompt)<=2000),
  reply text NOT NULL DEFAULT '' CHECK (char_length(reply)<=2000),
  model text NOT NULL DEFAULT '' CHECK (char_length(model)<=120),
  restored_from uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(page_id,user_id) REFERENCES public.space_pages(id,user_id) ON DELETE CASCADE,
  UNIQUE(page_id,id,user_id)
);
-- Legacy versions have no comparison base; new edits record their exact predecessor.
ALTER TABLE public.space_page_versions ADD COLUMN IF NOT EXISTS explanation text NOT NULL DEFAULT '' CHECK (char_length(explanation)<=1200);
ALTER TABLE public.space_page_versions ADD COLUMN IF NOT EXISTS parent_version_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='space_pages_current_version_fk' AND conrelid='public.space_pages'::regclass) THEN
    ALTER TABLE public.space_pages ADD CONSTRAINT space_pages_current_version_fk FOREIGN KEY(id,current_version_id,user_id)
      REFERENCES public.space_page_versions(page_id,id,user_id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS space_pages_owner_idx ON public.space_pages(user_id,created_at);
CREATE INDEX IF NOT EXISTS space_versions_recent_idx ON public.space_page_versions(user_id,page_id,created_at DESC,id DESC);
ALTER TABLE public.space_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.space_page_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.space_pages,public.space_page_versions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.space_pages,public.space_page_versions TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.space_pages,public.space_page_versions TO service_role;
DROP POLICY IF EXISTS space_pages_own ON public.space_pages;
CREATE POLICY space_pages_own ON public.space_pages FOR ALL TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
DROP POLICY IF EXISTS space_versions_own ON public.space_page_versions;
CREATE POLICY space_versions_own ON public.space_page_versions FOR ALL TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);

CREATE OR REPLACE FUNCTION public.space_current_snapshot(p_page_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object('page',to_jsonb(p),'version',to_jsonb(v)) FROM public.space_pages p
    JOIN public.space_page_versions v ON v.id=p.current_version_id AND v.page_id=p.id AND v.user_id=p.user_id
    WHERE p.id=p_page_id AND p.user_id=auth.uid();
$$;
REVOKE ALL ON FUNCTION public.space_current_snapshot(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.space_current_snapshot(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_space_page(p_id uuid,p_slug text,p_title text,p_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_id uuid:=auth.uid(); saved public.space_pages%ROWTYPE;
BEGIN
  IF owner_id IS NULL OR p_id IS NULL OR p_version_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO saved FROM public.space_pages WHERE id=p_id AND user_id=owner_id;
  IF FOUND THEN
    IF NOT EXISTS(SELECT 1 FROM public.space_page_versions WHERE id=p_version_id AND page_id=saved.id AND user_id=owner_id AND kind='initial') THEN RAISE EXCEPTION 'Page request conflict'; END IF;
    RETURN public.space_current_snapshot(saved.id);
  END IF;
  INSERT INTO public.space_pages(id,user_id,slug,title) VALUES(p_id,owner_id,p_slug,btrim(p_title));
  INSERT INTO public.space_page_versions(id,user_id,page_id,kind,html,css,js) VALUES(p_version_id,owner_id,p_id,'initial',
    '<main><h1>Your space</h1><p>Describe what you want to build in the chat.</p></main>',
    'main { max-width: 60rem; margin: auto; padding: 2rem; }','');
  UPDATE public.space_pages SET current_version_id=p_version_id WHERE id=p_id AND user_id=owner_id;
  RETURN public.space_current_snapshot(p_id);
END;
$$;
REVOKE ALL ON FUNCTION public.create_space_page(uuid,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_space_page(uuid,text,text,uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.save_space_edit(uuid,uuid,uuid,text,text,text,text,text,text);
CREATE OR REPLACE FUNCTION public.save_space_edit(p_page_id uuid,p_expected_version_id uuid,p_version_id uuid,p_html text,p_css text,p_js text,p_prompt text,p_reply text,p_model text,p_explanation text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_id uuid:=auth.uid(); saved public.space_pages%ROWTYPE;
BEGIN
  IF owner_id IS NULL OR p_version_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO saved FROM public.space_pages WHERE id=p_page_id AND user_id=owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Page not found'; END IF;
  IF EXISTS(SELECT 1 FROM public.space_page_versions WHERE id=p_version_id AND page_id=saved.id AND user_id=owner_id) THEN RETURN public.space_current_snapshot(saved.id); END IF;
  IF saved.current_version_id IS DISTINCT FROM p_expected_version_id THEN RAISE EXCEPTION 'Page changed; refresh before editing'; END IF;
  INSERT INTO public.space_page_versions(id,user_id,page_id,kind,html,css,js,prompt,reply,model,explanation,parent_version_id)
    VALUES(p_version_id,owner_id,saved.id,'ai',p_html,p_css,p_js,p_prompt,p_reply,p_model,p_explanation,saved.current_version_id);
  UPDATE public.space_pages SET current_version_id=p_version_id,permissions='{"tasks":false,"events":false}',updated_at=now() WHERE id=saved.id AND user_id=owner_id;
  RETURN public.space_current_snapshot(saved.id);
END;
$$;
REVOKE ALL ON FUNCTION public.save_space_edit(uuid,uuid,uuid,text,text,text,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_space_edit(uuid,uuid,uuid,text,text,text,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.restore_space_version(p_page_id uuid,p_expected_version_id uuid,p_source_version_id uuid,p_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_id uuid:=auth.uid(); saved public.space_pages%ROWTYPE; source public.space_page_versions%ROWTYPE;
BEGIN
  IF owner_id IS NULL OR p_version_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO saved FROM public.space_pages WHERE id=p_page_id AND user_id=owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Page not found'; END IF;
  IF EXISTS(SELECT 1 FROM public.space_page_versions WHERE id=p_version_id AND page_id=saved.id AND user_id=owner_id) THEN RETURN public.space_current_snapshot(saved.id); END IF;
  IF saved.current_version_id IS DISTINCT FROM p_expected_version_id THEN RAISE EXCEPTION 'Page changed; refresh before restoring'; END IF;
  SELECT * INTO source FROM public.space_page_versions WHERE id=p_source_version_id AND page_id=saved.id AND user_id=owner_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Version not found'; END IF;
  INSERT INTO public.space_page_versions(id,user_id,page_id,kind,html,css,js,prompt,reply,model,restored_from,explanation,parent_version_id)
    VALUES(p_version_id,owner_id,saved.id,'restore',source.html,source.css,source.js,'','Restored a saved version.',source.model,source.id,'Restored this page to a previous save point. Its code replaces the version that was open before the restore.',saved.current_version_id);
  UPDATE public.space_pages SET current_version_id=p_version_id,permissions='{"tasks":false,"events":false}',updated_at=now() WHERE id=saved.id AND user_id=owner_id;
  RETURN public.space_current_snapshot(saved.id);
END;
$$;
REVOKE ALL ON FUNCTION public.restore_space_version(uuid,uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.restore_space_version(uuid,uuid,uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_space_permissions(p_page_id uuid,p_expected_version_id uuid,p_tasks boolean,p_events boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved public.space_pages%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_tasks IS NULL OR p_events IS NULL THEN RAISE EXCEPTION 'Invalid permission request'; END IF;
  SELECT * INTO saved FROM public.space_pages WHERE id=p_page_id AND user_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Page not found'; END IF;
  IF saved.current_version_id IS DISTINCT FROM p_expected_version_id THEN RAISE EXCEPTION 'Page changed; refresh before granting access'; END IF;
  UPDATE public.space_pages SET permissions=jsonb_build_object('tasks',p_tasks,'events',p_events),updated_at=now() WHERE id=saved.id AND user_id=auth.uid() RETURNING * INTO saved;
  RETURN to_jsonb(saved);
END;
$$;
REVOKE ALL ON FUNCTION public.set_space_permissions(uuid,uuid,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_space_permissions(uuid,uuid,boolean,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.space_bridge_permission(p_page_id uuid,p_version_id uuid,p_method text)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT coalesce((SELECT p.current_version_id=p_version_id AND p_method IN ('tasks','events') AND p.permissions->>p_method='true'
    FROM public.space_pages p WHERE p.id=p_page_id AND p.user_id=auth.uid()),false);
$$;
REVOKE ALL ON FUNCTION public.space_bridge_permission(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.space_bridge_permission(uuid,uuid,text) TO authenticated;

-- Private Home widget preferences; code and grants are unchanged by layout edits.
ALTER TABLE public.space_pages ADD COLUMN IF NOT EXISTS dashboard_size text DEFAULT NULL CHECK (dashboard_size IN ('small','medium'));
ALTER TABLE public.space_pages ADD COLUMN IF NOT EXISTS dashboard_order integer NOT NULL DEFAULT 0 CHECK (dashboard_order >= 0);
CREATE OR REPLACE FUNCTION public.change_space_widget(p_page_id uuid,p_action text)
RETURNS SETOF public.space_pages LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_id uuid:=auth.uid(); target public.space_pages%ROWTYPE; ids uuid[]; idx integer; other integer; temp uuid;
BEGIN
  IF owner_id IS NULL OR p_action IS NULL OR p_action NOT IN ('small','medium','unpin','earlier','later') THEN RAISE EXCEPTION 'Invalid widget request'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 42));
  SELECT * INTO target FROM public.space_pages WHERE id=p_page_id AND user_id=owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Page not found'; END IF;
  SELECT coalesce(array_agg(id ORDER BY dashboard_order,id),ARRAY[]::uuid[]) INTO ids FROM public.space_pages WHERE user_id=owner_id AND dashboard_size IS NOT NULL;
  idx:=array_position(ids,p_page_id);
  IF p_action IN ('earlier','later') THEN
    IF idx IS NULL THEN RAISE EXCEPTION 'Page is not pinned'; END IF;
    other:=idx+CASE WHEN p_action='earlier' THEN -1 ELSE 1 END;
    IF other>=1 AND other<=cardinality(ids) THEN temp:=ids[idx];ids[idx]:=ids[other];ids[other]:=temp; END IF;
  ELSE
    IF p_action<>'unpin' AND idx IS NULL THEN ids:=array_append(ids,p_page_id); END IF;
    UPDATE public.space_pages SET dashboard_size=CASE WHEN p_action='unpin' THEN NULL ELSE p_action END WHERE id=p_page_id AND user_id=owner_id;
  END IF;
  UPDATE public.space_pages p SET dashboard_order=(n.ordinality-1)::integer FROM unnest(ids) WITH ORDINALITY n(id,ordinality) WHERE p.id=n.id AND p.user_id=owner_id;
  RETURN QUERY SELECT * FROM public.space_pages WHERE user_id=owner_id ORDER BY created_at,id;
END;
$$;
REVOKE ALL ON FUNCTION public.change_space_widget(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.change_space_widget(uuid,text) TO authenticated;

-- Reserve two Arena messages atomically; no partial debit when only one remains.
CREATE OR REPLACE FUNCTION public.consume_dante_usage_amount(p_user_id uuid,p_kind text,p_limit integer,p_amount integer)
RETURNS TABLE(allowed boolean,date date,messages integer,transcriptions integer)
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE usage_date date:=(now() AT TIME ZONE 'UTC')::date; usage_row public.dante_usage%ROWTYPE;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('messages','transcriptions') OR p_limit IS NULL OR p_limit<1 OR p_amount IS NULL OR p_amount NOT IN (1,2) THEN RAISE EXCEPTION 'Invalid usage reservation'; END IF;
  INSERT INTO public.dante_usage(user_id,date) VALUES(p_user_id,usage_date) ON CONFLICT ON CONSTRAINT dante_usage_pkey DO NOTHING;
  SELECT u.* INTO STRICT usage_row FROM public.dante_usage u WHERE u.user_id=p_user_id AND u.date=usage_date FOR UPDATE;
  IF (p_kind='messages' AND usage_row.messages>p_limit-p_amount) OR (p_kind='transcriptions' AND usage_row.transcriptions>p_limit-p_amount) THEN
    RETURN QUERY SELECT false,usage_row.date,usage_row.messages,usage_row.transcriptions; RETURN;
  END IF;
  UPDATE public.dante_usage u SET messages=u.messages+CASE WHEN p_kind='messages' THEN p_amount ELSE 0 END,
    transcriptions=u.transcriptions+CASE WHEN p_kind='transcriptions' THEN p_amount ELSE 0 END
    WHERE u.user_id=p_user_id AND u.date=usage_date RETURNING u.* INTO usage_row;
  RETURN QUERY SELECT true,usage_row.date,usage_row.messages,usage_row.transcriptions;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_dante_usage_amount(uuid,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_dante_usage_amount(uuid,text,integer,integer) TO service_role;

CREATE TABLE IF NOT EXISTS public.space_arena_rounds (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  model_a text NOT NULL CHECK (char_length(model_a) BETWEEN 1 AND 120),
  model_b text NOT NULL CHECK (char_length(model_b) BETWEEN 1 AND 120 AND model_b<>model_a),
  completed boolean NOT NULL DEFAULT false,
  winner text CHECK (winner IS NULL OR (winner IN ('a','b') AND completed)),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS space_arena_owner_idx ON public.space_arena_rounds(user_id);
ALTER TABLE public.space_arena_rounds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.space_arena_rounds FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.space_arena_rounds TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.space_arena_rounds TO service_role;
DROP POLICY IF EXISTS space_arena_own ON public.space_arena_rounds;
CREATE POLICY space_arena_own ON public.space_arena_rounds FOR ALL TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
CREATE OR REPLACE FUNCTION public.vote_space_arena(p_id uuid,p_winner text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved public.space_arena_rounds%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_winner IS NULL OR p_winner NOT IN ('a','b') THEN RAISE EXCEPTION 'Invalid vote'; END IF;
  SELECT * INTO saved FROM public.space_arena_rounds WHERE id=p_id AND user_id=auth.uid() FOR UPDATE;
  IF NOT FOUND OR NOT saved.completed THEN RAISE EXCEPTION 'Completed comparison not found'; END IF;
  IF saved.winner IS NOT NULL AND saved.winner<>p_winner THEN RAISE EXCEPTION 'Vote already recorded'; END IF;
  UPDATE public.space_arena_rounds SET winner=p_winner WHERE id=saved.id AND user_id=auth.uid();
  RETURN p_winner;
END;
$$;
REVOKE ALL ON FUNCTION public.vote_space_arena(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vote_space_arena(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.space_arena_leaderboard()
RETURNS TABLE(model text,wins bigint,comparisons bigint) LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT candidate.model,count(*) FILTER(WHERE r.winner=candidate.side),count(*)
  FROM public.space_arena_rounds r CROSS JOIN LATERAL (VALUES(r.model_a,'a'),(r.model_b,'b')) candidate(model,side)
  WHERE r.user_id=auth.uid() AND r.completed AND r.winner IS NOT NULL GROUP BY candidate.model ORDER BY 2 DESC,1;
$$;
REVOKE ALL ON FUNCTION public.space_arena_leaderboard() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.space_arena_leaderboard() TO authenticated;

-- Public snapshots are separate from private pages, prompts, history and grants.
ALTER TABLE public.space_pages ADD COLUMN IF NOT EXISTS remix_source jsonb;
CREATE TABLE IF NOT EXISTS public.space_gallery_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_page_id uuid NOT NULL UNIQUE REFERENCES public.space_pages(id) ON DELETE CASCADE,
  title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '' CHECK(char_length(description)<=400),
  author text NOT NULL CHECK(char_length(btrim(author)) BETWEEN 1 AND 40),
  html text NOT NULL CHECK(char_length(html)<=24000),css text NOT NULL CHECK(char_length(css)<=16000),js text NOT NULL CHECK(char_length(js)<=24000),
  parent_id uuid REFERENCES public.space_gallery_pages(id) ON DELETE SET NULL,
  remix_credit jsonb,
  published boolean NOT NULL DEFAULT true,
  moderation text NOT NULL DEFAULT 'visible' CHECK(moderation IN ('visible','hidden','deleted')),
  report_count integer NOT NULL DEFAULT 0 CHECK(report_count>=0),review_epoch integer NOT NULL DEFAULT 0 CHECK(review_epoch>=0),
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS space_gallery_visible_idx ON public.space_gallery_pages(created_at DESC,id) WHERE published AND moderation='visible';
CREATE INDEX IF NOT EXISTS space_gallery_parent_idx ON public.space_gallery_pages(parent_id);
CREATE INDEX IF NOT EXISTS space_gallery_owner_idx ON public.space_gallery_pages(user_id,id);
CREATE TABLE IF NOT EXISTS public.space_gallery_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gallery_id uuid NOT NULL REFERENCES public.space_gallery_pages(id) ON DELETE CASCADE,
  review_epoch integer NOT NULL,reason text NOT NULL CHECK(reason IN ('inappropriate','unsafe','spam','other')),created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(gallery_id,user_id,review_epoch)
);
ALTER TABLE public.space_gallery_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.space_gallery_reports ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS space_gallery_reports_owner_idx ON public.space_gallery_reports(user_id,id);
REVOKE ALL ON public.space_gallery_pages,public.space_gallery_reports FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.space_gallery_pages,public.space_gallery_reports TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.space_gallery_pages,public.space_gallery_reports TO service_role;
DROP POLICY IF EXISTS space_gallery_own ON public.space_gallery_pages;
CREATE POLICY space_gallery_own ON public.space_gallery_pages FOR ALL TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
DROP POLICY IF EXISTS space_gallery_reports_own ON public.space_gallery_reports;
CREATE POLICY space_gallery_reports_own ON public.space_gallery_reports FOR ALL TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);

CREATE OR REPLACE FUNCTION public.publish_space_gallery(p_user_id uuid,p_page_id uuid,p_version_id uuid,p_title text,p_description text,p_author text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE page public.space_pages%ROWTYPE; version public.space_page_versions%ROWTYPE; existing public.space_gallery_pages%ROWTYPE; parent uuid; result uuid;
BEGIN
 SELECT * INTO page FROM public.space_pages WHERE id=p_page_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Page not found'; END IF;
 IF page.current_version_id IS DISTINCT FROM p_version_id THEN RAISE EXCEPTION 'Page changed; refresh before publishing'; END IF;
 SELECT * INTO STRICT version FROM public.space_page_versions WHERE id=p_version_id AND page_id=page.id AND user_id=p_user_id;
 SELECT * INTO existing FROM public.space_gallery_pages WHERE source_page_id=page.id FOR UPDATE;
 IF FOUND AND existing.moderation<>'visible' THEN RAISE EXCEPTION 'Publication requires moderation review'; END IF;
 SELECT id INTO parent FROM public.space_gallery_pages WHERE id=(page.remix_source->>'id')::uuid;
 IF existing.id IS NULL THEN
  INSERT INTO public.space_gallery_pages(user_id,source_page_id,title,description,author,html,css,js,parent_id,remix_credit)
   VALUES(p_user_id,page.id,p_title,p_description,p_author,version.html,version.css,version.js,parent,page.remix_source) RETURNING id INTO result;
 ELSE
  UPDATE public.space_gallery_pages SET title=p_title,description=p_description,author=p_author,html=version.html,css=version.css,js=version.js,published=true,updated_at=now() WHERE id=existing.id RETURNING id INTO result;
 END IF;
 RETURN result;
END;
$$;
CREATE OR REPLACE FUNCTION public.withdraw_space_gallery(p_user_id uuid,p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 UPDATE public.space_gallery_pages SET published=false,updated_at=now() WHERE id=p_id AND user_id=p_user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Publication not found'; END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.report_space_gallery(p_user_id uuid,p_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE page public.space_gallery_pages%ROWTYPE; added integer;
BEGIN
 IF p_reason IS NULL OR p_reason NOT IN ('inappropriate','unsafe','spam','other') THEN RAISE EXCEPTION 'Invalid reason'; END IF;
 SELECT * INTO page FROM public.space_gallery_pages WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR page.user_id=p_user_id THEN RAISE EXCEPTION 'Page not available for reporting'; END IF;
 IF EXISTS(SELECT 1 FROM public.space_gallery_reports WHERE gallery_id=p_id AND user_id=p_user_id AND review_epoch=page.review_epoch) THEN RETURN; END IF;
 IF NOT page.published OR page.moderation<>'visible' THEN RAISE EXCEPTION 'Page not available for reporting'; END IF;
 INSERT INTO public.space_gallery_reports(user_id,gallery_id,review_epoch,reason) VALUES(p_user_id,p_id,page.review_epoch,p_reason) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;
 IF added>0 THEN UPDATE public.space_gallery_pages SET report_count=report_count+1,moderation=CASE WHEN report_count+1>=3 THEN 'hidden' ELSE moderation END,updated_at=now() WHERE id=p_id; END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.moderate_space_gallery(p_id uuid,p_action text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE page public.space_gallery_pages%ROWTYPE;
BEGIN
 SELECT * INTO page FROM public.space_gallery_pages WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR page.moderation='deleted' THEN RAISE EXCEPTION 'Publication not found'; END IF;
 IF p_action='hide' THEN UPDATE public.space_gallery_pages SET moderation='hidden',updated_at=now() WHERE id=p_id;
 ELSIF p_action='restore' THEN UPDATE public.space_gallery_pages SET moderation='visible',report_count=0,review_epoch=review_epoch+1,updated_at=now() WHERE id=p_id;
 ELSIF p_action='delete' THEN UPDATE public.space_gallery_pages SET moderation='deleted',published=false,html='',css='',js='',title='Deleted publication',description='',author='Creator',updated_at=now() WHERE id=p_id;
 ELSE RAISE EXCEPTION 'Invalid moderation action'; END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.remix_space_gallery(p_user_id uuid,p_id uuid,p_new_id uuid,p_slug text,p_title text,p_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE source public.space_gallery_pages%ROWTYPE; existing public.space_pages%ROWTYPE;
BEGIN
 SELECT * INTO existing FROM public.space_pages WHERE id=p_new_id AND user_id=p_user_id;
 IF FOUND THEN
  IF existing.remix_source->>'id' IS DISTINCT FROM p_id::text THEN RAISE EXCEPTION 'Remix request conflict'; END IF;
  RETURN (SELECT jsonb_build_object('page',to_jsonb(p),'version',to_jsonb(v)) FROM public.space_pages p JOIN public.space_page_versions v ON v.id=p.current_version_id AND v.page_id=p.id AND v.user_id=p.user_id WHERE p.id=existing.id AND p.user_id=p_user_id);
 END IF;
 SELECT * INTO source FROM public.space_gallery_pages WHERE id=p_id AND published AND moderation='visible' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Public page not found'; END IF;
 INSERT INTO public.space_pages(id,user_id,slug,title,current_version_id,remix_source) VALUES(p_new_id,p_user_id,p_slug,p_title,p_version_id,jsonb_build_object('id',source.id,'title',source.title,'author',source.author)||CASE WHEN source.remix_credit IS NOT NULL THEN jsonb_build_object('original',coalesce(source.remix_credit->'original',source.remix_credit)) ELSE '{}'::jsonb END);
 INSERT INTO public.space_page_versions(id,user_id,page_id,kind,html,css,js,explanation) VALUES(p_version_id,p_user_id,p_new_id,'initial',source.html,source.css,source.js,'Copied a public gallery page into your private space with credit to its author.');
 RETURN (SELECT jsonb_build_object('page',to_jsonb(p),'version',to_jsonb(v)) FROM public.space_pages p JOIN public.space_page_versions v ON v.id=p.current_version_id AND v.page_id=p.id AND v.user_id=p.user_id WHERE p.id=p_new_id AND p.user_id=p_user_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.space_gallery_tree(p_id uuid)
RETURNS TABLE(id uuid,parent_id uuid,title text,author text,depth integer) LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 WITH RECURSIVE lineage AS (
  SELECT p.id,p.parent_id,p.title,p.author,0 AS depth,ARRAY[p.id] AS path FROM public.space_gallery_pages p WHERE p.id=p_id AND p.published AND p.moderation='visible'
  UNION ALL SELECT p.id,p.parent_id,p.title,p.author,l.depth-1,l.path||p.id FROM lineage l JOIN public.space_gallery_pages p ON p.id=l.parent_id
   WHERE p.published AND p.moderation='visible' AND l.depth> -20 AND NOT p.id=ANY(l.path)
 ), children AS (SELECT p.id,p.parent_id,p.title,p.author,1 AS depth FROM public.space_gallery_pages p WHERE p.parent_id=p_id AND p.published AND p.moderation='visible' ORDER BY p.created_at,p.id LIMIT 50)
 SELECT l.id,l.parent_id,l.title,l.author,l.depth FROM lineage l UNION ALL SELECT * FROM children ORDER BY 5,1;
$$;
REVOKE ALL ON FUNCTION public.publish_space_gallery(uuid,uuid,uuid,text,text,text),public.withdraw_space_gallery(uuid,uuid),public.report_space_gallery(uuid,uuid,text),public.moderate_space_gallery(uuid,text),public.remix_space_gallery(uuid,uuid,uuid,text,text,uuid),public.space_gallery_tree(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_space_gallery(uuid,uuid,uuid,text,text,text),public.withdraw_space_gallery(uuid,uuid),public.report_space_gallery(uuid,uuid,text),public.moderate_space_gallery(uuid,text),public.remix_space_gallery(uuid,uuid,uuid,text,text,uuid),public.space_gallery_tree(uuid) TO service_role;

-- Weekly build challenges: public metadata is served only by the curated API.
CREATE TABLE IF NOT EXISTS public.space_challenges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 1 AND 80),
 description text NOT NULL CHECK(char_length(btrim(description)) BETWEEN 1 AND 1000),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 finalized boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at>starts_at AND ends_at<=starts_at+interval '31 days')
);
CREATE TABLE IF NOT EXISTS public.space_challenge_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 challenge_id uuid NOT NULL REFERENCES public.space_challenges(id) ON DELETE CASCADE,
 gallery_id uuid NOT NULL REFERENCES public.space_gallery_pages(id) ON DELETE CASCADE,
 winner boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(challenge_id,user_id), UNIQUE(challenge_id,gallery_id)
);
CREATE TABLE IF NOT EXISTS public.space_challenge_votes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 challenge_id uuid NOT NULL REFERENCES public.space_challenges(id) ON DELETE CASCADE,
 entry_id uuid NOT NULL REFERENCES public.space_challenge_entries(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(challenge_id,user_id)
);
CREATE TABLE IF NOT EXISTS public.space_badges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 badge text NOT NULL CHECK(badge IN ('first_page','first_remix','challenge_winner','seven_day_streak')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,badge)
);
CREATE TABLE IF NOT EXISTS public.space_activity_days (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 day date NOT NULL, UNIQUE(user_id,day)
);
CREATE INDEX IF NOT EXISTS space_challenges_owner_idx ON public.space_challenges(user_id);
CREATE INDEX IF NOT EXISTS space_challenges_dates_idx ON public.space_challenges(ends_at);
CREATE INDEX IF NOT EXISTS space_entries_owner_idx ON public.space_challenge_entries(user_id);
CREATE INDEX IF NOT EXISTS space_votes_entry_idx ON public.space_challenge_votes(entry_id);
CREATE INDEX IF NOT EXISTS space_votes_owner_idx ON public.space_challenge_votes(user_id);
CREATE INDEX IF NOT EXISTS space_badges_owner_idx ON public.space_badges(user_id);
CREATE INDEX IF NOT EXISTS space_activity_owner_idx ON public.space_activity_days(user_id);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['space_challenges','space_challenge_entries','space_challenge_votes','space_badges','space_activity_days'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tab);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tab);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',tab);
  EXECUTE format('DROP POLICY IF EXISTS own_row ON public.%I',tab);
  EXECUTE format('CREATE POLICY own_row ON public.%I FOR ALL TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id)',tab);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.submit_space_challenge(p_user_id uuid,p_challenge_id uuid,p_gallery_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c public.space_challenges%ROWTYPE; existing public.space_challenge_entries%ROWTYPE; result uuid;
BEGIN
 SELECT * INTO c FROM public.space_challenges WHERE id=p_challenge_id FOR UPDATE;
 IF NOT FOUND OR c.finalized OR now()<c.starts_at OR now()>=c.ends_at THEN RAISE EXCEPTION 'Challenge is not open'; END IF;
 -- Publication lock serializes submission with moderation and withdrawal.
 PERFORM 1 FROM public.space_gallery_pages WHERE id=p_gallery_id AND user_id=p_user_id AND published AND moderation='visible' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Choose your own visible published page'; END IF;
 SELECT * INTO existing FROM public.space_challenge_entries WHERE challenge_id=c.id AND user_id=p_user_id;
 IF FOUND THEN
  IF existing.gallery_id=p_gallery_id THEN RETURN existing.id; END IF;
  RAISE EXCEPTION 'One submission per challenge';
 END IF;
 INSERT INTO public.space_challenge_entries(user_id,challenge_id,gallery_id) VALUES(p_user_id,c.id,p_gallery_id) RETURNING id INTO result;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.vote_space_challenge(p_user_id uuid,p_challenge_id uuid,p_entry_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c public.space_challenges%ROWTYPE; existing public.space_challenge_votes%ROWTYPE;
BEGIN
 SELECT * INTO c FROM public.space_challenges WHERE id=p_challenge_id FOR UPDATE;
 IF NOT FOUND OR c.finalized OR now()<c.starts_at OR now()>=c.ends_at THEN RAISE EXCEPTION 'Challenge is not open'; END IF;
 PERFORM 1 FROM public.space_challenge_entries e JOIN public.space_gallery_pages p ON p.id=e.gallery_id WHERE e.id=p_entry_id AND e.challenge_id=c.id AND e.user_id<>p_user_id AND p.published AND p.moderation='visible' FOR SHARE OF p;
 IF NOT FOUND THEN RAISE EXCEPTION 'Choose another author visible entry'; END IF;
 SELECT * INTO existing FROM public.space_challenge_votes WHERE challenge_id=c.id AND user_id=p_user_id;
 IF FOUND THEN
  IF existing.entry_id=p_entry_id THEN RETURN existing.entry_id; END IF;
  RAISE EXCEPTION 'Vote already recorded';
 END IF;
 INSERT INTO public.space_challenge_votes(user_id,challenge_id,entry_id) VALUES(p_user_id,c.id,p_entry_id);
 RETURN p_entry_id;
END $$;
-- Called after the deadline, lazily on reads; no scheduler or client time is trusted.
CREATE OR REPLACE FUNCTION public.finalize_space_challenges()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c record;
BEGIN
 FOR c IN SELECT id FROM public.space_challenges WHERE NOT finalized AND ends_at<=now() ORDER BY id FOR UPDATE LOOP
  WITH scores AS (
   SELECT e.id,count(v.id) AS total FROM public.space_challenge_entries e
   JOIN public.space_gallery_pages p ON p.id=e.gallery_id AND p.published AND p.moderation='visible'
   LEFT JOIN public.space_challenge_votes v ON v.entry_id=e.id
   WHERE e.challenge_id=c.id GROUP BY e.id
  ) UPDATE public.space_challenge_entries SET winner=true WHERE id IN(SELECT id FROM scores WHERE total>0 AND total=(SELECT max(total) FROM scores));
  INSERT INTO public.space_badges(user_id,badge) SELECT user_id,'challenge_winner' FROM public.space_challenge_entries WHERE challenge_id=c.id AND winner ON CONFLICT(user_id,badge) DO NOTHING;
  UPDATE public.space_challenges SET finalized=true WHERE id=c.id;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.space_challenge_detail(p_id uuid,p_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('challenge',jsonb_build_object('id',c.id,'title',c.title,'description',c.description,'startsAt',c.starts_at,'endsAt',c.ends_at,'finalized',c.finalized),
 'entries',coalesce((SELECT jsonb_agg(row ORDER BY (row->>'votes')::bigint DESC,row->>'id') FROM (
 SELECT jsonb_build_object('id',e.id,'pageId',p.id,'title',p.title,'author',p.author,'votes',(SELECT count(*) FROM public.space_challenge_votes v WHERE v.entry_id=e.id),'winner',e.winner) AS row
 FROM public.space_challenge_entries e JOIN public.space_gallery_pages p ON p.id=e.gallery_id AND p.published AND p.moderation='visible' WHERE e.challenge_id=c.id) AS visible),'[]'::jsonb),
 'myVote',(SELECT entry_id FROM public.space_challenge_votes WHERE challenge_id=c.id AND user_id=p_user_id),
 'myEntry',(SELECT id FROM public.space_challenge_entries WHERE challenge_id=c.id AND user_id=p_user_id))
 FROM public.space_challenges c WHERE c.id=p_id;
$$;
CREATE OR REPLACE FUNCTION public.refresh_space_badges(p_user_id uuid)
RETURNS TABLE(badge text,created_at timestamptz) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE today_utc date=(now() AT TIME ZONE 'UTC')::date;
BEGIN
 -- Every observed signed-in activity day is recorded by the server, never supplied by the browser.
 INSERT INTO public.space_activity_days(user_id,day) VALUES(p_user_id,today_utc) ON CONFLICT(user_id,day) DO NOTHING;
 INSERT INTO public.space_badges(user_id,badge) SELECT p_user_id,'first_page' WHERE EXISTS(SELECT 1 FROM public.space_pages WHERE user_id=p_user_id) ON CONFLICT ON CONSTRAINT space_badges_user_id_badge_key DO NOTHING;
 INSERT INTO public.space_badges(user_id,badge) SELECT p_user_id,'first_remix' WHERE EXISTS(SELECT 1 FROM public.space_pages WHERE user_id=p_user_id AND remix_source IS NOT NULL) ON CONFLICT ON CONSTRAINT space_badges_user_id_badge_key DO NOTHING;
 INSERT INTO public.space_badges(user_id,badge) SELECT p_user_id,'seven_day_streak' WHERE (SELECT count(*) FROM public.space_activity_days WHERE user_id=p_user_id AND day BETWEEN today_utc-6 AND today_utc)=7 ON CONFLICT ON CONSTRAINT space_badges_user_id_badge_key DO NOTHING;
 RETURN QUERY SELECT b.badge,b.created_at FROM public.space_badges b WHERE b.user_id=p_user_id ORDER BY b.created_at,b.badge;
END $$;
REVOKE ALL ON FUNCTION public.submit_space_challenge(uuid,uuid,uuid),public.vote_space_challenge(uuid,uuid,uuid),public.finalize_space_challenges(),public.space_challenge_detail(uuid,uuid),public.refresh_space_badges(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_space_challenge(uuid,uuid,uuid),public.vote_space_challenge(uuid,uuid,uuid),public.finalize_space_challenges(),public.space_challenge_detail(uuid,uuid),public.refresh_space_badges(uuid) TO service_role;
-- Award creation milestones at the write, even if a page is later deleted.
CREATE OR REPLACE FUNCTION public.award_space_creation_badges()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.space_badges(user_id,badge) VALUES(NEW.user_id,'first_page') ON CONFLICT(user_id,badge) DO NOTHING;
 IF NEW.remix_source IS NOT NULL THEN INSERT INTO public.space_badges(user_id,badge) VALUES(NEW.user_id,'first_remix') ON CONFLICT(user_id,badge) DO NOTHING; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.award_space_creation_badges() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS space_creation_badges ON public.space_pages;
CREATE TRIGGER space_creation_badges AFTER INSERT ON public.space_pages FOR EACH ROW EXECUTE FUNCTION public.award_space_creation_badges();
INSERT INTO public.space_badges(user_id,badge) SELECT DISTINCT user_id,'first_page' FROM public.space_pages ON CONFLICT(user_id,badge) DO NOTHING;
INSERT INTO public.space_badges(user_id,badge) SELECT DISTINCT user_id,'first_remix' FROM public.space_pages WHERE remix_source IS NOT NULL ON CONFLICT(user_id,badge) DO NOTHING;

-- Signed-in, invite-link Focus Rooms. Browser writes go only through verified APIs.
CREATE TABLE IF NOT EXISTS public.focus_rooms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 1 AND 80),
 started_at timestamptz, elapsed_seconds double precision NOT NULL DEFAULT 0 CHECK(elapsed_seconds>=0 AND elapsed_seconds<'Infinity'::float8),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 last_active_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.focus_room_members (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 room_id uuid NOT NULL REFERENCES public.focus_rooms(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(char_length(btrim(name)) BETWEEN 1 AND 40), time_zone text NOT NULL DEFAULT 'UTC',
 UNIQUE(room_id,user_id)
);
CREATE TABLE IF NOT EXISTS public.focus_room_sessions (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 room_id uuid NOT NULL REFERENCES public.focus_rooms(id) ON DELETE CASCADE,
 last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS focus_rooms_owner_idx ON public.focus_rooms(user_id);
CREATE INDEX IF NOT EXISTS focus_room_members_owner_idx ON public.focus_room_members(user_id);
CREATE INDEX IF NOT EXISTS focus_room_sessions_owner_idx ON public.focus_room_sessions(user_id);
CREATE INDEX IF NOT EXISTS focus_room_sessions_room_idx ON public.focus_room_sessions(room_id,last_seen_at);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['focus_rooms','focus_room_members','focus_room_sessions'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tab);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tab);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',tab);
  EXECUTE format('DROP POLICY IF EXISTS own_row ON public.%I',tab);
  EXECUTE format('CREATE POLICY own_row ON public.%I FOR ALL TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id)',tab);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.create_focus_room(p_user_id uuid,p_id uuid,p_title text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE saved public.focus_rooms%ROWTYPE;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('focus-create:'||p_user_id::text,0));
 SELECT * INTO saved FROM public.focus_rooms WHERE id=p_id;
 IF FOUND THEN
  IF saved.user_id<>p_user_id OR saved.title<>p_title OR saved.last_active_at<=now()-interval '24 hours' THEN RAISE EXCEPTION 'Room unavailable'; END IF;
  RETURN saved.id;
 END IF;
 IF (SELECT count(*) FROM public.focus_rooms WHERE user_id=p_user_id AND last_active_at>now()-interval '24 hours')>=10 THEN RAISE EXCEPTION 'Ten active rooms per creator'; END IF;
 INSERT INTO public.focus_rooms(id,user_id,title) VALUES(p_id,p_user_id,p_title);RETURN p_id;
END $$;
CREATE OR REPLACE FUNCTION public.enter_focus_room(p_user_id uuid,p_id uuid,p_session_id uuid,p_name text,p_time_zone text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE saved public.focus_rooms%ROWTYPE;
BEGIN
 SELECT * INTO saved FROM public.focus_rooms WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR saved.last_active_at<=now()-interval '24 hours' THEN RAISE EXCEPTION 'Room unavailable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_time_zone) THEN RAISE EXCEPTION 'Invalid time zone'; END IF;
 DELETE FROM public.focus_room_sessions WHERE room_id=p_id AND last_seen_at<=now()-interval '120 seconds';
 IF (SELECT count(DISTINCT user_id) FROM public.focus_room_sessions WHERE room_id=p_id AND user_id<>p_user_id)>=50 THEN RAISE EXCEPTION 'Room is full'; END IF;
 IF (SELECT count(*) FROM public.focus_room_sessions WHERE room_id=p_id AND user_id=p_user_id AND id<>p_session_id)>=3 THEN RAISE EXCEPTION 'Three tabs per member'; END IF;
 INSERT INTO public.focus_room_members(user_id,room_id,name,time_zone) VALUES(p_user_id,p_id,p_name,p_time_zone)
 ON CONFLICT(room_id,user_id) DO UPDATE SET name=excluded.name,time_zone=excluded.time_zone;
 INSERT INTO public.focus_room_sessions(id,user_id,room_id) VALUES(p_session_id,p_user_id,p_id)
 ON CONFLICT(id) DO UPDATE SET last_seen_at=now() WHERE focus_room_sessions.user_id=p_user_id AND focus_room_sessions.room_id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Session unavailable'; END IF;
 UPDATE public.focus_rooms SET last_active_at=now() WHERE id=p_id;
END $$;
CREATE OR REPLACE FUNCTION public.heartbeat_focus_room(p_user_id uuid,p_id uuid,p_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.focus_rooms WHERE id=p_id AND last_active_at>now()-interval '24 hours' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Room unavailable'; END IF;
 UPDATE public.focus_room_sessions SET last_seen_at=now() WHERE id=p_session_id AND room_id=p_id AND user_id=p_user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Session unavailable'; END IF;
 UPDATE public.focus_rooms SET last_active_at=now() WHERE id=p_id;
END $$;
CREATE OR REPLACE FUNCTION public.leave_focus_room(p_user_id uuid,p_id uuid,p_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 -- Same lock order as enter/control prevents multi-tab leave/join races.
 PERFORM 1 FROM public.focus_rooms WHERE id=p_id FOR UPDATE;
 DELETE FROM public.focus_room_sessions WHERE id=p_session_id AND room_id=p_id AND user_id=p_user_id;
 IF NOT EXISTS(SELECT 1 FROM public.focus_room_sessions WHERE room_id=p_id AND user_id=p_user_id) THEN
  DELETE FROM public.focus_room_members WHERE room_id=p_id AND user_id=p_user_id;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.control_focus_room(p_user_id uuid,p_id uuid,p_revision bigint,p_action text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE saved public.focus_rooms%ROWTYPE; stamp timestamptz;
BEGIN
 SELECT * INTO saved FROM public.focus_rooms WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
 stamp:=clock_timestamp();
 IF NOT FOUND OR saved.last_active_at<=now()-interval '24 hours' OR NOT EXISTS(SELECT 1 FROM public.focus_room_sessions WHERE room_id=p_id AND user_id=p_user_id AND last_seen_at>now()-interval '120 seconds') THEN RAISE EXCEPTION 'Host access required'; END IF;
 IF p_revision IS NULL OR saved.revision<>p_revision THEN RAISE EXCEPTION 'Timer changed'; END IF;
 IF p_action='start' THEN
  UPDATE public.focus_rooms SET started_at=coalesce(started_at,stamp),revision=revision+1,last_active_at=stamp WHERE id=p_id;
 ELSIF p_action='pause' THEN
  UPDATE public.focus_rooms SET elapsed_seconds=elapsed_seconds+CASE WHEN started_at IS NULL THEN 0 ELSE greatest(0,extract(epoch FROM stamp-started_at)) END,started_at=NULL,revision=revision+1,last_active_at=stamp WHERE id=p_id;
 ELSIF p_action='reset' THEN
  UPDATE public.focus_rooms SET started_at=NULL,elapsed_seconds=0,revision=revision+1,last_active_at=stamp WHERE id=p_id;
 ELSE RAISE EXCEPTION 'Invalid timer action'; END IF;
END $$;
-- The service computes a count only; task content is never returned to a room.
GRANT SELECT ON public.tasks TO service_role;
CREATE OR REPLACE FUNCTION public.focus_completion_streak(p_user_id uuid,p_time_zone text)
RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 WITH days AS (SELECT DISTINCT (completed_at AT TIME ZONE p_time_zone)::date AS day FROM public.tasks WHERE user_id=p_user_id AND status='done' AND completed_at IS NOT NULL AND completed_at<=now() AND completed_at>now()-interval '3652 days'),
 ordered AS (SELECT day,row_number() OVER(ORDER BY day DESC) AS n FROM days),
 latest AS (SELECT max(day) AS day FROM days)
 SELECT least(3650,count(*))::integer FROM ordered,latest WHERE latest.day>=(now() AT TIME ZONE p_time_zone)::date-1 AND latest.day-ordered.day=ordered.n-1;
$$;
CREATE OR REPLACE FUNCTION public.focus_room_snapshot(p_user_id uuid,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE saved public.focus_rooms%ROWTYPE; result jsonb;
BEGIN
 SELECT * INTO saved FROM public.focus_rooms WHERE id=p_id AND last_active_at>now()-interval '24 hours';
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.focus_room_members WHERE room_id=p_id AND user_id=p_user_id) THEN RAISE EXCEPTION 'Room unavailable'; END IF;
 SELECT jsonb_build_object('room',jsonb_build_object('id',saved.id,'title',saved.title,'isHost',saved.user_id=p_user_id,'startedAt',saved.started_at,'elapsedSeconds',saved.elapsed_seconds,'revision',saved.revision,'lastActiveAt',saved.last_active_at),
 'serverNow',clock_timestamp(), 'members',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'streak',public.focus_completion_streak(m.user_id,m.time_zone),'sessions',
 (SELECT jsonb_agg(jsonb_build_object('id',s.id,'expiresAt',s.last_seen_at+interval '120 seconds') ORDER BY s.id) FROM public.focus_room_sessions s WHERE s.room_id=p_id AND s.user_id=m.user_id AND s.last_seen_at>now()-interval '120 seconds')) ORDER BY m.id)
 FROM public.focus_room_members m WHERE m.room_id=p_id AND EXISTS(SELECT 1 FROM public.focus_room_sessions s WHERE s.room_id=p_id AND s.user_id=m.user_id AND s.last_seen_at>now()-interval '120 seconds')),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.list_focus_rooms(p_user_id uuid)
RETURNS TABLE(id uuid,title text,last_active_at timestamptz) LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT r.id,r.title,r.last_active_at FROM public.focus_rooms r WHERE r.last_active_at>now()-interval '24 hours' AND (r.user_id=p_user_id OR EXISTS(SELECT 1 FROM public.focus_room_members m WHERE m.room_id=r.id AND m.user_id=p_user_id)) ORDER BY r.last_active_at DESC,r.id LIMIT 50;
$$;
REVOKE ALL ON FUNCTION public.create_focus_room(uuid,uuid,text),public.enter_focus_room(uuid,uuid,uuid,text,text),public.heartbeat_focus_room(uuid,uuid,uuid),public.leave_focus_room(uuid,uuid,uuid),public.control_focus_room(uuid,uuid,bigint,text),public.focus_completion_streak(uuid,text),public.focus_room_snapshot(uuid,uuid),public.list_focus_rooms(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_focus_room(uuid,uuid,text),public.enter_focus_room(uuid,uuid,uuid,text,text),public.heartbeat_focus_room(uuid,uuid,uuid),public.leave_focus_room(uuid,uuid,uuid),public.control_focus_room(uuid,uuid,bigint,text),public.focus_completion_streak(uuid,text),public.focus_room_snapshot(uuid,uuid),public.list_focus_rooms(uuid) TO service_role;

-- Private channel authorization does not expose membership tables to other users.
CREATE OR REPLACE FUNCTION public.can_access_focus_topic(p_topic text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.focus_rooms r JOIN public.focus_room_sessions s ON s.room_id=r.id WHERE p_topic='zenos:focus:'||r.id::text AND s.user_id=auth.uid() AND s.last_seen_at>now()-interval '120 seconds' AND r.last_active_at>now()-interval '24 hours');
$$;
REVOKE ALL ON FUNCTION public.can_access_focus_topic(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_access_focus_topic(text) TO anon,authenticated;
CREATE OR REPLACE FUNCTION public.broadcast_focus_timer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM realtime.send(jsonb_build_object('revision',NEW.revision),'timer','zenos:focus:'||NEW.id::text,true);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.broadcast_focus_timer() FROM PUBLIC,anon,authenticated;
DO $$ BEGIN
 IF to_regclass('realtime.messages') IS NULL THEN RETURN; END IF;
 -- Match the workspace block: install authorization and publishers atomically, or defer both.
 IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='realtime.messages'::regclass) THEN ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY; END IF;
 DROP POLICY IF EXISTS zenos_focus_receive ON realtime.messages;
 CREATE POLICY zenos_focus_receive ON realtime.messages FOR SELECT TO authenticated USING(extension IN ('presence','broadcast') AND topic=(SELECT realtime.topic()) AND public.can_access_focus_topic(topic));
 DROP POLICY IF EXISTS zenos_focus_presence ON realtime.messages;
 CREATE POLICY zenos_focus_presence ON realtime.messages FOR INSERT TO authenticated WITH CHECK(extension='presence' AND topic=(SELECT realtime.topic()) AND public.can_access_focus_topic(topic));
 DROP POLICY IF EXISTS zenos_focus_read_isolation ON realtime.messages;
 CREATE POLICY zenos_focus_read_isolation ON realtime.messages AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(topic NOT LIKE 'zenos:focus:%' OR (auth.uid() IS NOT NULL AND extension IN ('presence','broadcast') AND topic=(SELECT realtime.topic()) AND public.can_access_focus_topic(topic)));
 DROP POLICY IF EXISTS zenos_focus_write_isolation ON realtime.messages;
 CREATE POLICY zenos_focus_write_isolation ON realtime.messages AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK(topic NOT LIKE 'zenos:focus:%' OR (auth.uid() IS NOT NULL AND extension='presence' AND topic=(SELECT realtime.topic()) AND public.can_access_focus_topic(topic)));
 DROP POLICY IF EXISTS zenos_focus_no_update ON realtime.messages;
 CREATE POLICY zenos_focus_no_update ON realtime.messages AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING(topic NOT LIKE 'zenos:focus:%') WITH CHECK(topic NOT LIKE 'zenos:focus:%');
 -- Realtime availability differs in ordinary PostgreSQL fixtures; policies remain testable.
 IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
  DROP TRIGGER IF EXISTS zenos_focus_timer ON public.focus_rooms;
  CREATE TRIGGER zenos_focus_timer AFTER UPDATE OF revision ON public.focus_rooms FOR EACH ROW WHEN(OLD.revision IS DISTINCT FROM NEW.revision) EXECUTE FUNCTION public.broadcast_focus_timer();
 ELSE RAISE WARNING 'Focus Room timer broadcasts require Supabase realtime.send support.'; END IF;
EXCEPTION WHEN insufficient_privilege THEN
 RAISE WARNING 'Focus Rooms Realtime setup was not applied: an authorized Supabase project administrator must apply this block to manage realtime.messages policies. Other migrations will continue. See docs/FOCUS_ROOMS.md.';
END $$;

-- Private weekly snapshots, one per Monday-based week; retain the newest eight.
CREATE TABLE IF NOT EXISTS public.weekly_recap_preferences (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
 time_zone text NOT NULL DEFAULT 'UTC',enabled boolean NOT NULL DEFAULT true,next_due_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS public.weekly_recaps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 week_start date NOT NULL CHECK(extract(isodow FROM week_start)=1),through_date date NOT NULL,
 time_zone text NOT NULL,tasks_done integer NOT NULL CHECK(tasks_done>=0),best_day date,best_day_count integer NOT NULL CHECK(best_day_count>=0),streak integer NOT NULL CHECK(streak BETWEEN 0 AND 3650),
 slipped_count integer NOT NULL CHECK(slipped_count>=0),slipped_tasks jsonb NOT NULL CHECK(jsonb_typeof(slipped_tasks)='array' AND jsonb_array_length(slipped_tasks)<=3),suggestion text NOT NULL CHECK(char_length(suggestion) BETWEEN 1 AND 300),
 kind text NOT NULL CHECK(kind IN ('manual','scheduled')),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,week_start),CHECK(through_date BETWEEN week_start AND week_start+6),CHECK(best_day IS NULL OR best_day BETWEEN week_start AND through_date)
);
CREATE INDEX IF NOT EXISTS weekly_recap_due_idx ON public.weekly_recap_preferences(next_due_at) WHERE enabled;
CREATE INDEX IF NOT EXISTS weekly_recaps_recent_idx ON public.weekly_recaps(user_id,week_start DESC);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['weekly_recap_preferences','weekly_recaps'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tab);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tab);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',tab);
  EXECUTE format('DROP POLICY IF EXISTS own_row ON public.%I',tab);
  EXECUTE format('CREATE POLICY own_row ON public.%I FOR ALL TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id)',tab);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.configure_weekly_recaps(p_user_id uuid,p_time_zone text,p_enabled boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE local_today date; upcoming_sunday date; due timestamptz; saved public.weekly_recap_preferences%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_time_zone) THEN RAISE EXCEPTION 'Invalid time zone'; END IF;
 local_today:=(now() AT TIME ZONE p_time_zone)::date;
 upcoming_sunday:=local_today+(7-extract(isodow FROM local_today)::integer);
 due:=(upcoming_sunday+time '18:00') AT TIME ZONE p_time_zone;
 INSERT INTO public.weekly_recap_preferences(user_id,time_zone,enabled,next_due_at) VALUES(p_user_id,p_time_zone,coalesce(p_enabled,true),due)
 ON CONFLICT(user_id) DO UPDATE SET time_zone=excluded.time_zone,enabled=coalesce(p_enabled,weekly_recap_preferences.enabled),
 next_due_at=CASE WHEN weekly_recap_preferences.time_zone<>excluded.time_zone OR (p_enabled=true AND NOT weekly_recap_preferences.enabled) THEN excluded.next_due_at ELSE weekly_recap_preferences.next_due_at END RETURNING * INTO saved;
 RETURN jsonb_build_object('timeZone',saved.time_zone,'enabled',saved.enabled,'nextDueAt',saved.next_due_at);
END $$;
CREATE OR REPLACE FUNCTION public.generate_weekly_recap(p_user_id uuid,p_automatic boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE pref public.weekly_recap_preferences%ROWTYPE; stamp timestamptz=now();today_local date;ending date;starting date;cutoff timestamptz;done_count integer;best date;best_count integer;streak_count integer;slipped integer;slipped_rows jsonb;advice text;saved public.weekly_recaps%ROWTYPE;
BEGIN
 SELECT * INTO pref FROM public.weekly_recap_preferences WHERE user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Configure weekly recaps first'; END IF;
 IF p_automatic AND (NOT pref.enabled OR pref.next_due_at>stamp) THEN RETURN NULL; END IF;
 today_local:=(stamp AT TIME ZONE pref.time_zone)::date;
 IF p_automatic THEN
  ending:=today_local-(extract(isodow FROM today_local)::integer%7);
  IF (ending+time '18:00') AT TIME ZONE pref.time_zone>stamp THEN ending:=ending-7; END IF;
 ELSE ending:=today_local; END IF;
 starting:=ending-(extract(isodow FROM ending)::integer-1);
 cutoff:=least(stamp,((ending+1)::timestamp AT TIME ZONE pref.time_zone));
 SELECT count(*) INTO done_count FROM public.tasks WHERE user_id=p_user_id AND status='done' AND completed_at>=(starting::timestamp AT TIME ZONE pref.time_zone) AND completed_at<cutoff;
 SELECT (completed_at AT TIME ZONE pref.time_zone)::date,count(*)::integer INTO best,best_count FROM public.tasks WHERE user_id=p_user_id AND status='done' AND completed_at>=(starting::timestamp AT TIME ZONE pref.time_zone) AND completed_at<cutoff GROUP BY 1 ORDER BY 2 DESC,1 LIMIT 1;
 WITH days AS(SELECT DISTINCT (completed_at AT TIME ZONE pref.time_zone)::date AS day FROM public.tasks WHERE user_id=p_user_id AND status='done' AND completed_at<cutoff AND completed_at>cutoff-interval '3652 days'),
 ordered AS(SELECT day,row_number() OVER(ORDER BY day DESC) AS n FROM days),latest AS(SELECT max(day) AS day FROM days)
 SELECT least(3650,count(*))::integer INTO streak_count FROM ordered,latest WHERE latest.day>=ending-1 AND latest.day-ordered.day=ordered.n-1;
 -- Source due dates are text; lexical comparison is safe only for canonical dates.
 SELECT count(*) INTO slipped FROM public.tasks t WHERE t.user_id=p_user_id AND t.status<>'done' AND t.date IN(SELECT (starting+n)::text FROM generate_series(0,6) AS days(n)) AND t.date>=starting::text AND t.date<=ending::text AND t.date<today_local::text;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',entry.id,'title',left(coalesce(nullif(btrim(entry.title),''),'Untitled task'),200)) ORDER BY entry.date,entry.id),'[]'::jsonb) INTO slipped_rows FROM(SELECT id,title,date FROM public.tasks t WHERE t.user_id=p_user_id AND t.status<>'done' AND t.date IN(SELECT (starting+n)::text FROM generate_series(0,6) AS days(n)) AND t.date>=starting::text AND t.date<=ending::text AND t.date<today_local::text ORDER BY date,id LIMIT 3)entry;
 advice:=CASE WHEN slipped>0 THEN 'Choose one slipped task and give it a smaller first step.' WHEN done_count=0 THEN 'Pick one small task for a ten-minute start.' WHEN streak_count>=5 THEN 'Keep your rhythm, and leave space for a proper break.' ELSE 'Protect a short focus block on your calendar next week.' END;
 INSERT INTO public.weekly_recaps(user_id,week_start,through_date,time_zone,tasks_done,best_day,best_day_count,streak,slipped_count,slipped_tasks,suggestion,kind)
 VALUES(p_user_id,starting,ending,pref.time_zone,done_count,best,coalesce(best_count,0),streak_count,slipped,slipped_rows,advice,CASE WHEN p_automatic THEN 'scheduled' ELSE 'manual' END)
 ON CONFLICT(user_id,week_start) DO UPDATE SET through_date=excluded.through_date,time_zone=excluded.time_zone,tasks_done=excluded.tasks_done,best_day=excluded.best_day,best_day_count=excluded.best_day_count,streak=excluded.streak,slipped_count=excluded.slipped_count,slipped_tasks=excluded.slipped_tasks,suggestion=excluded.suggestion,kind=excluded.kind,updated_at=stamp RETURNING * INTO saved;
 DELETE FROM public.weekly_recaps WHERE user_id=p_user_id AND id NOT IN(SELECT id FROM public.weekly_recaps WHERE user_id=p_user_id ORDER BY week_start DESC LIMIT 8);
 IF p_automatic THEN UPDATE public.weekly_recap_preferences SET next_due_at=((ending+7)+time '18:00') AT TIME ZONE pref.time_zone WHERE user_id=p_user_id; END IF;
 RETURN to_jsonb(saved)-'user_id';
END $$;
CREATE OR REPLACE FUNCTION public.run_due_weekly_recaps(p_limit integer DEFAULT 50)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE candidate record;processed integer=0;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'Invalid recap batch size'; END IF;
 FOR candidate IN SELECT user_id FROM public.weekly_recap_preferences WHERE enabled AND next_due_at<=now() ORDER BY next_due_at,user_id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
  PERFORM public.generate_weekly_recap(candidate.user_id,true);processed:=processed+1;
 END LOOP;
 RETURN processed;
END $$;
REVOKE ALL ON FUNCTION public.configure_weekly_recaps(uuid,text,boolean),public.generate_weekly_recap(uuid,boolean),public.run_due_weekly_recaps(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.configure_weekly_recaps(uuid,text,boolean),public.generate_weekly_recap(uuid,boolean),public.run_due_weekly_recaps(integer) TO service_role;

-- Server TTS has a separate paid-speech allowance; browser voices need no quota.
CREATE TABLE IF NOT EXISTS public.tts_usage (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,date date NOT NULL,
 requests integer NOT NULL DEFAULT 0 CHECK(requests>=0),PRIMARY KEY(user_id,date)
);
ALTER TABLE public.tts_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tts_usage FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.tts_usage TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.tts_usage TO service_role;
DROP POLICY IF EXISTS tts_usage_own ON public.tts_usage;
CREATE POLICY tts_usage_own ON public.tts_usage FOR ALL TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
CREATE OR REPLACE FUNCTION public.consume_tts_usage(p_user_id uuid,p_limit integer)
RETURNS TABLE(allowed boolean,date date,requests integer) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE today_utc date=(now() AT TIME ZONE 'UTC')::date;saved public.tts_usage%ROWTYPE;
BEGIN
 IF p_limit IS NULL OR p_limit<1 THEN RAISE EXCEPTION 'Invalid speech limit'; END IF;
 INSERT INTO public.tts_usage(user_id,date) VALUES(p_user_id,today_utc) ON CONFLICT ON CONSTRAINT tts_usage_pkey DO NOTHING;
 SELECT * INTO saved FROM public.tts_usage WHERE user_id=p_user_id AND tts_usage.date=today_utc FOR UPDATE;
 IF saved.requests>=p_limit THEN RETURN QUERY SELECT false,saved.date,saved.requests;RETURN; END IF;
 UPDATE public.tts_usage SET requests=tts_usage.requests+1 WHERE user_id=p_user_id AND tts_usage.date=today_utc RETURNING * INTO saved;
 RETURN QUERY SELECT true,saved.date,saved.requests;
END $$;
REVOKE ALL ON FUNCTION public.consume_tts_usage(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_tts_usage(uuid,integer) TO service_role;

-- Shared workspaces: membership writes only through authenticated transactional RPCs.
CREATE TABLE IF NOT EXISTS public.workspaces (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(char_length(btrim(name)) BETWEEN 1 AND 80),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.workspace_members (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,role text NOT NULL CHECK(role IN ('owner','member')),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,user_id)
);
CREATE TABLE IF NOT EXISTS public.workspace_invites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,email text NOT NULL CHECK(char_length(email)<=254),
 token_hash text NOT NULL UNIQUE,expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,accepted_at timestamptz,revoked boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_invites ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
UPDATE public.workspace_invites SET accepted_at=created_at WHERE accepted_by IS NOT NULL AND accepted_at IS NULL;
CREATE OR REPLACE FUNCTION public.is_workspace_member(p_workspace uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=auth.uid());
$$;
CREATE OR REPLACE FUNCTION public.is_workspace_owner(p_workspace uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.workspaces WHERE id=p_workspace AND user_id=auth.uid());
$$;
REVOKE ALL ON FUNCTION public.is_workspace_member(uuid),public.is_workspace_owner(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid),public.is_workspace_owner(uuid) TO authenticated,service_role;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['workspaces','workspace_members','workspace_invites'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tab);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tab);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',tab);
  EXECUTE format('DROP POLICY IF EXISTS workspace_read ON public.%I',tab);
 END LOOP;
END $$;
CREATE POLICY workspace_read ON public.workspaces FOR SELECT TO authenticated USING(public.is_workspace_member(id));
CREATE POLICY workspace_read ON public.workspace_members FOR SELECT TO authenticated USING(public.is_workspace_member(workspace_id));
-- Invite hashes and recipient email are visible only to the workspace owner.
CREATE POLICY workspace_read ON public.workspace_invites FOR SELECT TO authenticated USING(public.is_workspace_owner(workspace_id));
CREATE OR REPLACE FUNCTION public.create_workspace(p_name text) RETURNS public.workspaces
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved public.workspaces;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text,827));
 IF (SELECT count(*) FROM public.workspaces WHERE user_id=auth.uid())>=20 THEN RAISE EXCEPTION 'Workspace limit reached'; END IF;
 INSERT INTO public.workspaces(user_id,name) VALUES(auth.uid(),btrim(p_name)) RETURNING * INTO saved;
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(saved.id,auth.uid(),'owner');
 RETURN saved;
END $$;
CREATE OR REPLACE FUNCTION public.invite_workspace_member(p_workspace uuid,p_email text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE token text=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');saved public.workspace_invites;recipient text=lower(btrim(p_email));
BEGIN
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace FOR UPDATE;
 IF NOT public.is_workspace_owner(p_workspace) THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF recipient IS NULL OR char_length(recipient)>254 OR recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Valid email required'; END IF;
 IF (SELECT count(*) FROM public.workspace_invites WHERE workspace_id=p_workspace AND NOT revoked AND accepted_at IS NULL AND expires_at>now())>=100 THEN RAISE EXCEPTION 'Invite limit reached'; END IF;
 UPDATE public.workspace_invites SET revoked=true WHERE workspace_id=p_workspace AND workspace_invites.email=recipient AND accepted_at IS NULL;
 INSERT INTO public.workspace_invites(workspace_id,user_id,email,token_hash) VALUES(p_workspace,auth.uid(),recipient,encode(sha256(convert_to(token,'UTF8')),'hex')) RETURNING * INTO saved;
 RETURN jsonb_build_object('id',saved.id,'token',token,'expiresAt',saved.expires_at);
END $$;
CREATE OR REPLACE FUNCTION public.accept_workspace_invite(p_token text) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved public.workspace_invites;account jsonb;
BEGIN
 IF auth.uid() IS NULL OR p_token IS NULL OR char_length(p_token)<>64 THEN RAISE EXCEPTION 'Invalid invite'; END IF;
 SELECT to_jsonb(u) INTO account FROM auth.users u WHERE id=auth.uid();
 SELECT * INTO saved FROM public.workspace_invites WHERE token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid invite'; END IF;
 -- Same lock ordering as invite/removal prevents races with membership revocation.
 PERFORM 1 FROM public.workspaces WHERE id=saved.workspace_id FOR UPDATE;
 SELECT * INTO saved FROM public.workspace_invites WHERE id=saved.id FOR UPDATE;
 IF saved.revoked OR saved.expires_at<=now() OR lower(account->>'email') IS DISTINCT FROM saved.email
  OR coalesce(account->>'email_confirmed_at',account->>'confirmed_at','')='' THEN RAISE EXCEPTION 'Invite expired or email does not match a verified account'; END IF;
 IF saved.accepted_at IS NOT NULL AND saved.accepted_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Invite already accepted'; END IF;
 IF saved.accepted_by=auth.uid() THEN
  IF NOT public.is_workspace_member(saved.workspace_id) THEN RAISE EXCEPTION 'Invite already used'; END IF;
  RETURN saved.workspace_id;
 END IF;
 IF (SELECT count(*) FROM public.workspace_members WHERE workspace_id=saved.workspace_id)>=100 THEN RAISE EXCEPTION 'Member limit reached'; END IF;
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(saved.workspace_id,auth.uid(),'member') ON CONFLICT(workspace_id,user_id) DO NOTHING;
 UPDATE public.workspace_invites SET accepted_by=auth.uid(),accepted_at=now() WHERE id=saved.id;
 RETURN saved.workspace_id;
END $$;
CREATE OR REPLACE FUNCTION public.remove_workspace_member(p_workspace uuid,p_user uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace FOR UPDATE;
 IF NOT public.is_workspace_owner(p_workspace) AND auth.uid() IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF NOT public.is_workspace_member(p_workspace) THEN RAISE EXCEPTION 'Membership required'; END IF;
 IF EXISTS(SELECT 1 FROM public.workspaces WHERE id=p_workspace AND user_id=p_user) THEN RAISE EXCEPTION 'Owner cannot leave'; END IF;
 DELETE FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=p_user;
 UPDATE public.workspace_invites SET revoked=true WHERE workspace_id=p_workspace AND accepted_by=p_user;
END $$;
CREATE OR REPLACE FUNCTION public.revoke_workspace_invite(p_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.workspace_invites SET revoked=true WHERE id=p_id AND public.is_workspace_owner(workspace_id);
 IF NOT FOUND THEN RAISE EXCEPTION 'Owner required'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.create_workspace(text),public.invite_workspace_member(uuid,text),public.accept_workspace_invite(text),public.remove_workspace_member(uuid,uuid),public.revoke_workspace_invite(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_workspace(text),public.invite_workspace_member(uuid,text),public.accept_workspace_invite(text),public.remove_workspace_member(uuid,uuid),public.revoke_workspace_invite(uuid) TO authenticated;

-- Existing personal data remains NULL-scoped. Scope/creator cannot be changed later.
CREATE OR REPLACE FUNCTION public.guard_workspace_row() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user IN ('authenticated','anon') AND TG_OP='UPDATE' AND (NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
  RAISE EXCEPTION 'Row workspace and creator are immutable';
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE tab text;pol record; BEGIN
 FOREACH tab IN ARRAY ARRAY['tasks','categories','meetings','vault_items'] LOOP
  EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE',tab);
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(workspace_id)',tab||'_workspace_idx',tab);
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=tab LOOP
   EXECUTE format('DROP POLICY %I ON public.%I',pol.policyname,tab);
  END LOOP;
  EXECUTE format('CREATE POLICY workspace_rows_read ON public.%I FOR SELECT TO authenticated USING ((workspace_id IS NULL AND user_id=auth.uid()) OR public.is_workspace_member(workspace_id))',tab);
  EXECUTE format('CREATE POLICY workspace_rows_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id=auth.uid() AND (workspace_id IS NULL OR public.is_workspace_member(workspace_id)))',tab);
  EXECUTE format('CREATE POLICY workspace_rows_update ON public.%I FOR UPDATE TO authenticated USING ((workspace_id IS NULL AND user_id=auth.uid()) OR public.is_workspace_member(workspace_id)) WITH CHECK ((workspace_id IS NULL AND user_id=auth.uid()) OR public.is_workspace_member(workspace_id))',tab);
  EXECUTE format('CREATE POLICY workspace_rows_delete ON public.%I FOR DELETE TO authenticated USING ((workspace_id IS NULL AND user_id=auth.uid()) OR public.is_workspace_member(workspace_id))',tab);
  EXECUTE format('DROP TRIGGER IF EXISTS guard_workspace_scope ON public.%I',tab);
  EXECUTE format('CREATE TRIGGER guard_workspace_scope BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_workspace_row()',tab);
 END LOOP;
END $$;
ALTER TABLE public.dante_messages ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
DROP POLICY IF EXISTS "Users see own dante_messages" ON public.dante_messages;
CREATE POLICY "Users see own dante_messages" ON public.dante_messages FOR ALL TO authenticated
 USING(user_id=auth.uid() AND (workspace_id IS NULL OR public.is_workspace_member(workspace_id)))
 WITH CHECK(user_id=auth.uid() AND (workspace_id IS NULL OR public.is_workspace_member(workspace_id)));
DROP TRIGGER IF EXISTS guard_workspace_scope ON public.dante_messages;
CREATE TRIGGER guard_workspace_scope BEFORE UPDATE ON public.dante_messages FOR EACH ROW EXECUTE FUNCTION public.guard_workspace_row();

-- Shared broadcasts carry invalidations only; revoked clients cannot receive row content.
CREATE OR REPLACE FUNCTION public.broadcast_workspace_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;scope uuid=(item->>'workspace_id')::uuid;
BEGIN
 IF scope IS NOT NULL THEN
  PERFORM realtime.send(jsonb_build_object('workspace_id',scope),'changed','zenos:shared:'||scope::text,true);
 ELSIF TG_OP='UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
  PERFORM realtime.broadcast_changes('zenos:workspace:'||OLD.user_id::text,'DELETE','DELETE',TG_TABLE_NAME,TG_TABLE_SCHEMA,NULL,OLD);
  PERFORM realtime.broadcast_changes('zenos:workspace:'||NEW.user_id::text,'INSERT','INSERT',TG_TABLE_NAME,TG_TABLE_SCHEMA,NEW,NULL);
 ELSIF TG_OP='DELETE' THEN
  PERFORM realtime.broadcast_changes('zenos:workspace:'||OLD.user_id::text,TG_OP,TG_OP,TG_TABLE_NAME,TG_TABLE_SCHEMA,NEW,OLD);
 ELSE
  PERFORM realtime.broadcast_changes('zenos:workspace:'||NEW.user_id::text,TG_OP,TG_OP,TG_TABLE_NAME,TG_TABLE_SCHEMA,NEW,OLD);
 END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION public.can_read_shared_topic(p_topic text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.workspace_members WHERE user_id=auth.uid() AND p_topic='zenos:shared:'||workspace_id::text);
$$;
REVOKE ALL ON FUNCTION public.can_read_shared_topic(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_read_shared_topic(text) TO anon,authenticated;
DO $$ DECLARE tab text; BEGIN
 IF to_regclass('realtime.messages') IS NULL THEN RETURN; END IF;
 IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN RETURN; END IF;
 DROP POLICY IF EXISTS zenos_shared_read ON realtime.messages;
 CREATE POLICY zenos_shared_read ON realtime.messages FOR SELECT TO authenticated USING(extension='broadcast' AND topic=(SELECT realtime.topic()) AND public.can_read_shared_topic(topic));
 DROP POLICY IF EXISTS zenos_shared_isolation ON realtime.messages;
 CREATE POLICY zenos_shared_isolation ON realtime.messages AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(topic NOT LIKE 'zenos:shared:%' OR (auth.uid() IS NOT NULL AND extension='broadcast' AND topic=(SELECT realtime.topic()) AND public.can_read_shared_topic(topic)));
 DROP POLICY IF EXISTS zenos_shared_no_write ON realtime.messages;
 CREATE POLICY zenos_shared_no_write ON realtime.messages AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK(topic NOT LIKE 'zenos:shared:%');
 DROP POLICY IF EXISTS zenos_shared_no_update ON realtime.messages;
 CREATE POLICY zenos_shared_no_update ON realtime.messages AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING(topic NOT LIKE 'zenos:shared:%') WITH CHECK(topic NOT LIKE 'zenos:shared:%');
 FOREACH tab IN ARRAY ARRAY['tasks','categories','meetings','vault_items'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS zenos_workspace_broadcast ON public.%I',tab);
  EXECUTE format('CREATE TRIGGER zenos_workspace_broadcast AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.broadcast_workspace_change()',tab);
 END LOOP;
EXCEPTION WHEN insufficient_privilege THEN
 RAISE WARNING 'Shared workspace Realtime setup deferred: an owner of realtime.messages must apply this block. Cloud reads remain protected by RLS; clients also refresh on focus and periodically.';
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS shared_task_successor ON public.tasks(workspace_id,recurrence_source_id) WHERE workspace_id IS NOT NULL;
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
  INSERT INTO public.tasks(workspace_id, user_id, title, cat, status, date, reminder, note, progress, steps, completed_at, recurrence, recurrence_day, recurrence_source_id)
  VALUES (NEW.workspace_id, CASE WHEN NEW.workspace_id IS NULL THEN NEW.user_id ELSE coalesce(auth.uid(),NEW.user_id) END, NEW.title, NEW.cat, 'todo', next_due::text, next_reminder, NEW.note, 0,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('label', step->>'label', 'done', false))
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.steps) = 'array' THEN NEW.steps ELSE '[]'::jsonb END) step
      WHERE jsonb_typeof(step) = 'object' AND step ? 'label'), '[]'::jsonb),
    NULL, NEW.recurrence, anchor_day, NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_source_document(kind text, item jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $fn$
DECLARE title text; body text;
BEGIN
  IF item->>'workspace_id' IS NOT NULL THEN RETURN NULL; END IF;
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

DO $$ BEGIN IF to_regclass('public.embeddings') IS NULL THEN RETURN; END IF;
DELETE FROM public.embeddings e WHERE (e.source_type='task' AND EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=e.source_id AND t.workspace_id IS NOT NULL)) OR (e.source_type='meeting' AND EXISTS(SELECT 1 FROM public.meetings t WHERE t.id=e.source_id AND t.workspace_id IS NOT NULL)) OR (e.source_type='vault' AND EXISTS(SELECT 1 FROM public.vault_items t WHERE t.id=e.source_id AND t.workspace_id IS NOT NULL));
END $$;

CREATE OR REPLACE FUNCTION public.lock_workspace_member(p_workspace uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.is_workspace_member(p_workspace) THEN RAISE EXCEPTION 'Workspace membership required'; END IF;
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace FOR SHARE;
 IF NOT public.is_workspace_member(p_workspace) THEN RAISE EXCEPTION 'Workspace membership required'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.lock_workspace_member(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lock_workspace_member(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.save_workspace_exam_plan(p_owner uuid, p_draft jsonb, p_sessions jsonb, p_expected jsonb DEFAULT NULL, p_start_date date DEFAULT CURRENT_DATE, p_workspace uuid DEFAULT NULL)
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
  IF p_workspace IS NOT NULL AND NOT public.is_workspace_member(p_workspace) THEN RAISE EXCEPTION 'Workspace membership required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(coalesce(p_workspace,p_owner)::text || ':exam-plans'));
  IF p_workspace IS NOT NULL THEN PERFORM public.lock_workspace_member(p_workspace); END IF;
  IF p_start_date IS NULL OR budget IS NULL OR p_draft->>'examDate' IS NULL OR p_sessions IS NULL OR plan_id IS NULL OR length(plan_id) > 100 OR nullif(trim(p_draft->>'name'),'') IS NULL
     OR length(p_draft->>'name') > 160 OR budget < 1 OR budget > 1440
     OR jsonb_typeof(p_sessions) <> 'array' OR jsonb_array_length(p_sessions) NOT BETWEEN 1 AND 100
     OR p_start_date NOT BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + 1
     OR (p_draft->>'examDate')::date <= p_start_date THEN RAISE EXCEPTION 'Invalid exam plan'; END IF;
  PERFORM 1 FROM tasks WHERE ((p_workspace IS NULL AND user_id=p_owner AND workspace_id IS NULL) OR (p_workspace IS NOT NULL AND workspace_id=p_workspace)) AND exam_plan->>'id' = plan_id FOR UPDATE;
  IF p_expected IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',id::text,'date',date,'status',status,'steps',coalesce(steps,'[]'::jsonb),'exam_plan',exam_plan) ORDER BY id::text),'[]'::jsonb)
      INTO current_snapshot FROM tasks
      WHERE ((p_workspace IS NULL AND user_id=p_owner AND workspace_id IS NULL) OR (p_workspace IS NOT NULL AND workspace_id=p_workspace)) AND exam_plan->>'id' = plan_id AND status <> 'done'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(steps,'[]'::jsonb)) step WHERE step->>'id' = exam_plan->>'topicId' AND step->>'done' = 'true');
    IF current_snapshot <> p_expected THEN RAISE EXCEPTION 'Plan changed. Refresh and try again.'; END IF;
    IF jsonb_array_length(p_expected) <> jsonb_array_length(p_sessions) THEN RAISE EXCEPTION 'Topic mismatch'; END IF;
  END IF;
  SELECT * INTO cat_row FROM categories WHERE ((p_workspace IS NULL AND user_id=p_owner AND workspace_id IS NULL) OR (p_workspace IS NOT NULL AND workspace_id=p_workspace)) AND lower(trim(label)) = 'exams' ORDER BY id LIMIT 1;
  IF cat_row.id IS NULL THEN
    INSERT INTO categories(workspace_id,user_id,label,color,slug) VALUES(p_workspace,p_owner,'Exams','#8151eb','exams') RETURNING * INTO cat_row;
  END IF;
  IF p_expected IS NULL AND EXISTS(SELECT 1 FROM tasks WHERE ((p_workspace IS NULL AND user_id=p_owner AND workspace_id IS NULL) OR (p_workspace IS NOT NULL AND workspace_id=p_workspace)) AND exam_plan->>'id' = plan_id) THEN
    RETURN jsonb_build_object('category',to_jsonb(cat_row),'tasks',(SELECT jsonb_agg(to_jsonb(t)) FROM tasks t WHERE ((p_workspace IS NULL AND user_id=p_owner AND workspace_id IS NULL) OR (p_workspace IS NOT NULL AND workspace_id=p_workspace)) AND exam_plan->>'id' = plan_id));
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
      INSERT INTO tasks(workspace_id,user_id,title,cat,status,date,reminder,note,progress,steps,exam_plan)
        VALUES(p_workspace,p_owner,trim(p_draft->>'name') || ': ' || trim(item->>'topic'),cat_row.id,'todo',item->>'date','','Study session: ' || (item->>'minutes') || ' minutes',0,
          jsonb_build_array(jsonb_build_object('id',item->>'topicId','label',trim(item->>'topic'),'done',false)),metadata);
    ELSE
      UPDATE tasks SET date = item->>'date', exam_plan = metadata
        WHERE ((p_workspace IS NULL AND user_id=p_owner AND workspace_id IS NULL) OR (p_workspace IS NOT NULL AND workspace_id=p_workspace)) AND exam_plan->>'id' = plan_id AND exam_plan->>'topicId' = item->>'topicId'
        AND id::text IN (SELECT x->>'id' FROM jsonb_array_elements(p_expected) x);
      IF NOT FOUND THEN RAISE EXCEPTION 'Topic changed'; END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('category',to_jsonb(cat_row),'tasks',(SELECT jsonb_agg(to_jsonb(t)) FROM tasks t WHERE ((p_workspace IS NULL AND user_id=p_owner AND workspace_id IS NULL) OR (p_workspace IS NOT NULL AND workspace_id=p_workspace)) AND exam_plan->>'id' = plan_id));
END; $$;

REVOKE ALL ON FUNCTION public.save_workspace_exam_plan(uuid,jsonb,jsonb,jsonb,date,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_workspace_exam_plan(uuid,jsonb,jsonb,jsonb,date,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.save_exam_plan(p_owner uuid,p_draft jsonb,p_sessions jsonb,p_expected jsonb DEFAULT NULL,p_start_date date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT public.save_workspace_exam_plan(p_owner,p_draft,p_sessions,p_expected,p_start_date,NULL); $$;

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
  SELECT id::text INTO category FROM public.categories WHERE user_id = auth.uid() AND workspace_id IS NULL ORDER BY (lower(label) = 'other') DESC,id LIMIT 1;
  INSERT INTO public.tasks(user_id,title,cat,status,date,reminder,note,progress,steps)
    VALUES(auth.uid(),item->>'title',coalesce(category,'other'),'todo',p_date::text,'','From lecture: ' || saved.title,0,'[]') RETURNING * INTO added;
  UPDATE public.lectures SET action_items = jsonb_set(action_items, ARRAY[p_index::text,'task_id'], to_jsonb(added.id::text), true)
    WHERE id = saved.id RETURNING * INTO saved;
  RETURN jsonb_build_object('lecture',to_jsonb(saved),'task',to_jsonb(added));
END;
$$;

CREATE OR REPLACE FUNCTION public.focus_completion_streak(p_user_id uuid,p_time_zone text)
RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 WITH days AS (SELECT DISTINCT (completed_at AT TIME ZONE p_time_zone)::date AS day FROM public.tasks WHERE user_id=p_user_id AND workspace_id IS NULL AND status='done' AND completed_at IS NOT NULL AND completed_at<=now() AND completed_at>now()-interval '3652 days'),
 ordered AS (SELECT day,row_number() OVER(ORDER BY day DESC) AS n FROM days),
 latest AS (SELECT max(day) AS day FROM days)
 SELECT least(3650,count(*))::integer FROM ordered,latest WHERE latest.day>=(now() AT TIME ZONE p_time_zone)::date-1 AND latest.day-ordered.day=ordered.n-1;
$$;

CREATE OR REPLACE FUNCTION public.generate_weekly_recap(p_user_id uuid,p_automatic boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE pref public.weekly_recap_preferences%ROWTYPE; stamp timestamptz=now();today_local date;ending date;starting date;cutoff timestamptz;done_count integer;best date;best_count integer;streak_count integer;slipped integer;slipped_rows jsonb;advice text;saved public.weekly_recaps%ROWTYPE;
BEGIN
 SELECT * INTO pref FROM public.weekly_recap_preferences WHERE user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Configure weekly recaps first'; END IF;
 IF p_automatic AND (NOT pref.enabled OR pref.next_due_at>stamp) THEN RETURN NULL; END IF;
 today_local:=(stamp AT TIME ZONE pref.time_zone)::date;
 IF p_automatic THEN
  ending:=today_local-(extract(isodow FROM today_local)::integer%7);
  IF (ending+time '18:00') AT TIME ZONE pref.time_zone>stamp THEN ending:=ending-7; END IF;
 ELSE ending:=today_local; END IF;
 starting:=ending-(extract(isodow FROM ending)::integer-1);
 cutoff:=least(stamp,((ending+1)::timestamp AT TIME ZONE pref.time_zone));
 SELECT count(*) INTO done_count FROM public.tasks WHERE user_id=p_user_id AND workspace_id IS NULL AND status='done' AND completed_at>=(starting::timestamp AT TIME ZONE pref.time_zone) AND completed_at<cutoff;
 SELECT (completed_at AT TIME ZONE pref.time_zone)::date,count(*)::integer INTO best,best_count FROM public.tasks WHERE user_id=p_user_id AND workspace_id IS NULL AND status='done' AND completed_at>=(starting::timestamp AT TIME ZONE pref.time_zone) AND completed_at<cutoff GROUP BY 1 ORDER BY 2 DESC,1 LIMIT 1;
 WITH days AS(SELECT DISTINCT (completed_at AT TIME ZONE pref.time_zone)::date AS day FROM public.tasks WHERE user_id=p_user_id AND workspace_id IS NULL AND status='done' AND completed_at<cutoff AND completed_at>cutoff-interval '3652 days'),
 ordered AS(SELECT day,row_number() OVER(ORDER BY day DESC) AS n FROM days),latest AS(SELECT max(day) AS day FROM days)
 SELECT least(3650,count(*))::integer INTO streak_count FROM ordered,latest WHERE latest.day>=ending-1 AND latest.day-ordered.day=ordered.n-1;
 -- Source due dates are text; lexical comparison is safe only for canonical dates.
 SELECT count(*) INTO slipped FROM public.tasks t WHERE t.user_id=p_user_id AND t.workspace_id IS NULL AND t.status<>'done' AND t.date IN(SELECT (starting+n)::text FROM generate_series(0,6) AS days(n)) AND t.date>=starting::text AND t.date<=ending::text AND t.date<today_local::text;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',entry.id,'title',left(coalesce(nullif(btrim(entry.title),''),'Untitled task'),200)) ORDER BY entry.date,entry.id),'[]'::jsonb) INTO slipped_rows FROM(SELECT id,title,date FROM public.tasks t WHERE t.user_id=p_user_id AND t.workspace_id IS NULL AND t.status<>'done' AND t.date IN(SELECT (starting+n)::text FROM generate_series(0,6) AS days(n)) AND t.date>=starting::text AND t.date<=ending::text AND t.date<today_local::text ORDER BY date,id LIMIT 3)entry;
 advice:=CASE WHEN slipped>0 THEN 'Choose one slipped task and give it a smaller first step.' WHEN done_count=0 THEN 'Pick one small task for a ten-minute start.' WHEN streak_count>=5 THEN 'Keep your rhythm, and leave space for a proper break.' ELSE 'Protect a short focus block on your calendar next week.' END;
 INSERT INTO public.weekly_recaps(user_id,week_start,through_date,time_zone,tasks_done,best_day,best_day_count,streak,slipped_count,slipped_tasks,suggestion,kind)
 VALUES(p_user_id,starting,ending,pref.time_zone,done_count,best,coalesce(best_count,0),streak_count,slipped,slipped_rows,advice,CASE WHEN p_automatic THEN 'scheduled' ELSE 'manual' END)
 ON CONFLICT(user_id,week_start) DO UPDATE SET through_date=excluded.through_date,time_zone=excluded.time_zone,tasks_done=excluded.tasks_done,best_day=excluded.best_day,best_day_count=excluded.best_day_count,streak=excluded.streak,slipped_count=excluded.slipped_count,slipped_tasks=excluded.slipped_tasks,suggestion=excluded.suggestion,kind=excluded.kind,updated_at=stamp RETURNING * INTO saved;
 DELETE FROM public.weekly_recaps WHERE user_id=p_user_id AND id NOT IN(SELECT id FROM public.weekly_recaps WHERE user_id=p_user_id ORDER BY week_start DESC LIMIT 8);
 IF p_automatic THEN UPDATE public.weekly_recap_preferences SET next_due_at=((ending+7)+time '18:00') AT TIME ZONE pref.time_zone WHERE user_id=p_user_id; END IF;
 RETURN to_jsonb(saved)-'user_id';
END $$;

-- USOS OAuth accounts. Token ciphertext is service-role-only, even for the owner.
CREATE TABLE IF NOT EXISTS public.usos_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 usos_user_id text NOT NULL UNIQUE CHECK(char_length(usos_user_id) BETWEEN 1 AND 80),
 user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
 usos_base_url text NOT NULL,
 usos_access_token text NOT NULL CHECK(usos_access_token ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'),
 usos_access_secret text NOT NULL CHECK(usos_access_secret ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.usos_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.usos_accounts FROM PUBLIC,anon,authenticated;
REVOKE SELECT(usos_access_token,usos_access_secret,usos_base_url) ON public.usos_accounts FROM PUBLIC,anon,authenticated;
GRANT SELECT(id,user_id,usos_user_id,created_at) ON public.usos_accounts TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.usos_accounts TO service_role;
DROP POLICY IF EXISTS usos_accounts_own ON public.usos_accounts;
CREATE POLICY usos_accounts_own ON public.usos_accounts FOR SELECT TO authenticated USING(auth.uid()=user_id);

CREATE OR REPLACE FUNCTION public.find_usos_email_owner(p_email text)
RETURNS TABLE(id uuid,email text,confirmed boolean) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT u.id,to_jsonb(u)->>'email',coalesce(to_jsonb(u)->>'email_confirmed_at',to_jsonb(u)->>'confirmed_at','')<>''
 FROM auth.users u WHERE lower(to_jsonb(u)->>'email')=lower(btrim(p_email)) LIMIT 2;
$$;
REVOKE ALL ON FUNCTION public.find_usos_email_owner(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.find_usos_email_owner(text) TO service_role;

-- Never reassign a linked identity or replace another identity on an app account.
CREATE OR REPLACE FUNCTION public.save_usos_account(p_usos_id text,p_user_id uuid,p_base text,p_token text,p_secret text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 INSERT INTO public.usos_accounts(usos_user_id,user_id,usos_base_url,usos_access_token,usos_access_secret)
 VALUES(p_usos_id,p_user_id,p_base,p_token,p_secret)
 ON CONFLICT(usos_user_id) DO UPDATE SET usos_access_token=excluded.usos_access_token,usos_access_secret=excluded.usos_access_secret
 WHERE usos_accounts.user_id=p_user_id AND usos_accounts.usos_base_url=p_base;
 IF NOT FOUND THEN RAISE EXCEPTION 'USOS identity already linked'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.save_usos_account(text,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_usos_account(text,uuid,text,text,text) TO service_role;
