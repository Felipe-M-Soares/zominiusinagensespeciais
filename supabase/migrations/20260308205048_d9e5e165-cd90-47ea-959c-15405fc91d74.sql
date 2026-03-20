-- Fix: the restrictive ALL policy blocks non-admin SELECT
-- Drop the restrictive SELECT and recreate as PERMISSIVE
DROP POLICY IF EXISTS "Authenticated users can view devices" ON devices;
CREATE POLICY "Authenticated users can view devices"
  ON devices FOR SELECT TO authenticated
  USING (true);

-- Make admin policy only cover write operations
DROP POLICY IF EXISTS "Admins can manage devices" ON devices;
CREATE POLICY "Admins can insert devices"
  ON devices FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update devices"
  ON devices FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete devices"
  ON devices FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));