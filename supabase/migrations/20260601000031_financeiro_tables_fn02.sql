CREATE OR REPLACE FUNCTION public.peek_next_nf_number(p_serie text DEFAULT '1', p_tipo text DEFAULT 'nfe')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_num bigint;
BEGIN
  SELECT COALESCE(ultimo_num, 0) + 1 INTO v_num FROM public.nfe_sequencia WHERE serie = p_serie AND tipo = p_tipo;
  IF NOT FOUND THEN v_num := 1; END IF;
  RETURN v_num;
END;
$$;
GRANT EXECUTE ON FUNCTION public.peek_next_nf_number(text,text) TO authenticated;
