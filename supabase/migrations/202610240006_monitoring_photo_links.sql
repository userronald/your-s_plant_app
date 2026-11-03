alter table public.issue_episodes
  alter column plant_id drop not null,
  add column answers jsonb,
  add constraint issue_episodes_independent_plant_check
    check ((independent and plant_id is null) or (not independent and plant_id is not null));

alter table public.photos
  add column issue_id uuid,
  add column issue_photo_kind text;

alter table public.photos
  drop constraint if exists photos_check,
  drop constraint if exists photos_check1,
  add constraint photos_single_owner_reference_check
    check (
      (plant_id is not null)::integer
      + (discovery_id is not null)::integer
      + (issue_id is not null)::integer = 1
    ),
  add constraint photos_discovery_kind_check
    check ((kind = 'discovery') = (discovery_id is not null)),
  add constraint photos_issue_kind_check
    check (
      (kind <> 'issue' and issue_id is null)
      or (kind = 'issue' and (issue_id is not null or plant_id is not null))
    ),
  add constraint photos_issue_view_kind_check
    check (
      (kind = 'issue' and (issue_photo_kind is null or issue_photo_kind in ('whole', 'close-up')))
      or (kind <> 'issue' and issue_photo_kind is null)
    ),
  add constraint photos_issue_owner_fkey
    foreign key (issue_id, owner_id) references public.issue_episodes(id, owner_id) on delete cascade;

create index photos_owner_issue_date_idx
  on public.photos(owner_id, issue_id, captured_at desc) where issue_id is not null;

comment on column public.photos.issue_id is
  'Issue-episode photo association, including independent assessments without a plant profile.';
