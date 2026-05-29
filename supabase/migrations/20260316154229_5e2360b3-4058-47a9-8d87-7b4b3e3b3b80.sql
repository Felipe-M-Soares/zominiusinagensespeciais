CREATE TABLE public.catalogs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  file_path text NOT NULL,
  file_size bigint DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.catalogs ENABLE ROW LEVEL SECURITY;

drop policy if exists "Authenticated users can view catalogs" on public.catalogs;
CREATE POLICY "Authenticated users can view catalogs" ON public.catalogs
  FOR SELECT TO authenticated USING (true);

drop policy if exists "Admins can insert catalogs" on public.catalogs;
CREATE POLICY "Admins can insert catalogs" ON public.catalogs
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));

drop policy if exists "Admins can delete catalogs" on public.catalogs;
CREATE POLICY "Admins can delete catalogs" ON public.catalogs
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

drop policy if exists "Admins can update catalogs" on public.catalogs;
CREATE POLICY "Admins can update catalogs" ON public.catalogs
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));