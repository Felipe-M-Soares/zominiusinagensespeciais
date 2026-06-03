CREATE OR REPLACE FUNCTION public.trg_auto_ncm_cfop()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ncm IS NULL OR NEW.ncm = '' OR NEW.ncm = '90213990' THEN
    NEW.ncm := replace(public.resolve_ncm_device(NEW.risk_class, NEW.implantable, NEW.body_region, NEW.classification_code, NEW.primary_material), '.', '');
  END IF;
  IF NEW.cfop_padrao IS NULL OR NEW.cfop_padrao = '' OR NEW.cfop_padrao = '5102' THEN
    NEW.cfop_padrao := public.resolve_cfop_device(NEW.implantable);
  END IF;
  IF NEW.unidade IS NULL OR NEW.unidade = '' THEN NEW.unidade := 'UN'; END IF;
  RETURN NEW;
END;
$$;
