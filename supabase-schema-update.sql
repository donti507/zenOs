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
    INSERT INTO public.tasks(id, user_id, title, cat, status, date, reminder, note, progress, steps, completed_at, recurrence, recurrence_day, recurrence_source_id)
    VALUES (COALESCE((task_map->>(item->>'id'))::uuid, gen_random_uuid()), uid, item->>'title', COALESCE(category_map->>(item->>'cat'), item->>'cat', 'other'),
      COALESCE(item->>'status', 'todo'), item->>'date', item->>'reminder', item->>'note',
      COALESCE((item->>'progress')::integer, 0), COALESCE(item->'steps', '[]'::jsonb), (item->>'completedAt')::timestamptz,
      COALESCE(item->>'recurrence', 'none'), (item->>'recurrenceDay')::smallint, (task_map->>(item->>'recurrenceSourceId'))::uuid);
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
