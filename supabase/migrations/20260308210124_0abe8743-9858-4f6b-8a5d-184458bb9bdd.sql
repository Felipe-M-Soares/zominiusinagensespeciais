-- Create manuals storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('manuals', 'manuals', true)
ON CONFLICT (id) DO NOTHING;

-- Create manuals metadata table
CREATE TABLE IF NOT EXISTS public.manuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text DEFAULT '',
  file_path text NOT NULL,
  file_size bigint DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.manuals ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can view manuals
CREATE POLICY "Authenticated users can view manuals"
  ON public.manuals FOR SELECT TO authenticated
  USING (true);

-- Only admins can manage manuals
CREATE POLICY "Admins can insert manuals"
  ON public.manuals FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update manuals"
  ON public.manuals FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete manuals"
  ON public.manuals FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Storage policies for manuals bucket
CREATE POLICY "Anyone can read manuals" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'manuals');

CREATE POLICY "Admins can upload manuals" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'manuals' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete manuals" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'manuals' AND public.has_role(auth.uid(), 'admin'::app_role));