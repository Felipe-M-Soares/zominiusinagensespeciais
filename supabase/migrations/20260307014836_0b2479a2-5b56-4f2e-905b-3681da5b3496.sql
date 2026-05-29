ALTER TABLE public.devices ADD COLUMN manufacturer_country text NOT NULL DEFAULT '';
ALTER TABLE public.devices ADD COLUMN exocad_compatibility text NOT NULL DEFAULT '';