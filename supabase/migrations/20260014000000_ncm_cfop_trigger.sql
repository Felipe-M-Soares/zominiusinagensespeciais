-- =============================================================================
-- 014: Auto-preenchimento de NCM/CFOP para dispositivos
-- =============================================================================

CREATE OR REPLACE FUNCTION public.resolve_ncm_device(
  p_risk_class text, p_implantable boolean, p_body_region text,
  p_classification text, p_primary_material text
) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f01$
DECLARE
  v_body     text := lower(coalesce(p_body_region,''));
  v_class    text := lower(coalesce(p_classification,''));
  v_material text := lower(coalesce(p_primary_material,''));
BEGIN
  IF p_implantable = true AND (v_body LIKE '%oral%' OR v_body LIKE '%dent%' OR v_body LIKE '%buc%') THEN
    IF v_class LIKE '%implant%' OR v_class LIKE '%fixture%' OR v_class LIKE '%parafus%' THEN RETURN '9021.29.10'; END IF;
    IF v_class LIKE '%pilar%' OR v_class LIKE '%abutment%' OR v_class LIKE '%proteti%' OR v_class LIKE '%protese%' OR v_class LIKE '%prótese%' THEN RETURN '9021.39.90'; END IF;
    IF v_material LIKE '%titani%' OR v_material LIKE '%ti-6%' OR v_material LIKE '%titanium%' THEN RETURN '9021.29.10'; END IF;
    RETURN '9021.39.90';
  END IF;
  IF v_body LIKE '%oral%' OR v_body LIKE '%dent%' OR v_body LIKE '%buc%' THEN
    IF v_class LIKE '%instrumen%' OR v_class LIKE '%tool%' OR v_class LIKE '%broca%' OR v_class LIKE '%fresa%' OR v_class LIKE '%kit%' THEN RETURN '9018.49.90'; END IF;
    RETURN '9021.39.90';
  END IF;
  IF p_risk_class IN ('III','IV') AND p_implantable = true THEN RETURN '9021.39.90'; END IF;
  IF p_risk_class IN ('I','II') THEN RETURN '9018.90.99'; END IF;
  RETURN '9021.39.90';
END;
$f01$;

CREATE OR REPLACE FUNCTION public.resolve_cfop_device(p_implantable boolean)
RETURNS text LANGUAGE sql IMMUTABLE AS $f02$ SELECT '5102'; $f02$;

CREATE OR REPLACE FUNCTION public.trg_auto_ncm_cfop()
RETURNS trigger LANGUAGE plpgsql AS $f03$
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
$f03$;

DROP TRIGGER IF EXISTS trg_devices_auto_ncm_cfop ON public.devices;
CREATE TRIGGER trg_devices_auto_ncm_cfop
  BEFORE INSERT OR UPDATE OF risk_class, implantable, body_region, classification_code, primary_material
  ON public.devices FOR EACH ROW EXECUTE FUNCTION public.trg_auto_ncm_cfop();
