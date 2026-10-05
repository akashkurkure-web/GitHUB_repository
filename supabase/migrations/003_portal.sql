-- ============================================================================
-- 003_portal.sql  —  run AFTER 001 and 002.
-- Storage buckets, vendor + customer read access, payment columns,
-- atomic helpers for coupons / credit / wallet, review-reward fix.
-- Safe to re-run.
-- ============================================================================

-- 1. PRIVATE STORAGE BUCKETS ---------------------------------------------------
-- All file access goes through the server (signed URLs), so no public policies.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('cad-files', 'cad-files', false, 52428800),          -- 50 MB
       ('qc-photos', 'qc-photos', false, 10485760),          -- 10 MB
       ('claim-photos', 'claim-photos', false, 10485760)     -- 10 MB
ON CONFLICT (id) DO NOTHING;

-- 2. HONEST DEFAULTS FOR FILE SCANNING ----------------------------------------
-- The original schema marked every upload CLEAN by default. Until a scanner
-- is connected, record the real state.
ALTER TABLE cad_assets ALTER COLUMN clamav_scan_status SET DEFAULT 'NOT_SCANNED';
ALTER TABLE cad_assets ALTER COLUMN is_cdr_sanitized SET DEFAULT FALSE;

-- 3. EXTRA COLUMNS --------------------------------------------------------------
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT;
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS wallet_applied_inr NUMERIC(10,2) DEFAULT 0.00 NOT NULL;
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS referral_discount_inr NUMERIC(10,2) DEFAULT 0.00 NOT NULL;
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS default_shipping_address JSONB DEFAULT '{}'::jsonb;
ALTER TABLE vendor_jobs ADD COLUMN IF NOT EXISTS qc_photo_path TEXT;
ALTER TABLE vendor_jobs ADD COLUMN IF NOT EXISTS vendor_notes TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_razorpay ON orders(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_jobs_vendor ON vendor_jobs(vendor_id, status);

-- 4. VENDOR IDENTITY -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_vendor_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.id FROM public.vendors v
  JOIN public.profiles p ON lower(p.email) = lower(v.email)
  WHERE p.id = auth.uid() AND p.role = 'vendor' AND v.is_active
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.current_vendor_id() TO authenticated;

-- 5. VENDOR READ ACCESS (only their own jobs) -------------------------------------
DROP POLICY IF EXISTS vendor_own_row ON vendors;
CREATE POLICY vendor_own_row ON vendors FOR SELECT TO authenticated USING (id = public.current_vendor_id());

DROP POLICY IF EXISTS vendor_own_jobs ON vendor_jobs;
CREATE POLICY vendor_own_jobs ON vendor_jobs FOR SELECT TO authenticated USING (vendor_id = public.current_vendor_id());

DROP POLICY IF EXISTS vendor_job_orders ON orders;
CREATE POLICY vendor_job_orders ON orders FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM vendor_jobs j WHERE j.order_id = orders.id AND j.vendor_id = public.current_vendor_id()));

DROP POLICY IF EXISTS vendor_job_items ON order_items;
CREATE POLICY vendor_job_items ON order_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM vendor_jobs j WHERE j.order_id = order_items.order_id AND j.vendor_id = public.current_vendor_id()));

DROP POLICY IF EXISTS vendor_job_cad ON cad_assets;
CREATE POLICY vendor_job_cad ON cad_assets FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM order_items i JOIN vendor_jobs j ON j.order_id = i.order_id
                 WHERE i.cad_asset_id = cad_assets.id AND j.vendor_id = public.current_vendor_id()));

DROP POLICY IF EXISTS vendor_own_payouts ON vendor_payout_settlements;
CREATE POLICY vendor_own_payouts ON vendor_payout_settlements FOR SELECT TO authenticated USING (vendor_id = public.current_vendor_id());

DROP POLICY IF EXISTS vendor_own_stock ON vendor_material_stock;
CREATE POLICY vendor_own_stock ON vendor_material_stock FOR SELECT TO authenticated USING (vendor_id = public.current_vendor_id());

-- 6. CUSTOMER READ ACCESS ---------------------------------------------------------
DROP POLICY IF EXISTS own_reviews_read ON product_service_reviews;
CREATE POLICY own_reviews_read ON product_service_reviews FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS own_claims_read ON defect_warranty_claims;
CREATE POLICY own_claims_read ON defect_warranty_claims FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS own_referrals_read ON referral_rewards_ledger;
CREATE POLICY own_referrals_read ON referral_rewards_ledger FOR SELECT TO authenticated
  USING (referrer_user_id = auth.uid() OR referred_user_id = auth.uid());

DROP POLICY IF EXISTS own_credit_read ON corporate_credit_accounts;
CREATE POLICY own_credit_read ON corporate_credit_accounts FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS own_credit_ledger_read ON corporate_credit_ledger;
CREATE POLICY own_credit_ledger_read ON corporate_credit_ledger FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM corporate_credit_accounts a WHERE a.id = credit_account_id AND a.user_id = auth.uid()));

DROP POLICY IF EXISTS own_reward_claims_read ON user_review_reward_claims;
CREATE POLICY own_reward_claims_read ON user_review_reward_claims FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS own_credit_notes_read ON gst_credit_notes;
CREATE POLICY own_credit_notes_read ON gst_credit_notes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = gst_credit_notes.order_id AND o.user_id = auth.uid()));

DROP POLICY IF EXISTS public_read ON portal_business_identity;
CREATE POLICY public_read ON portal_business_identity FOR SELECT TO anon, authenticated USING (true);

-- 7. REVIEW REWARD FIX -------------------------------------------------------------
-- The original trigger wrote the reward-claim row BEFORE the review existed,
-- which breaks the foreign key. Record the claim AFTER the review is inserted.
CREATE OR REPLACE FUNCTION public.record_review_reward_claim()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c promo_coupons%ROWTYPE;
BEGIN
  IF NEW.generated_reward_coupon_code IS NULL OR NEW.order_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO c FROM promo_coupons WHERE code = NEW.generated_reward_coupon_code;
  INSERT INTO user_review_reward_claims (user_id, review_id, qualifying_first_order_id, coupon_id, coupon_code,
    reward_summary, discount_type, discount_value, min_order_subtotal_inr, valid_until)
  VALUES (NEW.user_id, NEW.id, NEW.order_id, c.id, c.code, c.description, c.discount_type, c.discount_value,
    c.min_order_subtotal_inr, COALESCE(c.valid_until, NOW() + INTERVAL '45 days'))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_record_review_claim ON product_service_reviews;
CREATE TRIGGER trg_record_review_claim AFTER INSERT ON product_service_reviews
FOR EACH ROW EXECUTE FUNCTION public.record_review_reward_claim();

-- 7b. CRM VIEW: ADMINS ONLY ---------------------------------------------------------
CREATE OR REPLACE VIEW crm_leads_and_prospects_view WITH (security_invoker = on) AS
SELECT
    p.id AS user_id, p.full_name, p.email, p.phone_number, p.company_name, p.gstin,
    p.created_at AS registered_at,
    COUNT(DISTINCT ca.id) AS uploaded_cad_files_count,
    COALESCE(SUM(CASE WHEN o.status IN ('draft', 'pending_payment', 'proforma_issued') THEN o.total_amount ELSE 0 END), 0) AS unpaid_pipeline_value_inr,
    COALESCE(SUM(CASE WHEN o.status IN ('paid', 'in_production', 'packed', 'shipped', 'delivered') THEN o.total_amount ELSE 0 END), 0) AS lifetime_paid_value_inr,
    MAX(ual.created_at) AS last_active_at,
    CASE
        WHEN p.gstin IS NOT NULL OR COALESCE(SUM(CASE WHEN o.status IN ('draft', 'pending_payment', 'proforma_issued') THEN o.total_amount ELSE 0 END), 0) >= 2000 THEN 'HOT_LEAD'
        WHEN COUNT(DISTINCT ca.id) > 0 THEN 'WARM_LEAD_UPLOADED_CAD'
        ELSE 'REGISTERED_BROWSER'
    END AS lead_stage
FROM profiles p
LEFT JOIN cad_assets ca ON ca.user_id = p.id
LEFT JOIN orders o ON o.user_id = p.id
LEFT JOIN user_activity_logs ual ON ual.user_id = p.id
WHERE p.role = 'customer' AND public.is_admin()
GROUP BY p.id, p.full_name, p.email, p.phone_number, p.company_name, p.gstin, p.created_at;
REVOKE ALL ON crm_leads_and_prospects_view FROM anon;

-- 8. ATOMIC MONEY HELPERS (called by the server with the service key) --------------
CREATE OR REPLACE FUNCTION public.use_coupon(p_coupon UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE promo_coupons SET current_uses_count = current_uses_count + 1
  WHERE id = p_coupon AND (max_total_uses IS NULL OR current_uses_count < max_total_uses);
  IF NOT FOUND THEN RAISE EXCEPTION 'Coupon has no uses left.'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.debit_credit_line(p_account UUID, p_order UUID, p_amount NUMERIC) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE corporate_credit_accounts SET used_credit_balance_inr = used_credit_balance_inr + p_amount, updated_at = NOW()
  WHERE id = p_account AND status = 'active' AND (approved_credit_limit_inr - used_credit_balance_inr) >= p_amount;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not enough available credit.'; END IF;
  INSERT INTO corporate_credit_ledger (credit_account_id, order_id, transaction_type, amount_inr)
  VALUES (p_account, p_order, 'order_debit', p_amount);
END $$;

CREATE OR REPLACE FUNCTION public.adjust_wallet(p_user UUID, p_delta NUMERIC) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE profiles SET wallet_balance_inr = wallet_balance_inr + p_delta
  WHERE id = p_user AND wallet_balance_inr + p_delta >= 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet balance too low.'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.use_coupon(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debit_credit_line(UUID, UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.adjust_wallet(UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_fy_gst_invoice_number() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_gst_credit_note_number() FROM PUBLIC, anon;
