-- ============================================================================
-- 002_admin_security.sql
-- Run AFTER 001_master_schema.sql.
-- Adds: is_admin() helper, Row Level Security on every table, admin policies,
-- customer self-service read policies, public catalogue reads, and a guard
-- that stops anyone except an admin from changing roles or wallet balances.
-- Safe to re-run.
-- ============================================================================

-- 1. ADMIN CHECK HELPER ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- 2. ENABLE RLS + ADMIN FULL ACCESS ON EVERY TABLE ---------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'portal_business_identity','vendors','profiles','user_activity_logs','cad_assets',
    'cad_download_audit_logs','material_pricing_catalog','vendor_material_stock',
    'quantity_discount_tiers','promo_coupons','fy_invoice_counters','fy_credit_note_counters',
    'orders','order_items','vendor_jobs','gst_credit_notes','coupon_redemptions',
    'corporate_credit_accounts','corporate_credit_ledger','vendor_payout_settlements',
    'referral_rewards_ledger','review_reward_settings','product_service_reviews',
    'user_review_reward_claims','portal_ux_surveys','support_tickets','ai_chat_messages',
    'defect_warranty_claims','whatsapp_notification_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS admin_all ON public.%I', t);
    EXECUTE format('CREATE POLICY admin_all ON public.%I FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())', t);
  END LOOP;
END $$;

-- 3. CUSTOMER SELF-SERVICE READS --------------------------------------------
DROP POLICY IF EXISTS own_profile_read ON profiles;
CREATE POLICY own_profile_read ON profiles FOR SELECT TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS own_profile_update ON profiles;
CREATE POLICY own_profile_update ON profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS own_orders_read ON orders;
CREATE POLICY own_orders_read ON orders FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS own_order_items_read ON order_items;
CREATE POLICY own_order_items_read ON order_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND o.user_id = auth.uid()));

DROP POLICY IF EXISTS own_cad_read ON cad_assets;
CREATE POLICY own_cad_read ON cad_assets FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS own_tickets_read ON support_tickets;
CREATE POLICY own_tickets_read ON support_tickets FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 4. PUBLIC CATALOGUE READS (website quote engine) ---------------------------
DROP POLICY IF EXISTS public_read ON material_pricing_catalog;
CREATE POLICY public_read ON material_pricing_catalog FOR SELECT TO anon, authenticated USING (is_active);

DROP POLICY IF EXISTS public_read ON quantity_discount_tiers;
CREATE POLICY public_read ON quantity_discount_tiers FOR SELECT TO anon, authenticated USING (is_active);

DROP POLICY IF EXISTS public_read ON product_service_reviews;
CREATE POLICY public_read ON product_service_reviews FOR SELECT TO anon, authenticated USING (status = 'published');

-- 5. CRM VIEW MUST RESPECT RLS -----------------------------------------------
ALTER VIEW public.crm_leads_and_prospects_view SET (security_invoker = on);

-- 6. PRIVILEGE-ESCALATION GUARD ----------------------------------------------
-- A customer may edit their name/phone/company, but never their role,
-- verification flag, wallet or referral earnings.
CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() THEN
    RETURN NEW;  -- service role / SQL editor / admins
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.is_verified_b2b IS DISTINCT FROM OLD.is_verified_b2b
     OR NEW.wallet_balance_inr IS DISTINCT FROM OLD.wallet_balance_inr
     OR NEW.total_referral_earnings_inr IS DISTINCT FROM OLD.total_referral_earnings_inr THEN
    RAISE EXCEPTION 'Only an admin can change role, verification or wallet fields.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_profile ON profiles;
CREATE TRIGGER trg_guard_profile BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_columns();

-- 7. ADMIN AUDIT TRAIL ------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  admin_email TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_all ON admin_audit_log;
CREATE POLICY admin_all ON admin_audit_log FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 8. KEEP updated_at FRESH ON ORDERS / JOBS ----------------------------------
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_touch_orders ON orders;
CREATE TRIGGER trg_touch_orders BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS trg_touch_jobs ON vendor_jobs;
CREATE TRIGGER trg_touch_jobs BEFORE UPDATE ON vendor_jobs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 9. MAKE YOURSELF ADMIN (edit the email, then run this line on its own) -----
-- UPDATE profiles SET role = 'admin' WHERE email = 'your-email@example.com';
