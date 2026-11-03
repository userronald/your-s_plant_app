create extension if not exists pgcrypto with schema extensions;

alter table public.plants rename to plants_legacy_v1;
alter table public.discoveries rename to discoveries_legacy_v1;
alter table public.care_events rename to care_events_legacy_v1;
alter table public.growth_checkins rename to growth_checkins_legacy_v1;
alter index public.plants_pkey rename to plants_legacy_v1_pkey;
alter index public.discoveries_pkey rename to discoveries_legacy_v1_pkey;
alter index public.care_events_pkey rename to care_events_legacy_v1_pkey;
alter index public.growth_checkins_pkey rename to growth_checkins_legacy_v1_pkey;
alter index public.plants_owner_id_idx rename to plants_legacy_v1_owner_id_idx;
alter index public.discoveries_owner_id_idx rename to discoveries_legacy_v1_owner_id_idx;
alter index public.care_events_owner_plant_date_idx rename to care_events_legacy_v1_owner_plant_date_idx;
alter index public.growth_checkins_owner_plant_date_idx rename to growth_checkins_legacy_v1_owner_plant_date_idx;

create type public.measurement_unit as enum ('metric', 'imperial');
create type public.taxon_rank as enum ('species', 'genus', 'family', 'other');
create type public.plant_health as enum ('good', 'check', 'attention');
create type public.discovery_source as enum ('manual', 'plantnet', 'demo', 'other');
create type public.photo_kind as enum ('plant', 'discovery', 'care', 'growth', 'issue');
create type public.care_event_type as enum ('water', 'feed', 'prune', 'repot', 'observation');
create type public.care_task_status as enum ('pending', 'completed', 'skipped', 'cancelled');
create type public.care_task_type as enum ('soil_check', 'water', 'feed', 'prune', 'repot', 'observe', 'custom');
create type public.issue_status as enum ('open', 'monitoring', 'resolved', 'dismissed');
create type public.inference_kind as enum ('identification', 'diagnosis', 'care_advice');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  units public.measurement_unit not null default 'metric',
  notification_preferences jsonb not null default '{"care_reminders":false}'::jsonb
    check (jsonb_typeof(notification_preferences) = 'object'),
  quiet_hours_start time,
  quiet_hours_end time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((quiet_hours_start is null) = (quiet_hours_end is null))
);

create table public.taxa (
  id uuid primary key default gen_random_uuid(),
  scientific_name text not null unique check (char_length(scientific_name) between 1 and 200),
  common_name text not null default '' check (char_length(common_name) <= 120),
  rank public.taxon_rank not null default 'species',
  parent_taxon_id uuid references public.taxa(id) on delete set null,
  description text not null default '' check (char_length(description) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  taxon_id uuid references public.taxa(id) on delete set null,
  title text not null check (char_length(title) between 1 and 240),
  source_url text,
  publisher text not null default '' check (char_length(publisher) <= 160),
  license text not null default '' check (char_length(license) <= 120),
  content_summary text not null default '' check (char_length(content_summary) <= 8000),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_url is null or source_url ~ '^https?://')
);
create unique index knowledge_sources_seed_title_idx on public.knowledge_sources(taxon_id, title, publisher);

create table public.plant_instances (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  taxon_id uuid references public.taxa(id) on delete set null,
  nickname text not null check (char_length(nickname) between 1 and 80),
  health_status public.plant_health not null default 'good',
  light_notes text not null default '' check (char_length(light_notes) <= 500),
  watering_interval_days integer not null default 7 check (watering_interval_days between 1 and 90),
  last_watered_at timestamptz,
  acquired_at date,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.discoveries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  taxon_id uuid references public.taxa(id) on delete set null,
  common_name text not null check (char_length(common_name) between 1 and 120),
  scientific_name text not null check (char_length(scientific_name) between 1 and 200),
  source public.discovery_source not null default 'manual',
  observed_at timestamptz not null default now(),
  location_label text not null default '' check (char_length(location_label) <= 160),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.placements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plant_id uuid not null,
  location_name text not null check (char_length(location_name) between 1 and 160),
  light_level text not null default '' check (char_length(light_level) <= 80),
  notes text not null default '' check (char_length(notes) <= 1000),
  placed_at timestamptz not null default now(),
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (plant_id, owner_id) references public.plant_instances(id, owner_id) on delete cascade,
  unique (id, owner_id),
  check (removed_at is null or removed_at >= placed_at)
);

create table public.pots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plant_id uuid,
  label text not null default '' check (char_length(label) <= 100),
  material text not null default '' check (char_length(material) <= 80),
  diameter_cm numeric(6, 2) check (diameter_cm is null or diameter_cm > 0),
  has_drainage boolean,
  notes text not null default '' check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (plant_id, owner_id) references public.plant_instances(id, owner_id) on delete cascade,
  unique (id, owner_id)
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plant_id uuid,
  discovery_id uuid,
  kind public.photo_kind not null,
  storage_path text not null unique check (storage_path like owner_id::text || '/%'),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size bigint not null check (byte_size between 1 and 8388608),
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (plant_id, owner_id) references public.plant_instances(id, owner_id) on delete cascade,
  foreign key (discovery_id, owner_id) references public.discoveries(id, owner_id) on delete cascade,
  unique (id, owner_id),
  check ((plant_id is not null)::integer + (discovery_id is not null)::integer = 1),
  check ((kind = 'discovery') = (discovery_id is not null))
);

create table public.care_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plant_id uuid not null,
  photo_id uuid,
  event_type public.care_event_type not null,
  note text not null default '' check (char_length(note) <= 2000),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (plant_id, owner_id) references public.plant_instances(id, owner_id) on delete cascade,
  foreign key (photo_id, owner_id) references public.photos(id, owner_id) on delete set null,
  unique (id, owner_id)
);

create table public.care_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plant_id uuid not null,
  task_type public.care_task_type not null,
  title text not null check (char_length(title) between 1 and 160),
  notes text not null default '' check (char_length(notes) <= 1000),
  due_at timestamptz not null,
  status public.care_task_status not null default 'pending',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (plant_id, owner_id) references public.plant_instances(id, owner_id) on delete cascade,
  unique (id, owner_id),
  check ((status = 'completed') = (completed_at is not null))
);

create table public.growth_checks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plant_id uuid not null,
  photo_id uuid,
  note text not null default '' check (char_length(note) <= 2000),
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (plant_id, owner_id) references public.plant_instances(id, owner_id) on delete cascade,
  foreign key (photo_id, owner_id) references public.photos(id, owner_id) on delete set null,
  unique (id, owner_id)
);

create table public.issue_episodes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plant_id uuid not null,
  title text not null check (char_length(title) between 1 and 160),
  symptom text not null check (char_length(symptom) between 1 and 120),
  description text not null default '' check (char_length(description) <= 3000),
  status public.issue_status not null default 'open',
  started_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (plant_id, owner_id) references public.plant_instances(id, owner_id) on delete cascade,
  unique (id, owner_id),
  check ((status = 'resolved') = (resolved_at is not null))
);

create table public.issue_followups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  issue_id uuid not null,
  note text not null check (char_length(note) between 1 and 2000),
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (issue_id, owner_id) references public.issue_episodes(id, owner_id) on delete cascade,
  unique (id, owner_id)
);

create table public.ai_inferences (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plant_id uuid,
  discovery_id uuid,
  inference_kind public.inference_kind not null,
  provider text not null check (char_length(provider) between 1 and 80),
  model text not null default '' check (char_length(model) <= 120),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  confidence numeric(5, 4) check (confidence is null or confidence between 0 and 1),
  disclaimer text not null default '' check (char_length(disclaimer) <= 1000),
  created_at timestamptz not null default now(),
  foreign key (plant_id, owner_id) references public.plant_instances(id, owner_id) on delete cascade,
  foreign key (discovery_id, owner_id) references public.discoveries(id, owner_id) on delete cascade,
  check ((plant_id is not null)::integer + (discovery_id is not null)::integer = 1)
);

create table public.ai_inference_sources (
  inference_id uuid not null references public.ai_inferences(id) on delete cascade,
  knowledge_source_id uuid not null references public.knowledge_sources(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (inference_id, knowledge_source_id)
);

create index plant_instances_owner_active_idx on public.plant_instances(owner_id, created_at desc) where archived_at is null;
create index plant_instances_taxon_idx on public.plant_instances(taxon_id);
create index discoveries_owner_observed_idx on public.discoveries(owner_id, observed_at desc);
create index discoveries_taxon_idx on public.discoveries(taxon_id);
create index placements_owner_plant_active_idx on public.placements(owner_id, plant_id, placed_at desc) where removed_at is null;
create unique index placements_one_active_per_plant_idx on public.placements(plant_id) where removed_at is null;
create index pots_owner_plant_idx on public.pots(owner_id, plant_id);
create index photos_owner_plant_date_idx on public.photos(owner_id, plant_id, captured_at desc) where plant_id is not null;
create index photos_owner_discovery_date_idx on public.photos(owner_id, discovery_id, captured_at desc) where discovery_id is not null;
create index care_events_owner_plant_date_idx on public.care_events(owner_id, plant_id, occurred_at desc);
create index care_tasks_owner_status_due_idx on public.care_tasks(owner_id, status, due_at);
create index growth_checks_owner_plant_date_idx on public.growth_checks(owner_id, plant_id, captured_at desc);
create index issue_episodes_owner_plant_status_idx on public.issue_episodes(owner_id, plant_id, status);
create index issue_followups_owner_issue_date_idx on public.issue_followups(owner_id, issue_id, observed_at desc);
create index ai_inferences_owner_created_idx on public.ai_inferences(owner_id, created_at desc);
create index ai_inference_sources_knowledge_source_idx on public.ai_inference_sources(knowledge_source_id);
create index knowledge_sources_taxon_idx on public.knowledge_sources(taxon_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(left(new.raw_user_meta_data ->> 'display_name', 80), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'taxa', 'knowledge_sources', 'plant_instances', 'discoveries',
    'placements', 'pots', 'care_events', 'care_tasks', 'growth_checks', 'issue_episodes'
  ] loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end;
$$;

alter table public.profiles enable row level security;
alter table public.taxa enable row level security;
alter table public.knowledge_sources enable row level security;
alter table public.plant_instances enable row level security;
alter table public.discoveries enable row level security;
alter table public.placements enable row level security;
alter table public.pots enable row level security;
alter table public.photos enable row level security;
alter table public.care_events enable row level security;
alter table public.care_tasks enable row level security;
alter table public.growth_checks enable row level security;
alter table public.issue_episodes enable row level security;
alter table public.issue_followups enable row level security;
alter table public.ai_inferences enable row level security;
alter table public.ai_inference_sources enable row level security;

create policy "profiles_owner_read" on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "profiles_owner_update" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "taxa_authenticated_read" on public.taxa for select to authenticated using (true);
create policy "knowledge_sources_authenticated_read" on public.knowledge_sources for select to authenticated using (true);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'plant_instances', 'discoveries', 'placements', 'pots', 'photos',
    'care_events', 'care_tasks', 'growth_checks', 'issue_episodes', 'issue_followups'
  ] loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))',
      table_name || '_owner_all', table_name
    );
  end loop;
end;
$$;

create policy "ai_inferences_owner_read" on public.ai_inferences for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "ai_inference_sources_owner_read" on public.ai_inference_sources for select to authenticated
  using (exists (
    select 1 from public.ai_inferences inference
    where inference.id = ai_inference_sources.inference_id and inference.owner_id = (select auth.uid())
  ));

revoke all on public.profiles, public.taxa, public.knowledge_sources,
  public.plant_instances, public.discoveries, public.placements, public.pots,
  public.photos, public.care_events, public.care_tasks, public.growth_checks,
  public.issue_episodes, public.issue_followups, public.ai_inferences, public.ai_inference_sources from anon, authenticated;
grant select on public.taxa, public.knowledge_sources to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.plant_instances,
  public.discoveries, public.placements, public.pots,
  public.photos, public.care_events, public.care_tasks, public.growth_checks,
  public.issue_episodes, public.issue_followups to authenticated;
grant select on public.ai_inferences, public.ai_inference_sources to authenticated;

create or replace function public.sync_plant_last_watered()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  affected_plant_id uuid;
  affected_owner_id uuid;
begin
  if tg_op = 'DELETE' then
    affected_plant_id := old.plant_id;
    affected_owner_id := old.owner_id;
  else
    affected_plant_id := new.plant_id;
    affected_owner_id := new.owner_id;
  end if;
  update public.plant_instances plant
  set last_watered_at = (
    select max(event.occurred_at)
    from public.care_events event
    where event.plant_id = affected_plant_id
      and event.owner_id = affected_owner_id
      and event.event_type = 'water'
  )
  where plant.id = affected_plant_id and plant.owner_id = affected_owner_id;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger care_events_sync_last_watered
after insert or update or delete on public.care_events
for each row execute function public.sync_plant_last_watered();

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.create_profile_for_new_user() from public, anon, authenticated;
revoke all on function public.sync_plant_last_watered() from public, anon, authenticated;

insert into public.taxa (scientific_name, common_name, rank, description) values
  ('Monstera deliciosa', 'Monstera', 'species', 'Development seed taxonomy record. Care varies by growing conditions.'),
  ('Epipremnum aureum', 'Golden pothos', 'species', 'Development seed taxonomy record. Care varies by growing conditions.'),
  ('Ficus elastica', 'Rubber plant', 'species', 'Development seed taxonomy record. Care varies by growing conditions.')
on conflict (scientific_name) do nothing;

insert into public.knowledge_sources (taxon_id, title, publisher, license, content_summary)
select id, 'Starter care reference (development seed)', 'Plant AI Companion demo dataset', 'Internal demo content',
  'Example reference only. Not a diagnosis or a substitute for observing the individual plant.'
from public.taxa
where scientific_name in ('Monstera deliciosa', 'Epipremnum aureum', 'Ficus elastica')
on conflict do nothing;

insert into public.profiles (id, display_name)
select id, coalesce(left(raw_user_meta_data ->> 'display_name', 80), '')
from auth.users
on conflict (id) do nothing;

insert into public.plant_instances (
  id, owner_id, taxon_id, nickname, health_status, light_notes, watering_interval_days, last_watered_at, created_at, updated_at
)
select
  old.id, old.owner_id, t.id, old.name, old.health_status::public.plant_health,
  old.light, old.watering_interval_days, old.last_watered_at, old.created_at, old.updated_at
from public.plants_legacy_v1 old
left join public.taxa t on t.scientific_name = old.scientific_name
on conflict (id) do nothing;

insert into public.discoveries (
  id, owner_id, taxon_id, common_name, scientific_name, source, observed_at, created_at, updated_at
)
select
  old.id, old.owner_id, t.id, old.common_name, old.scientific_name,
  case old.source when 'plantnet' then 'plantnet'::public.discovery_source
    when 'manual' then 'manual'::public.discovery_source
    else 'demo'::public.discovery_source end,
  old.created_at, old.created_at, old.created_at
from public.discoveries_legacy_v1 old
left join public.taxa t on t.scientific_name = old.scientific_name
on conflict (id) do nothing;

insert into public.placements (owner_id, plant_id, location_name, light_level, placed_at)
select old.owner_id, old.id, old.location, old.light, old.created_at
from public.plants_legacy_v1 old
where char_length(old.location) > 0
on conflict do nothing;

insert into public.photos (owner_id, plant_id, discovery_id, kind, storage_path, mime_type, byte_size, captured_at)
select old.owner_id, old.id, null, 'plant', old.image_path, stored.metadata ->> 'mimetype',
  case when stored.metadata ->> 'size' ~ '^[0-9]+$' then (stored.metadata ->> 'size')::bigint else 0 end,
  old.created_at
from public.plants_legacy_v1 old
join storage.objects stored on stored.bucket_id = 'plant-photos' and stored.name = old.image_path
where old.image_path like old.owner_id::text || '/%'
  and stored.metadata ->> 'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
  and case when stored.metadata ->> 'size' ~ '^[0-9]+$' then (stored.metadata ->> 'size')::bigint else 0 end between 1 and 8388608
on conflict (storage_path) do nothing;

insert into public.photos (owner_id, plant_id, discovery_id, kind, storage_path, mime_type, byte_size, captured_at)
select old.owner_id, null, old.id, 'discovery', old.image_path, stored.metadata ->> 'mimetype',
  case when stored.metadata ->> 'size' ~ '^[0-9]+$' then (stored.metadata ->> 'size')::bigint else 0 end,
  old.created_at
from public.discoveries_legacy_v1 old
join storage.objects stored on stored.bucket_id = 'plant-photos' and stored.name = old.image_path
where old.image_path like old.owner_id::text || '/%'
  and stored.metadata ->> 'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
  and case when stored.metadata ->> 'size' ~ '^[0-9]+$' then (stored.metadata ->> 'size')::bigint else 0 end between 1 and 8388608
on conflict (storage_path) do nothing;

insert into public.care_events (id, owner_id, plant_id, event_type, note, occurred_at, created_at, updated_at)
select old.id, old.owner_id, old.plant_id, old.event_type::public.care_event_type, old.note, old.occurred_at, old.created_at, old.created_at
from public.care_events_legacy_v1 old
on conflict (id) do nothing;

insert into public.photos (owner_id, plant_id, discovery_id, kind, storage_path, mime_type, byte_size, captured_at)
select old.owner_id, old.plant_id, null, 'growth', old.photo_path, stored.metadata ->> 'mimetype',
  case when stored.metadata ->> 'size' ~ '^[0-9]+$' then (stored.metadata ->> 'size')::bigint else 0 end,
  old.captured_at
from public.growth_checkins_legacy_v1 old
join storage.objects stored on stored.bucket_id = 'plant-photos' and stored.name = old.photo_path
where old.photo_path like old.owner_id::text || '/%'
  and stored.metadata ->> 'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
  and case when stored.metadata ->> 'size' ~ '^[0-9]+$' then (stored.metadata ->> 'size')::bigint else 0 end between 1 and 8388608
on conflict (storage_path) do nothing;

insert into public.photos (owner_id, plant_id, discovery_id, kind, storage_path, mime_type, byte_size, captured_at)
select old.owner_id, old.plant_id, null, 'care', old.photo_path, stored.metadata ->> 'mimetype',
  case when stored.metadata ->> 'size' ~ '^[0-9]+$' then (stored.metadata ->> 'size')::bigint else 0 end,
  old.occurred_at
from public.care_events_legacy_v1 old
join storage.objects stored on stored.bucket_id = 'plant-photos' and stored.name = old.photo_path
where old.photo_path is not null and old.photo_path like old.owner_id::text || '/%'
  and stored.metadata ->> 'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
  and case when stored.metadata ->> 'size' ~ '^[0-9]+$' then (stored.metadata ->> 'size')::bigint else 0 end between 1 and 8388608
on conflict (storage_path) do nothing;

insert into public.growth_checks (id, owner_id, plant_id, photo_id, note, captured_at, created_at)
select old.id, old.owner_id, old.plant_id, photo.id, old.note, old.captured_at, old.created_at
from public.growth_checkins_legacy_v1 old
left join public.photos photo on photo.storage_path = old.photo_path and photo.owner_id = old.owner_id
on conflict (id) do nothing;

insert into public.care_events (id, owner_id, plant_id, photo_id, event_type, note, occurred_at, created_at, updated_at)
select old.id, old.owner_id, old.plant_id, photo.id, old.event_type::public.care_event_type, old.note, old.occurred_at, old.created_at, old.created_at
from public.care_events_legacy_v1 old
left join public.photos photo on photo.storage_path = old.photo_path and photo.owner_id = old.owner_id
on conflict (id) do update set photo_id = excluded.photo_id;

drop table public.growth_checkins_legacy_v1;
drop table public.care_events_legacy_v1;
drop table public.plants_legacy_v1;
drop table public.discoveries_legacy_v1;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plant-photos', 'plant-photos', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read photos in their folder" on storage.objects;
drop policy if exists "Users can upload photos to their folder" on storage.objects;
drop policy if exists "Users can delete photos in their folder" on storage.objects;
drop policy if exists "plant_photos_owner_read" on storage.objects;
drop policy if exists "plant_photos_owner_insert" on storage.objects;
drop policy if exists "plant_photos_owner_update" on storage.objects;
drop policy if exists "plant_photos_owner_delete" on storage.objects;

create policy "plant_photos_owner_read" on storage.objects for select to authenticated
  using (bucket_id = 'plant-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "plant_photos_owner_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'plant-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "plant_photos_owner_update" on storage.objects for update to authenticated
  using (bucket_id = 'plant-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'plant-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "plant_photos_owner_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'plant-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
