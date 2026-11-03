alter table public.discoveries
  add column external_taxonomy_ids jsonb not null default '{}'::jsonb
    check (jsonb_typeof(external_taxonomy_ids) = 'object'),
  add column identification_match_score numeric(6, 5)
    check (identification_match_score is null or identification_match_score between 0 and 1),
  add column identification_provider_version text
    check (identification_provider_version is null or char_length(identification_provider_version) <= 120),
  add column identification_was_corrected boolean not null default false;

create table public.identification_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider = 'plantnet'),
  status text not null check (status in (
    'pending', 'succeeded', 'invalid_upload', 'not_a_plant',
    'provider_timeout', 'provider_error', 'missing_credentials'
  )),
  image_count smallint not null default 0 check (image_count between 0 and 5),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  provider_version text check (provider_version is null or char_length(provider_version) <= 120),
  estimated_cost_eur numeric(10, 6) check (estimated_cost_eur is null or estimated_cost_eur >= 0),
  error_code text check (error_code is null or char_length(error_code) <= 80),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index identification_requests_owner_recent_idx
  on public.identification_requests (owner_id, created_at desc);
create index identification_requests_provider_recent_idx
  on public.identification_requests (provider, created_at desc);
create index identification_requests_pending_idx
  on public.identification_requests (created_at)
  where status = 'pending';

alter table public.identification_requests enable row level security;
revoke all on public.identification_requests from anon, authenticated;
grant select, insert, update, delete on public.identification_requests to service_role;

create or replace function public.reserve_plant_identification(
  p_owner_id uuid,
  p_user_per_minute integer,
  p_user_per_day integer,
  p_provider_per_day integer,
  p_max_concurrent integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_request_id uuid;
  v_user_minute_count integer;
  v_user_day_count integer;
  v_provider_day_count integer;
  v_pending_count integer;
begin
  if p_owner_id is null
    or p_user_per_minute is null or p_user_per_minute < 1
    or p_user_per_day is null
    or p_user_per_day < 1
    or p_provider_per_day is null or p_provider_per_day < 1
    or p_max_concurrent is null or p_max_concurrent < 1 then
    raise exception 'Invalid plant identification reservation parameters';
  end if;

  perform pg_advisory_xact_lock(hashtext('plant-identification-global'));

  select count(*)::integer into v_user_minute_count
  from public.identification_requests
  where owner_id = p_owner_id
    and created_at >= now() - interval '1 minute';
  if v_user_minute_count >= p_user_per_minute then
    return jsonb_build_object('allowed', false, 'reason', 'user_per_minute');
  end if;

  select count(*)::integer into v_user_day_count
  from public.identification_requests
  where owner_id = p_owner_id
    and created_at >= now() - interval '24 hours';
  if v_user_day_count >= p_user_per_day then
    return jsonb_build_object('allowed', false, 'reason', 'user_per_day');
  end if;

  select count(*)::integer into v_provider_day_count
  from public.identification_requests
  where provider = 'plantnet'
    and created_at >= now() - interval '24 hours';
  if v_provider_day_count >= p_provider_per_day then
    return jsonb_build_object('allowed', false, 'reason', 'provider_daily_limit');
  end if;

  select count(*)::integer into v_pending_count
  from public.identification_requests
  where provider = 'plantnet'
    and status = 'pending'
    and created_at >= now() - interval '2 minutes';
  if v_pending_count >= p_max_concurrent then
    return jsonb_build_object('allowed', false, 'reason', 'provider_concurrency_limit');
  end if;

  insert into public.identification_requests (owner_id, provider, status)
  values (p_owner_id, 'plantnet', 'pending')
  returning id into v_request_id;

  return jsonb_build_object('allowed', true, 'request_id', v_request_id);
end;
$$;

revoke all on function public.reserve_plant_identification(uuid, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_plant_identification(uuid, integer, integer, integer, integer)
  to service_role;
