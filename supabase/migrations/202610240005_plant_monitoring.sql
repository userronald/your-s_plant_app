-- Plant Doctor and Growth Check records.
-- Independent plant-doctor assessments are not tied to a plant in the collection.

alter table public.issue_episodes
  alter column plant_id drop not null;

alter table public.issue_episodes
  add column if not exists independent boolean not null default false,
  add column if not exists mode text not null default 'manual'
    check (mode in ('manual', 'ai', 'demo')),
  add column if not exists provider text not null default ''
    check (char_length(provider) <= 80),
  add column if not exists model text not null default ''
    check (char_length(model) <= 120),
  add column if not exists disclaimer text not null default ''
    check (char_length(disclaimer) <= 1000),
  add column if not exists assessment jsonb,
  add column if not exists photo_ids uuid[] not null default '{}',
  add column if not exists inference_id uuid references public.ai_inferences(id) on delete set null;

alter table public.growth_checks
  add column if not exists photo_ids uuid[] not null default '{}',
  add column if not exists previous_photo_id uuid references public.photos(id) on delete set null,
  add column if not exists previous_captured_at timestamptz,
  add column if not exists observation jsonb,
  add column if not exists mode text not null default 'manual'
    check (mode in ('manual', 'ai', 'demo')),
  add column if not exists provider text not null default ''
    check (char_length(provider) <= 80),
  add column if not exists model text not null default ''
    check (char_length(model) <= 120),
  add column if not exists disclaimer text not null default ''
    check (char_length(disclaimer) <= 1000),
  add column if not exists user_confirmation text not null default 'not_confirmed'
    check (user_confirmation in ('confirmed', 'corrected', 'not_confirmed')),
  add column if not exists user_correction text not null default ''
    check (char_length(user_correction) <= 1000),
  add column if not exists inference_id uuid references public.ai_inferences(id) on delete set null;

create index if not exists growth_checks_owner_plant_captured_idx
  on public.growth_checks(owner_id, plant_id, captured_at desc);

create index if not exists issue_episodes_owner_started_idx
  on public.issue_episodes(owner_id, started_at desc);

comment on column public.growth_checks.observation is
  'Validated structured visual observation. Never a calibrated measurement or biological growth claim.';
comment on column public.issue_episodes.assessment is
  'Validated structured plant-doctor assessment. Possibilities to check, not a diagnosis.';
