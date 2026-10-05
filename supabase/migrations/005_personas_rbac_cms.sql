-- ============================================================================
-- 005_personas_rbac_cms.sql  —  run AFTER 001–004. Safe to re-run.
--
-- PERSONA & ACCESS FRAMEWORK
--   Customer       role 'customer'  → own data only (orders, files, tickets…)
--   Print partner  role 'vendor'    → only jobs assigned to their workshop
--   Back-office    role 'admin'     → staff; WHAT they may change is decided
--                                     by module permissions in staff_members
--
-- Back-office modules (permission keys):
--   orders, production, support, customers, finance, marketing,
--   catalog, content, settings, team, audit        ( '*' = owner, everything )
--
-- Rule of the database:
--   • Any staff member may READ operational data (to help customers).
--   • Finance, team and audit data are READ only with that module.
--   • Every WRITE needs the module permission.
--   • Customers and partners never match any staff policy.
-- ============================================================================

-- 1. STAFF TABLES -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_members (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  staff_role TEXT NOT NULL DEFAULT 'custom',
  permissions TEXT[] NOT NULL DEFAULT '{}',
  added_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.staff_invites (
  email TEXT PRIMARY KEY,
  staff_role TEXT NOT NULL DEFAULT 'custom',
  permissions TEXT[] NOT NULL DEFAULT '{}',
  invited_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Everyone who is already an admin becomes an Owner (keeps today's behaviour).
INSERT INTO public.staff_members (user_id, staff_role, permissions)
SELECT id, 'owner', ARRAY['*'] FROM public.profiles WHERE role = 'admin'
ON CONFLICT (user_id) DO NOTHING;

-- 2. PERMISSION FUNCTIONS -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_perm(p_module TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles pr
    WHERE pr.id = auth.uid() AND pr.role = 'admin'
      AND (
        EXISTS (SELECT 1 FROM public.owner_admin_emails o WHERE o.email = lower(pr.email))
        OR EXISTS (SELECT 1 FROM public.staff_members s
                   WHERE s.user_id = pr.id AND ('*' = ANY (s.permissions) OR p_module = ANY (s.permissions)))
      )
  );
$$;
GRANT EXECUTE ON FUNCTION public.has_perm(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_permissions()
RETURNS TEXT[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN ARRAY[]::TEXT[]
    WHEN EXISTS (SELECT 1 FROM public.profiles pr JOIN public.owner_admin_emails o ON o.email = lower(pr.email) WHERE pr.id = auth.uid()) THEN ARRAY['*']
    ELSE COALESCE((SELECT permissions FROM public.staff_members WHERE user_id = auth.uid()), ARRAY[]::TEXT[])
  END;
$$;
GRANT EXECUTE ON FUNCTION public.my_permissions() TO authenticated;

-- 3. WEBSITE CONTENT, SETTINGS, CATALOG ----------------------------------------
CREATE TABLE IF NOT EXISTS public.site_content (
  key TEXT PRIMARY KEY,                    -- e.g. 'hero', 'faq', 'legal.terms'
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.portal_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  shipping_inr NUMERIC(8,2) DEFAULT 90 NOT NULL,
  express_inr NUMERIC(8,2) DEFAULT 249 NOT NULL,
  express_enabled BOOLEAN DEFAULT TRUE NOT NULL,
  express_max_print_hours NUMERIC(5,1) DEFAULT 6 NOT NULL,
  referral_friend_inr NUMERIC(8,2) DEFAULT 200 NOT NULL,
  referral_reward_inr NUMERIC(8,2) DEFAULT 200 NOT NULL,
  claim_window_hours INT DEFAULT 48 NOT NULL,
  online_payment_enabled BOOLEAN DEFAULT TRUE NOT NULL,
  proforma_enabled BOOLEAN DEFAULT TRUE NOT NULL,
  accepting_orders BOOLEAN DEFAULT TRUE NOT NULL,
  paused_message TEXT DEFAULT 'We are not taking new orders right now. Please check back soon.' NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
INSERT INTO public.portal_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.material_pricing_catalog ADD COLUMN IF NOT EXISTS best_for TEXT;
ALTER TABLE public.material_pricing_catalog ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.material_pricing_catalog ADD COLUMN IF NOT EXISTS swatch_hex CHAR(7);
ALTER TABLE public.material_pricing_catalog ADD COLUMN IF NOT EXISTS colors JSONB;  -- [["Matte Black","#1d1f21"],…]
ALTER TABLE public.material_pricing_catalog ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 100 NOT NULL;

CREATE TABLE IF NOT EXISTS public.catalog_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  short_description TEXT,
  description TEXT,
  tags TEXT[] DEFAULT '{}' NOT NULL,
  image_paths TEXT[] DEFAULT '{}' NOT NULL,          -- public bucket 'catalog-media'
  cad_asset_id UUID REFERENCES public.cad_assets(id) ON DELETE RESTRICT,
  default_material print_material DEFAULT 'pla' NOT NULL,
  allowed_materials TEXT[],                          -- NULL = all active materials
  default_color TEXT,
  default_infill INT DEFAULT 25 NOT NULL,
  fixed_unit_price_inr NUMERIC(10,2),                -- NULL = priced from the STL
  waive_setup_fee BOOLEAN DEFAULT TRUE NOT NULL,
  lead_time_days INT DEFAULT 3 NOT NULL,
  is_published BOOLEAN DEFAULT FALSE NOT NULL,
  is_featured BOOLEAN DEFAULT FALSE NOT NULL,
  sort_order INT DEFAULT 100 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
-- Size of the product's STL, copied here so the public shop never needs to read cad_assets.
ALTER TABLE public.catalog_products ADD COLUMN IF NOT EXISTS volume_cm3 NUMERIC(10,3);
ALTER TABLE public.catalog_products ADD COLUMN IF NOT EXISTS bbox_mm NUMERIC(8,2)[];
CREATE INDEX IF NOT EXISTS idx_catalog_published ON public.catalog_products(is_published, category);

ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS catalog_product_id UUID REFERENCES public.catalog_products(id) ON DELETE SET NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('catalog-media', 'catalog-media', true, 5242880)   -- public product photos, 5 MB
ON CONFLICT (id) DO NOTHING;

-- 4. RE-BUILD STAFF POLICIES BY MODULE -----------------------------------------
DO $$
DECLARE
  m RECORD;
  restricted TEXT[] := ARRAY['finance', 'team', 'audit'];
BEGIN
  FOR m IN SELECT * FROM (VALUES
    ('orders','orders'), ('orders','order_items'), ('orders','gst_credit_notes'), ('orders','coupon_redemptions'),
    ('orders','cad_assets'), ('orders','cad_download_audit_logs'), ('orders','whatsapp_notification_logs'),
    ('orders','fy_invoice_counters'), ('orders','fy_credit_note_counters'),
    ('production','vendor_jobs'), ('production','vendors'), ('production','vendor_material_stock'),
    ('finance','vendor_payout_settlements'), ('finance','corporate_credit_accounts'), ('finance','corporate_credit_ledger'),
    ('customers','profiles'), ('customers','user_activity_logs'), ('customers','referral_rewards_ledger'),
    ('support','support_tickets'), ('support','defect_warranty_claims'), ('support','ai_chat_messages'), ('support','portal_ux_surveys'),
    ('marketing','promo_coupons'), ('marketing','product_service_reviews'), ('marketing','user_review_reward_claims'), ('marketing','review_reward_settings'),
    ('catalog','material_pricing_catalog'), ('catalog','quantity_discount_tiers'), ('catalog','catalog_products'),
    ('content','site_content'),
    ('settings','portal_business_identity'), ('settings','portal_settings'),
    ('team','staff_members'), ('team','staff_invites'), ('team','owner_admin_emails'),
    ('audit','admin_audit_log')
  ) AS t(module, tbl) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', m.tbl);
    EXECUTE format('DROP POLICY IF EXISTS admin_all ON public.%I', m.tbl);
    EXECUTE format('DROP POLICY IF EXISTS staff_read ON public.%I', m.tbl);
    EXECUTE format('DROP POLICY IF EXISTS staff_write ON public.%I', m.tbl);
    IF m.module = ANY (restricted) THEN
      EXECUTE format('CREATE POLICY staff_read ON public.%I FOR SELECT TO authenticated USING (public.has_perm(%L))', m.tbl, m.module);
    ELSE
      EXECUTE format('CREATE POLICY staff_read ON public.%I FOR SELECT TO authenticated USING (public.is_admin())', m.tbl);
    END IF;
    EXECUTE format('CREATE POLICY staff_write ON public.%I FOR ALL TO authenticated USING (public.has_perm(%L)) WITH CHECK (public.has_perm(%L))', m.tbl, m.module, m.module);
  END LOOP;
END $$;

-- Every staff member can write their own audit entries (but only 'audit' can read them).
DROP POLICY IF EXISTS staff_log ON public.admin_audit_log;
CREATE POLICY staff_log ON public.admin_audit_log FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() AND admin_user_id = auth.uid());

-- Staff can see their own access row (so the panel knows what to show).
DROP POLICY IF EXISTS own_staff_row ON public.staff_members;
CREATE POLICY own_staff_row ON public.staff_members FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 5. PUBLIC READS FOR THE CUSTOMER WEBSITE -------------------------------------
DROP POLICY IF EXISTS public_read ON public.site_content;
CREATE POLICY public_read ON public.site_content FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS public_read ON public.portal_settings;
CREATE POLICY public_read ON public.portal_settings FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS public_read ON public.catalog_products;
CREATE POLICY public_read ON public.catalog_products FOR SELECT TO anon, authenticated USING (is_published);

-- 6. ROLE CHANGES NEED THE 'team' PERMISSION ------------------------------------
CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;  -- server (service key) / SQL editor
  IF NEW.role IS DISTINCT FROM OLD.role AND NOT public.has_perm('team') THEN
    RAISE EXCEPTION 'Only a team manager can change roles.';
  END IF;
  IF (NEW.is_verified_b2b IS DISTINCT FROM OLD.is_verified_b2b
      OR NEW.wallet_balance_inr IS DISTINCT FROM OLD.wallet_balance_inr
      OR NEW.total_referral_earnings_inr IS DISTINCT FROM OLD.total_referral_earnings_inr)
     AND NOT public.has_perm('customers') THEN
    RAISE EXCEPTION 'Only staff with the Customers permission can change verification or wallet fields.';
  END IF;
  RETURN NEW;
END $$;

-- Nobody but an owner may grant the owner ('*') or 'team' permission.
CREATE OR REPLACE FUNCTION public.guard_staff_grants()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF ('*' = ANY (NEW.permissions) OR 'team' = ANY (NEW.permissions)) AND NOT ('*' = ANY (public.my_permissions())) THEN
    RAISE EXCEPTION 'Only an owner can grant Owner or Team access.';
  END IF;
  IF TG_TABLE_NAME = 'staff_members' THEN
    IF (to_jsonb(NEW)->>'user_id')::uuid = auth.uid() THEN
      RAISE EXCEPTION 'You cannot change your own access.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_staff ON public.staff_members;
CREATE TRIGGER trg_guard_staff BEFORE INSERT OR UPDATE ON public.staff_members FOR EACH ROW EXECUTE FUNCTION public.guard_staff_grants();
DROP TRIGGER IF EXISTS trg_guard_invites ON public.staff_invites;
CREATE TRIGGER trg_guard_invites BEFORE INSERT OR UPDATE ON public.staff_invites FOR EACH ROW EXECUTE FUNCTION public.guard_staff_grants();

-- 7. SIGN-UP: owner → invited staff → partner → customer -----------------------
CREATE OR REPLACE FUNCTION public.handle_new_user_signup()
RETURNS TRIGGER AS $$
DECLARE
  assigned_role user_role_type := 'customer';
  inv public.staff_invites%ROWTYPE;
BEGIN
  SELECT * INTO inv FROM public.staff_invites WHERE email = lower(NEW.email);
  IF EXISTS (SELECT 1 FROM public.owner_admin_emails WHERE email = lower(NEW.email)) OR inv.email IS NOT NULL THEN
    assigned_role := 'admin';
  ELSIF EXISTS (SELECT 1 FROM public.vendors WHERE lower(email) = lower(NEW.email)) THEN
    assigned_role := 'vendor';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, phone_number, role)
  VALUES (NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.phone, NEW.raw_user_meta_data->>'phone', ''),
    assigned_role)
  ON CONFLICT (id) DO NOTHING;

  IF EXISTS (SELECT 1 FROM public.owner_admin_emails WHERE email = lower(NEW.email)) THEN
    INSERT INTO public.staff_members (user_id, staff_role, permissions) VALUES (NEW.id, 'owner', ARRAY['*']) ON CONFLICT (user_id) DO NOTHING;
  ELSIF inv.email IS NOT NULL THEN
    INSERT INTO public.staff_members (user_id, staff_role, permissions, added_by) VALUES (NEW.id, inv.staff_role, inv.permissions, inv.invited_by) ON CONFLICT (user_id) DO NOTHING;
    DELETE FROM public.staff_invites WHERE email = inv.email;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 8. CHECK -----------------------------------------------------------------------
SELECT p.email, s.staff_role, s.permissions FROM public.staff_members s JOIN public.profiles p ON p.id = s.user_id;

-- 9. GUEST CHECKOUT ----------------------------------------------------------------
-- Guests order without an account. The order is reached only through its private
-- share_token link. When the guest later signs up with the same (verified) email,
-- the app moves their guest orders into the new account.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS guest_email TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS guest_name TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS guest_session_id TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_guest_email ON public.orders(lower(guest_email)) WHERE user_id IS NULL;
ALTER TABLE public.portal_settings ADD COLUMN IF NOT EXISTS guest_checkout_enabled BOOLEAN DEFAULT TRUE NOT NULL;
-- Longer, unguessable share links for new orders (old 12-character links keep working).
ALTER TABLE public.orders ALTER COLUMN share_token SET DEFAULT replace(gen_random_uuid()::text, '-', '');
