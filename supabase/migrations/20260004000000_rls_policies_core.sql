-- =============================================================================
-- 004: RLS — user_roles, profiles, devices, contacts, manuals, catalogs
-- =============================================================================

-- ── user_roles ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "user_roles_own_select" ON public.user_roles;
CREATE POLICY "user_roles_own_select" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "user_roles_admin_all" ON public.user_roles;
CREATE POLICY "user_roles_admin_all" ON public.user_roles
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ── profiles ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "profiles_own_select" ON public.profiles;
CREATE POLICY "profiles_own_select" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "profiles_own_insert" ON public.profiles;
CREATE POLICY "profiles_own_insert" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "profiles_own_update" ON public.profiles;
CREATE POLICY "profiles_own_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND approved = (SELECT approved FROM public.profiles WHERE user_id = auth.uid())
    AND email    = (SELECT email    FROM public.profiles WHERE user_id = auth.uid())
    AND blocked  = (SELECT blocked  FROM public.profiles WHERE user_id = auth.uid())
    AND login    = (SELECT login    FROM public.profiles WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "profiles_admin_all" ON public.profiles;
CREATE POLICY "profiles_admin_all" ON public.profiles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ── devices ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "devices_approved_select" ON public.devices;
CREATE POLICY "devices_approved_select" ON public.devices
  FOR SELECT TO authenticated USING (public.is_approved_user() OR public.is_admin_user());

DROP POLICY IF EXISTS "devices_admin_insert" ON public.devices;
CREATE POLICY "devices_admin_insert" ON public.devices
  FOR INSERT TO authenticated WITH CHECK (public.is_admin_user());

DROP POLICY IF EXISTS "devices_admin_update" ON public.devices;
CREATE POLICY "devices_admin_update" ON public.devices
  FOR UPDATE TO authenticated
  USING (public.is_admin_user() OR EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'financeiro')
  ));

DROP POLICY IF EXISTS "devices_admin_delete" ON public.devices;
CREATE POLICY "devices_admin_delete" ON public.devices
  FOR DELETE TO authenticated USING (public.is_admin_user());

-- ── contacts ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "contacts_approved_select" ON public.contacts;
CREATE POLICY "contacts_approved_select" ON public.contacts
  FOR SELECT TO authenticated USING (public.is_approved_user() OR public.is_admin_user());

DROP POLICY IF EXISTS "contacts_admin_insert" ON public.contacts;
CREATE POLICY "contacts_admin_insert" ON public.contacts
  FOR INSERT TO authenticated WITH CHECK (public.is_admin_user());

DROP POLICY IF EXISTS "contacts_admin_update" ON public.contacts;
CREATE POLICY "contacts_admin_update" ON public.contacts
  FOR UPDATE TO authenticated USING (public.is_admin_user());

DROP POLICY IF EXISTS "contacts_admin_delete" ON public.contacts;
CREATE POLICY "contacts_admin_delete" ON public.contacts
  FOR DELETE TO authenticated USING (public.is_admin_user());

-- ── manuals ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "manuals_approved_select" ON public.manuals;
CREATE POLICY "manuals_approved_select" ON public.manuals
  FOR SELECT TO authenticated USING (public.is_approved_user() OR public.is_admin_user());

DROP POLICY IF EXISTS "manuals_admin_insert" ON public.manuals;
CREATE POLICY "manuals_admin_insert" ON public.manuals
  FOR INSERT TO authenticated WITH CHECK (public.is_admin_user());

DROP POLICY IF EXISTS "manuals_admin_update" ON public.manuals;
CREATE POLICY "manuals_admin_update" ON public.manuals
  FOR UPDATE TO authenticated USING (public.is_admin_user());

DROP POLICY IF EXISTS "manuals_admin_delete" ON public.manuals;
CREATE POLICY "manuals_admin_delete" ON public.manuals
  FOR DELETE TO authenticated USING (public.is_admin_user());

-- ── catalogs ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "catalogs_approved_select" ON public.catalogs;
CREATE POLICY "catalogs_approved_select" ON public.catalogs
  FOR SELECT TO authenticated USING (public.is_approved_user() OR public.is_admin_user());

DROP POLICY IF EXISTS "catalogs_admin_insert" ON public.catalogs;
CREATE POLICY "catalogs_admin_insert" ON public.catalogs
  FOR INSERT TO authenticated WITH CHECK (public.is_admin_user());

DROP POLICY IF EXISTS "catalogs_admin_update" ON public.catalogs;
CREATE POLICY "catalogs_admin_update" ON public.catalogs
  FOR UPDATE TO authenticated USING (public.is_admin_user());

DROP POLICY IF EXISTS "catalogs_admin_delete" ON public.catalogs;
CREATE POLICY "catalogs_admin_delete" ON public.catalogs
  FOR DELETE TO authenticated USING (public.is_admin_user());
