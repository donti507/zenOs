-- Users are handled by Supabase Auth automatically
-- Just create tables for app data:

create table tasks (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  title text not null,
  cat text,
  status text default 'todo',
  date text,
  reminder text,
  note text,
  progress int default 0,
  steps jsonb default '[]',
  created_at timestamp default now()
);

create table categories (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  label text not null,
  color text,
  slug text
);

create table vault_items (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  type text,
  name text,
  detail text,
  url text,
  added_at timestamp default now()
);

-- Row Level Security (each user sees only their own data)
alter table tasks enable row level security;
alter table categories enable row level security;
alter table vault_items enable row level security;

create policy "Users see own tasks" on tasks for all using (auth.uid() = user_id);
create policy "Users see own categories" on categories for all using (auth.uid() = user_id);
create policy "Users see own vault" on vault_items for all using (auth.uid() = user_id);
