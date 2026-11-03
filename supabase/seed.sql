-- Public reference data only. This is not an account, owned plant collection, or AI result.
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
on conflict (taxon_id, title, publisher) do nothing;
