create table if not exists public.rdash_ingests (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'claude',
  payload jsonb not null,
  received_at timestamptz not null default now()
);

-- RLS on with no policies: only the service role (server) can read/write.
alter table public.rdash_ingests enable row level security;
