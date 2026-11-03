create table public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 6000),
  response jsonb check (response is null or jsonb_typeof(response) = 'object'),
  context_kind text check (context_kind is null or context_kind in ('owned_plant', 'discovery', 'species', 'general')),
  context_id uuid,
  context_ref text not null check (char_length(context_ref) between 1 and 240),
  created_at timestamptz not null default now(),
  foreign key (conversation_id, owner_id)
    references public.assistant_conversations(id, owner_id) on delete cascade,
  check ((role = 'assistant') = (response is not null))
);

create table public.assistant_usage (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'configured',
  model text not null default '',
  status text not null default 'reserved' check (status in ('reserved', 'succeeded', 'provider_error', 'invalid_output')),
  prompt_tokens integer check (prompt_tokens is null or prompt_tokens >= 0),
  completion_tokens integer check (completion_tokens is null or completion_tokens >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index assistant_conversations_owner_updated_idx
  on public.assistant_conversations(owner_id, updated_at desc);
create index assistant_messages_owner_conversation_idx
  on public.assistant_messages(owner_id, conversation_id, created_at);
create index assistant_usage_owner_created_idx
  on public.assistant_usage(owner_id, created_at desc);

alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages enable row level security;
alter table public.assistant_usage enable row level security;

create policy "Owners can read assistant conversations"
  on public.assistant_conversations for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Owners can delete assistant conversations"
  on public.assistant_conversations for delete to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Owners can read assistant messages"
  on public.assistant_messages for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Owners can read assistant usage"
  on public.assistant_usage for select to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on public.assistant_conversations, public.assistant_messages, public.assistant_usage from anon, authenticated;
grant select, delete on public.assistant_conversations to authenticated;
grant select on public.assistant_messages, public.assistant_usage to authenticated;
grant all on public.assistant_conversations, public.assistant_messages, public.assistant_usage to service_role;

create or replace function public.reserve_plant_assistant_request(p_owner_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usage_id uuid;
  v_minute_count integer;
  v_day_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 0));

  select count(*) into v_minute_count
  from public.assistant_usage
  where owner_id = p_owner_id and created_at >= now() - interval '1 minute';

  select count(*) into v_day_count
  from public.assistant_usage
  where owner_id = p_owner_id and created_at >= now() - interval '1 day';

  if v_minute_count >= 5 or v_day_count >= 50 then
    return jsonb_build_object('allowed', false, 'remaining', greatest(0, 5 - v_minute_count));
  end if;

  insert into public.assistant_usage(owner_id) values (p_owner_id) returning id into v_usage_id;
  return jsonb_build_object('allowed', true, 'usage_id', v_usage_id, 'remaining', greatest(0, 4 - v_minute_count));
end;
$$;

revoke all on function public.reserve_plant_assistant_request(uuid) from public, anon, authenticated;
grant execute on function public.reserve_plant_assistant_request(uuid) to service_role;
