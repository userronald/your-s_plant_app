alter table public.plant_instances
  add column substrate_type text not null default ''
    check (char_length(substrate_type) <= 100),
  add column care_season text
    check (care_season is null or care_season in ('spring', 'summer', 'autumn', 'winter'));

alter table public.care_events
  add column soil_moisture text
    check (soil_moisture is null or soil_moisture in ('dry', 'slightly_moist', 'wet')),
  add column plant_condition text
    check (plant_condition is null or plant_condition in ('usual', 'changed')),
  add column recommendation_reason text not null default ''
    check (char_length(recommendation_reason) <= 1000);

alter table public.care_tasks
  add column snoozed_until timestamptz,
  add column skipped_at timestamptz,
  add column rescheduled_at timestamptz;

update public.care_tasks
set skipped_at = coalesce(completed_at, created_at)
where status = 'skipped' and skipped_at is null;

alter table public.care_tasks
  add constraint care_tasks_skipped_at_status_check
    check ((status = 'skipped') = (skipped_at is not null)),
  add constraint care_tasks_snoozed_pending_check
    check (snoozed_until is null or status = 'pending');

create unique index care_tasks_one_pending_soil_check_per_plant_idx
  on public.care_tasks (plant_id)
  where task_type = 'soil_check' and status = 'pending';

create table public.care_guidance (
  id uuid primary key default gen_random_uuid(),
  taxon_id uuid not null unique references public.taxa(id) on delete cascade,
  min_check_interval_days integer not null check (min_check_interval_days between 1 and 30),
  max_check_interval_days integer not null check (max_check_interval_days between min_check_interval_days and 60),
  source_title text not null check (char_length(source_title) between 1 and 240),
  source_url text not null check (source_url ~ '^https://'),
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index care_guidance_taxon_idx on public.care_guidance(taxon_id);
create trigger care_guidance_set_updated_at
  before update on public.care_guidance
  for each row execute function public.set_updated_at();

alter table public.care_guidance enable row level security;
revoke all on public.care_guidance from anon, authenticated;
grant select on public.care_guidance to authenticated;
create policy "care_guidance_authenticated_read"
  on public.care_guidance for select to authenticated using (true);

drop policy "care_events_owner_all" on public.care_events;
create policy "care_events_owner_read" on public.care_events for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "care_events_owner_insert_non_water" on public.care_events for insert to authenticated
  with check (owner_id = (select auth.uid()) and event_type <> 'water');
create policy "care_events_owner_update_non_water" on public.care_events for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and event_type <> 'water');
create policy "care_events_owner_delete" on public.care_events for delete to authenticated
  using (owner_id = (select auth.uid()));

create or replace function public.record_care_check(
  p_task_id uuid,
  p_soil_moisture text,
  p_plant_condition text,
  p_action text,
  p_note text,
  p_recommendation_reason text,
  p_next_interval_days integer,
  p_next_due_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_plant_id uuid;
  v_taxon_id uuid;
  v_min_interval integer := 3;
  v_max_interval integer := 21;
  v_event_id uuid;
  v_next_task_id uuid;
  v_now timestamptz := now();
begin
  if v_owner_id is null
    or p_soil_moisture is null or p_soil_moisture not in ('dry', 'slightly_moist', 'wet')
    or p_plant_condition is null or p_plant_condition not in ('usual', 'changed')
    or p_action is null or p_action not in ('water', 'skip', 'inspect')
    or p_note is null or char_length(p_note) > 2000
    or p_recommendation_reason is null or char_length(p_recommendation_reason) > 1000
    or p_next_interval_days is null
    or p_next_due_at is null
    or p_next_due_at < v_now + interval '23 hours'
    or p_next_due_at > v_now + interval '61 days' then
    raise exception 'Invalid care check details';
  end if;

  if p_action = 'water' and (p_soil_moisture is distinct from 'dry' or p_plant_condition is distinct from 'usual') then
    raise exception 'Watering is only allowed after a dry-soil, usual-condition confirmation';
  end if;

  select plant.id, plant.taxon_id
    into v_plant_id, v_taxon_id
  from public.care_tasks task
  join public.plant_instances plant
    on plant.id = task.plant_id and plant.owner_id = task.owner_id
  where task.id = p_task_id
    and task.owner_id = v_owner_id
    and task.task_type = 'soil_check'
    and task.status = 'pending'
  for update of task, plant;
  if not found then
    raise exception 'The soil-check task was not found or is no longer pending';
  end if;

  if v_taxon_id is not null then
    select guidance.min_check_interval_days, guidance.max_check_interval_days
      into v_min_interval, v_max_interval
    from public.care_guidance guidance
    where guidance.taxon_id = v_taxon_id;
    if not found then
      v_min_interval := 3;
      v_max_interval := 21;
    end if;
  end if;
  if p_next_interval_days < v_min_interval or p_next_interval_days > v_max_interval then
    raise exception 'The proposed care interval is outside the verified safety range';
  end if;

  update public.care_tasks
  set status = case when p_action = 'skip' then 'skipped'::public.care_task_status else 'completed'::public.care_task_status end,
      completed_at = case when p_action = 'skip' then null else v_now end,
      skipped_at = case when p_action = 'skip' then v_now else null end,
      snoozed_until = null,
      notes = p_recommendation_reason
  where id = p_task_id and owner_id = v_owner_id;

  insert into public.care_events (
    owner_id, plant_id, event_type, note, occurred_at,
    soil_moisture, plant_condition, recommendation_reason
  )
  values (
    v_owner_id, v_plant_id,
    case when p_action = 'water' then 'water'::public.care_event_type else 'observation'::public.care_event_type end,
    p_note, v_now, p_soil_moisture, p_plant_condition, p_recommendation_reason
  )
  returning id into v_event_id;

  update public.plant_instances
  set watering_interval_days = p_next_interval_days,
      last_watered_at = case when p_action = 'water' then v_now else last_watered_at end
  where id = v_plant_id and owner_id = v_owner_id;

  insert into public.care_tasks (owner_id, plant_id, task_type, title, notes, due_at)
  values (v_owner_id, v_plant_id, 'soil_check', 'Check soil moisture', 'Check the soil and plant condition before watering.', p_next_due_at)
  returning id into v_next_task_id;

  return jsonb_build_object(
    'event_id', v_event_id,
    'completed_task_id', p_task_id,
    'next_task_id', v_next_task_id,
    'watering_interval_days', p_next_interval_days
  );
end;
$$;

revoke all on function public.record_care_check(uuid, text, text, text, text, text, integer, timestamptz)
  from public, anon;
grant execute on function public.record_care_check(uuid, text, text, text, text, text, integer, timestamptz)
  to authenticated;

create or replace function public.complete_care_task(
  p_task_id uuid,
  p_outcome text,
  p_note text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_plant_id uuid;
  v_task_type public.care_task_type;
  v_event_type public.care_event_type;
  v_event_id uuid;
  v_now timestamptz := now();
begin
  if v_owner_id is null
    or p_outcome is null or p_outcome not in ('completed', 'skipped')
    or p_note is null or char_length(p_note) > 2000 then
    raise exception 'Invalid care task completion details';
  end if;

  select plant_id, task_type
    into v_plant_id, v_task_type
  from public.care_tasks
  where id = p_task_id
    and owner_id = v_owner_id
    and status = 'pending'
    and task_type <> 'soil_check'
  for update;
  if not found then
    raise exception 'The care task was not found or is no longer pending';
  end if;

  v_event_type := case
    when p_outcome = 'skipped' then 'observation'::public.care_event_type
    when v_task_type = 'feed' then 'feed'::public.care_event_type
    when v_task_type = 'prune' then 'prune'::public.care_event_type
    when v_task_type = 'repot' then 'repot'::public.care_event_type
    else 'observation'::public.care_event_type
  end;

  update public.care_tasks
  set status = p_outcome::public.care_task_status,
      completed_at = case when p_outcome = 'completed' then v_now else null end,
      skipped_at = case when p_outcome = 'skipped' then v_now else null end,
      snoozed_until = null
  where id = p_task_id and owner_id = v_owner_id;

  insert into public.care_events (owner_id, plant_id, event_type, note, occurred_at)
  values (v_owner_id, v_plant_id, v_event_type, p_note, v_now)
  returning id into v_event_id;

  return jsonb_build_object('event_id', v_event_id, 'task_id', p_task_id);
end;
$$;

revoke all on function public.complete_care_task(uuid, text, text) from public, anon;
grant execute on function public.complete_care_task(uuid, text, text) to authenticated;
