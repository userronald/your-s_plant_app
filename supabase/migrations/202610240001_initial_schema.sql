create table public.plants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  scientific_name text not null,
  image_path text,
  location text not null default '',
  light text not null default '',
  health_status text not null default 'good' check (health_status in ('good', 'check', 'attention')),
  watering_interval_days integer not null default 7 check (watering_interval_days between 1 and 90),
  last_watered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.discoveries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  common_name text not null,
  scientific_name text not null,
  image_path text,
  source text not null default 'plantnet' check (source in ('plantnet', 'manual', 'demo')),
  created_at timestamptz not null default now()
);

create table public.care_events (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references public.plants(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('water', 'feed', 'prune', 'repot', 'observation')),
  note text not null default '',
  photo_path text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.growth_checkins (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references public.plants(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  photo_path text not null,
  note text not null default '',
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index plants_owner_id_idx on public.plants(owner_id);
create index discoveries_owner_id_idx on public.discoveries(owner_id);
create index care_events_owner_plant_date_idx on public.care_events(owner_id, plant_id, occurred_at desc);
create index growth_checkins_owner_plant_date_idx on public.growth_checkins(owner_id, plant_id, captured_at desc);

alter table public.plants enable row level security;
alter table public.discoveries enable row level security;
alter table public.care_events enable row level security;
alter table public.growth_checkins enable row level security;

create policy "Owners can read their plants" on public.plants for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners can add their plants" on public.plants for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Owners can update their plants" on public.plants for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Owners can delete their plants" on public.plants for delete to authenticated using (owner_id = (select auth.uid()));

create policy "Owners can read their discoveries" on public.discoveries for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners can add their discoveries" on public.discoveries for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Owners can delete their discoveries" on public.discoveries for delete to authenticated using (owner_id = (select auth.uid()));

create policy "Owners can read their care events" on public.care_events for select to authenticated using (
  owner_id = (select auth.uid()) and exists (
    select 1 from public.plants where plants.id = care_events.plant_id and plants.owner_id = (select auth.uid())
  )
);
create policy "Owners can add their care events" on public.care_events for insert to authenticated with check (
  owner_id = (select auth.uid()) and exists (
    select 1 from public.plants where plants.id = care_events.plant_id and plants.owner_id = (select auth.uid())
  )
);
create policy "Owners can delete their care events" on public.care_events for delete to authenticated using (owner_id = (select auth.uid()));

create policy "Owners can read their growth checkins" on public.growth_checkins for select to authenticated using (
  owner_id = (select auth.uid()) and exists (
    select 1 from public.plants where plants.id = growth_checkins.plant_id and plants.owner_id = (select auth.uid())
  )
);
create policy "Owners can add their growth checkins" on public.growth_checkins for insert to authenticated with check (
  owner_id = (select auth.uid()) and exists (
    select 1 from public.plants where plants.id = growth_checkins.plant_id and plants.owner_id = (select auth.uid())
  )
);
create policy "Owners can delete their growth checkins" on public.growth_checkins for delete to authenticated using (owner_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plant-photos', 'plant-photos', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "Users can read photos in their folder" on storage.objects for select to authenticated
using (bucket_id = 'plant-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users can upload photos to their folder" on storage.objects for insert to authenticated
with check (bucket_id = 'plant-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users can delete photos in their folder" on storage.objects for delete to authenticated
using (bucket_id = 'plant-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
