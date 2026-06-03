CREATE OR REPLACE FUNCTION public.resolve_cfop_device(p_implantable boolean)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT '5102'; $$;
