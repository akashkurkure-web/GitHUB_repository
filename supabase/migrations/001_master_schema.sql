-- ============================================================================
-- MASTER DATABASE MIGRATION: 001_master_schema.sql
-- 3D PRINTING & RAPID PROTOTYPING PORTAL (MUMBAI / MAHARASHTRA STATE 27)
-- Source: your Gemini blueprint. Run first, then 002 and 003.
-- ============================================================================

-- 1. ENABLE EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_net";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- 2. CUSTOM ENUM TYPES
DO $$ BEGIN CREATE TYPE user_role_type AS ENUM ('customer', 'vendor', 'admin'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE print_technology AS ENUM ('fdm', 'msla_resin'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE print_material AS ENUM ('pla', 'petg', 'abs', 'asa', 'tpu', 'standard_resin', 'tough_resin'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE material_selection_mode AS ENUM ('manual_user', 'ai_recommended', 'manufacturer_decides'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE cad_storage_tier AS ENUM ('hot_supabase', 'cold_cloud_r2'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE order_status_type AS ENUM (
    'draft', 'pending_payment', 'proforma_issued', 'paid', 'in_production', 'qc_passed', 'packed', 'shipped',
    'out_for_delivery', 'delivered', 'cancelled', 'refunded', 'rto_delivered'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE vendor_job_status_type AS ENUM (
    'queued_for_vendor', 'accepted', 'printing', 'post_processing', 'qc_uploaded', 'packed_ready', 'handed_over', 'rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE coupon_discount_type AS ENUM ('percentage', 'flat_inr', 'free_shipping'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE referral_reward_status AS ENUM ('pending_friend_order', 'in_transit_locked', 'credited_to_wallet', 'voided_order_cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE credit_account_status AS ENUM ('pending_approval', 'active', 'suspended_overdue', 'closed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE review_moderation_status AS ENUM ('published', 'pending_moderation', 'flagged_for_resolution'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE whatsapp_stage_code AS ENUM (
    'LEAD_WELCOME', 'LEAD_ABANDONED_QUOTE', 'B2B_PROFORMA_SENT', 'ORDER_PAID', 'PRINTING_STARTED', 'QC_PASSED_PACKED',
    'ORDER_SHIPPED', 'OUT_FOR_DELIVERY', 'ORDER_DELIVERED', 'REFUND_ISSUED', 'VENDOR_NEW_JOB_ALERT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE defect_claim_type AS ENUM (
    'transit_box_crushed', 'dimensional_tolerance_error', 'missing_batch_quantity', 'surface_delamination'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. CORE BUSINESS IDENTITY, VENDORS & USER PROFILES
CREATE TABLE IF NOT EXISTS portal_business_identity (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    legal_entity_name TEXT NOT NULL DEFAULT 'YOUR BUSINESS LEGAL ENTITY LLP / PVT LTD',
    brand_name TEXT NOT NULL DEFAULT 'YOUR 3D PORTAL BRAND',
    gstin TEXT NOT NULL DEFAULT '27AAAAA0000A1Z5',
    support_email TEXT NOT NULL DEFAULT 'support@your3dportal.in',
    escalation_phone TEXT NOT NULL DEFAULT '+91 98765 43210',
    registered_address_line1 TEXT NOT NULL DEFAULT 'Plot / Shop No, Industrial Area',
    city TEXT NOT NULL DEFAULT 'Navi Mumbai',
    state TEXT NOT NULL DEFAULT 'Maharashtra',
    pincode CHAR(6) NOT NULL DEFAULT '400701',
    country TEXT NOT NULL DEFAULT 'India',
    grievance_officer_name TEXT NOT NULL DEFAULT 'Grievance Officer',
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
INSERT INTO portal_business_identity (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone_number TEXT NOT NULL,
    gstin CHAR(15),
    pan_number CHAR(10),
    shiprocket_pickup_location TEXT NOT NULL DEFAULT 'Mumbai_Primary_Vendor_Hub',
    base_payout_share_percent NUMERIC(5, 2) DEFAULT 45.00 NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    phone_number TEXT,
    company_name TEXT,
    gstin CHAR(15),
    role user_role_type DEFAULT 'customer' NOT NULL,
    is_verified_b2b BOOLEAN DEFAULT FALSE NOT NULL,
    wallet_balance_inr NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
    referral_code TEXT UNIQUE DEFAULT ('REF-' || UPPER(SUBSTR(MD5(RANDOM()::TEXT), 1, 6))),
    referred_by_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    total_referral_earnings_inr NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profiles_referral_code ON profiles(referral_code);

CREATE TABLE IF NOT EXISTS user_activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    email TEXT,
    auth_provider TEXT DEFAULT 'google',
    event_type TEXT NOT NULL CHECK (event_type IN (
        'user_login', 'cad_file_uploaded', 'instant_quote_generated',
        'proforma_downloaded', 'checkout_initiated', 'payment_completed')),
    metadata JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 4. PERMANENT 3D CAD VAULT & ZERO-TRUST SECURITY LOGS
CREATE TABLE IF NOT EXISTS cad_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    guest_session_id TEXT,
    file_name TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    file_hash_sha256 CHAR(64) NOT NULL,
    storage_tier cad_storage_tier DEFAULT 'hot_supabase' NOT NULL,
    cold_archive_key TEXT,
    archived_at TIMESTAMPTZ,
    volume_cm3 NUMERIC(10, 3) NOT NULL,
    surface_area_cm2 NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
    bounding_box_x_mm NUMERIC(8, 2) NOT NULL,
    bounding_box_y_mm NUMERIC(8, 2) NOT NULL,
    bounding_box_z_mm NUMERIC(8, 2) NOT NULL,
    min_wall_thickness_mm NUMERIC(6, 2) DEFAULT 1.50 NOT NULL,
    overhang_percentage NUMERIC(5, 2) DEFAULT 0.00 NOT NULL,
    shell_count INT DEFAULT 1 NOT NULL,
    is_watertight BOOLEAN DEFAULT TRUE NOT NULL,
    was_auto_repaired BOOLEAN DEFAULT FALSE NOT NULL,
    is_cdr_sanitized BOOLEAN DEFAULT TRUE NOT NULL,
    clamav_scan_status TEXT DEFAULT 'CLEAN' NOT NULL,
    validation_status TEXT DEFAULT 'VALID' NOT NULL,
    analysis_warnings JSONB DEFAULT '[]'::jsonb,
    lead_whatsapp_nudge_sent BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cad_assets_guest_session ON cad_assets(guest_session_id);
CREATE INDEX IF NOT EXISTS idx_cad_assets_sha256 ON cad_assets(file_hash_sha256);

CREATE TABLE IF NOT EXISTS cad_download_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cad_asset_id UUID NOT NULL REFERENCES cad_assets(id) ON DELETE RESTRICT,
    downloaded_by_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    downloader_role TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    downloaded_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 5. PRICING CATALOG, FILAMENT STOCK, BATCH TIERS & PROMO COUPONS
CREATE TABLE IF NOT EXISTS material_pricing_catalog (
    material_code print_material PRIMARY KEY,
    display_name TEXT NOT NULL,
    technology print_technology NOT NULL,
    density_g_cm3 NUMERIC(5, 2) NOT NULL,
    retail_rate_per_gram_inr NUMERIC(8, 2) NOT NULL,
    machine_hour_rate_inr NUMERIC(8, 2) NOT NULL,
    print_speed_grams_per_hr NUMERIC(6, 2) NOT NULL,
    base_setup_fee_inr NUMERIC(8, 2) DEFAULT 99.00 NOT NULL,
    minimum_order_value_inr NUMERIC(8, 2) DEFAULT 399.00 NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
INSERT INTO material_pricing_catalog (material_code, display_name, technology, density_g_cm3, retail_rate_per_gram_inr, machine_hour_rate_inr, print_speed_grams_per_hr) VALUES
    ('pla', 'PLA+ (High-Speed Prototyping)', 'fdm', 1.24, 7.50, 45.00, 35.00),
    ('petg', 'PETG (Tough Mechanical & Weatherproof)', 'fdm', 1.27, 9.50, 55.00, 30.00),
    ('abs', 'ABS (High-Temp Enclosure)', 'fdm', 1.04, 12.50, 70.00, 28.00),
    ('asa', 'ASA (Outdoor UV & Automotive)', 'fdm', 1.07, 14.00, 75.00, 28.00),
    ('tpu', 'TPU 95A (Flexible Elastomer)', 'fdm', 1.21, 15.00, 80.00, 18.00),
    ('standard_resin', 'MSLA 8K Standard Resin', 'msla_resin', 1.15, 18.00, 90.00, 22.00),
    ('tough_resin', 'MSLA ABS-Like Tough Resin', 'msla_resin', 1.18, 24.00, 110.00, 20.00)
ON CONFLICT (material_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS vendor_material_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    material_code print_material NOT NULL,
    color_name TEXT NOT NULL,
    color_hex CHAR(7) NOT NULL,
    available_grams NUMERIC(10, 2) DEFAULT 3000.00 NOT NULL,
    low_stock_cutoff_grams NUMERIC(8, 2) DEFAULT 250.00 NOT NULL,
    is_in_stock BOOLEAN DEFAULT TRUE NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE(vendor_id, material_code, color_name)
);

CREATE TABLE IF NOT EXISTS quantity_discount_tiers (
    id SERIAL PRIMARY KEY,
    min_quantity INT NOT NULL UNIQUE CHECK (min_quantity >= 1),
    max_quantity INT,
    discount_percentage NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    tier_badge_label TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL
);
INSERT INTO quantity_discount_tiers (min_quantity, max_quantity, discount_percentage, tier_badge_label) VALUES
    (1, 4, 0.00, 'Standard Prototype (1–4 pcs)'),
    (5, 9, 8.00, 'Small Batch (8% Off)'),
    (10, 24, 15.00, 'Pilot Production (15% Off)'),
    (25, 99, 22.00, 'Volume Production (22% Off)'),
    (100, NULL, 28.00, 'Mass Production (28% Off)')
ON CONFLICT (min_quantity) DO NOTHING;

CREATE TABLE IF NOT EXISTS promo_coupons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL,
    discount_type coupon_discount_type NOT NULL,
    discount_value NUMERIC(10, 2) NOT NULL CHECK (discount_value >= 0),
    min_order_subtotal_inr NUMERIC(10, 2) DEFAULT 499.00 NOT NULL,
    max_discount_cap_inr NUMERIC(10, 2),
    enforce_vendor_cost_floor BOOLEAN DEFAULT TRUE NOT NULL,
    first_order_only BOOLEAN DEFAULT FALSE NOT NULL,
    b2b_gstin_only BOOLEAN DEFAULT FALSE NOT NULL,
    allowed_materials TEXT[] DEFAULT NULL,
    specific_user_email TEXT DEFAULT NULL,
    max_total_uses INT DEFAULT NULL,
    max_uses_per_user INT DEFAULT 1 NOT NULL,
    current_uses_count INT DEFAULT 0 NOT NULL,
    is_public_on_checkout BOOLEAN DEFAULT FALSE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    valid_from TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    valid_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 6. ORDERS, ITEMS, SEQUENTIAL GST COUNTERS, VENDOR JOBS & B2B CREDIT
CREATE TABLE IF NOT EXISTS fy_invoice_counters (fy_label TEXT PRIMARY KEY, last_seq INT DEFAULT 0 NOT NULL);
CREATE TABLE IF NOT EXISTS fy_credit_note_counters (fy_label TEXT PRIMARY KEY, last_seq INT DEFAULT 0 NOT NULL);

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number TEXT UNIQUE NOT NULL DEFAULT ('ORD-' || TO_CHAR(NOW(), 'YYYY') || '-' || UPPER(SUBSTR(MD5(RANDOM()::TEXT), 1, 6))),
    share_token TEXT UNIQUE DEFAULT SUBSTR(MD5(RANDOM()::TEXT), 1, 12),
    user_id UUID REFERENCES profiles(id) ON DELETE RESTRICT,
    status order_status_type DEFAULT 'draft' NOT NULL,
    status_rank INT DEFAULT 0 NOT NULL,
    original_subtotal_amount NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
    coupon_id UUID REFERENCES promo_coupons(id) ON DELETE SET NULL,
    coupon_code TEXT,
    discount_amount NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
    subtotal_amount NUMERIC(10, 2) NOT NULL,
    shipping_amount NUMERIC(10, 2) DEFAULT 90.00 NOT NULL,
    taxable_amount NUMERIC(10, 2) NOT NULL,
    hsn_code VARCHAR(8) DEFAULT '39269099' NOT NULL,
    customer_gstin CHAR(15),
    customer_legal_name TEXT,
    supplier_state_code CHAR(2) DEFAULT '27' NOT NULL,
    place_of_supply_code CHAR(2) DEFAULT '27' NOT NULL,
    is_intra_state BOOLEAN DEFAULT TRUE NOT NULL,
    cgst_amount NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
    sgst_amount NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
    igst_amount NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
    total_amount NUMERIC(10, 2) NOT NULL,
    invoice_number TEXT UNIQUE,
    invoice_pdf_url TEXT,
    proforma_number TEXT UNIQUE,
    proforma_pdf_url TEXT,
    packing_slip_pdf_url TEXT,
    payment_provider TEXT DEFAULT 'razorpay',
    payment_method TEXT,
    payment_id TEXT,
    b2b_po_number TEXT,
    b2b_utr_number TEXT,
    shipping_address JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_mmr_same_day_express BOOLEAN DEFAULT FALSE NOT NULL,
    shiprocket_order_id TEXT,
    shiprocket_shipment_id TEXT,
    courier_partner TEXT,
    tracking_number TEXT,
    shipping_label_url TEXT,
    manifest_url TEXT,
    current_courier_status TEXT,
    tracking_scans JSONB DEFAULT '[]'::jsonb,
    etd TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    cad_asset_id UUID NOT NULL REFERENCES cad_assets(id) ON DELETE RESTRICT,
    selection_mode material_selection_mode DEFAULT 'manual_user' NOT NULL,
    technology print_technology DEFAULT 'fdm' NOT NULL,
    material print_material DEFAULT 'pla' NOT NULL,
    color TEXT DEFAULT 'Matte Black' NOT NULL,
    secondary_accent_color TEXT,
    is_hollowed_resin BOOLEAN DEFAULT FALSE NOT NULL,
    infill_percentage INT DEFAULT 25 NOT NULL,
    layer_height_mm NUMERIC(4, 2) DEFAULT 0.20 NOT NULL,
    scale_unit TEXT DEFAULT 'mm' NOT NULL,
    quantity INT DEFAULT 1 NOT NULL CHECK (quantity >= 1),
    single_unit_base_price NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
    setup_fee_once_inr NUMERIC(8, 2) DEFAULT 99.00 NOT NULL,
    quantity_discount_percent NUMERIC(5, 2) DEFAULT 0.00 NOT NULL,
    estimated_mass_grams NUMERIC(10, 2) NOT NULL,
    total_batch_mass_grams NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
    estimated_build_plate_runs INT DEFAULT 1 NOT NULL,
    unit_price NUMERIC(10, 2) NOT NULL,
    total_line_price NUMERIC(10, 2) NOT NULL,
    application_environment TEXT,
    mechanical_stress_level TEXT,
    customer_application_notes TEXT,
    manufacturer_final_material print_material,
    manufacturer_decision_notes TEXT,
    is_material_locked_by_vendor BOOLEAN DEFAULT FALSE NOT NULL
);

CREATE TABLE IF NOT EXISTS vendor_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_number TEXT UNIQUE NOT NULL DEFAULT ('JOB-' || TO_CHAR(NOW(), 'YYYY') || '-' || UPPER(SUBSTR(MD5(RANDOM()::TEXT), 1, 6))),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
    status vendor_job_status_type DEFAULT 'queued_for_vendor' NOT NULL,
    vendor_payout_amount NUMERIC(10, 2) NOT NULL,
    sla_deadline_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '48 hours'),
    sla_penalty_amount NUMERIC(8, 2) DEFAULT 0.00 NOT NULL,
    actual_weighed_grams NUMERIC(10, 2),
    defect_photo_urls JSONB DEFAULT '[]'::jsonb,
    selected_box_code TEXT DEFAULT 'BOX_S',
    is_warranty_reprint BOOLEAN DEFAULT FALSE NOT NULL,
    reprint_cost_borne_by TEXT CHECK (reprint_cost_borne_by IN ('vendor_fault', 'courier_damage', 'platform_goodwill')),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS gst_credit_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    credit_note_number TEXT UNIQUE NOT NULL,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    original_invoice_number TEXT NOT NULL,
    original_invoice_date DATE NOT NULL,
    customer_gstin TEXT,
    place_of_supply_code CHAR(2) NOT NULL,
    reason_code TEXT NOT NULL DEFAULT '01-Sales Return / Order Cancelled',
    reversed_taxable_amount NUMERIC(10, 2) NOT NULL,
    reversed_cgst_amount NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
    reversed_sgst_amount NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
    reversed_igst_amount NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
    total_credit_amount NUMERIC(10, 2) NOT NULL,
    refund_destination TEXT NOT NULL CHECK (refund_destination IN ('razorpay_source', 'store_wallet')),
    razorpay_refund_id TEXT,
    credit_note_pdf_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coupon_id UUID NOT NULL REFERENCES promo_coupons(id) ON DELETE RESTRICT,
    coupon_code TEXT NOT NULL,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    discount_applied_inr NUMERIC(10, 2) NOT NULL,
    redeemed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE(coupon_id, order_id)
);

CREATE TABLE IF NOT EXISTS corporate_credit_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE RESTRICT,
    company_name TEXT NOT NULL,
    gstin CHAR(15) NOT NULL,
    billing_cycle_days INT DEFAULT 15 CHECK (billing_cycle_days IN (7, 15, 30)),
    approved_credit_limit_inr NUMERIC(12, 2) DEFAULT 25000.00 NOT NULL,
    used_credit_balance_inr NUMERIC(12, 2) DEFAULT 0.00 NOT NULL,
    available_credit_inr NUMERIC(12, 2) GENERATED ALWAYS AS (approved_credit_limit_inr - used_credit_balance_inr) STORED,
    corporate_tier_discount_percent NUMERIC(4, 2) DEFAULT 10.00 NOT NULL,
    status credit_account_status DEFAULT 'pending_approval' NOT NULL,
    next_statement_due_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS corporate_credit_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    credit_account_id UUID NOT NULL REFERENCES corporate_credit_accounts(id) ON DELETE RESTRICT,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('order_debit', 'neft_repayment_credit', 'credit_note_reversal')),
    amount_inr NUMERIC(12, 2) NOT NULL,
    bank_utr_reference TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS vendor_payout_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    settlement_number TEXT UNIQUE NOT NULL,
    vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    total_jobs_count INT NOT NULL,
    gross_base_amount NUMERIC(10, 2) NOT NULL,
    vendor_gst_amount NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
    sla_penalty_deductions NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
    net_transferred_amount NUMERIC(10, 2) NOT NULL,
    gst_itc_held_until_gstr2b NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
    is_gstr2b_verified_and_released BOOLEAN DEFAULT FALSE NOT NULL,
    bank_utr_number TEXT,
    status TEXT DEFAULT 'processing' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 7. REFERRALS, REVIEWS, REWARD LOCK, UX SURVEYS & SUPPORT
CREATE TABLE IF NOT EXISTS referral_rewards_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    referred_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    qualifying_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    friend_discount_inr NUMERIC(8, 2) DEFAULT 200.00 NOT NULL,
    referrer_reward_inr NUMERIC(8, 2) DEFAULT 200.00 NOT NULL,
    status referral_reward_status DEFAULT 'pending_friend_order' NOT NULL,
    credited_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE(referred_user_id)
);

CREATE TABLE IF NOT EXISTS review_reward_settings (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    is_reward_enabled BOOLEAN DEFAULT TRUE NOT NULL,
    discount_type coupon_discount_type DEFAULT 'flat_inr' NOT NULL,
    discount_value NUMERIC(10, 2) DEFAULT 100.00 NOT NULL CHECK (discount_value > 0),
    min_order_subtotal_inr NUMERIC(10, 2) DEFAULT 599.00 NOT NULL,
    max_discount_cap_inr NUMERIC(10, 2) DEFAULT 300.00,
    coupon_validity_days INT DEFAULT 45 NOT NULL CHECK (coupon_validity_days > 0),
    require_verified_order BOOLEAN DEFAULT TRUE NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
INSERT INTO review_reward_settings (id, require_verified_order) VALUES (1, TRUE) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS product_service_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    reviewer_display_name TEXT NOT NULL,
    reviewer_company_or_city TEXT DEFAULT 'Mumbai, MH',
    overall_rating INT NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
    print_surface_quality_rating INT NOT NULL CHECK (print_surface_quality_rating BETWEEN 1 AND 5),
    dimensional_accuracy_rating INT NOT NULL CHECK (dimensional_accuracy_rating BETWEEN 1 AND 5),
    packaging_and_delivery_rating INT NOT NULL CHECK (packaging_and_delivery_rating BETWEEN 1 AND 5),
    material_used print_material,
    technology_used print_technology,
    is_verified_order BOOLEAN DEFAULT FALSE NOT NULL,
    review_title TEXT NOT NULL,
    review_comment TEXT NOT NULL,
    part_photo_urls TEXT[] DEFAULT '{}',
    status review_moderation_status DEFAULT 'published' NOT NULL,
    admin_public_reply TEXT,
    wallet_reward_issued BOOLEAN DEFAULT FALSE NOT NULL,
    generated_reward_coupon_code TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS user_review_reward_claims (
    user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    review_id UUID NOT NULL REFERENCES product_service_reviews(id) ON DELETE CASCADE,
    qualifying_first_order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    coupon_id UUID NOT NULL REFERENCES promo_coupons(id) ON DELETE RESTRICT,
    coupon_code TEXT UNIQUE NOT NULL,
    reward_summary TEXT NOT NULL,
    discount_type coupon_discount_type NOT NULL DEFAULT 'flat_inr',
    discount_value NUMERIC(10, 2) NOT NULL DEFAULT 100.00,
    min_order_subtotal_inr NUMERIC(10, 2) NOT NULL DEFAULT 599.00,
    valid_until TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '45 days'),
    is_redeemed BOOLEAN DEFAULT FALSE NOT NULL,
    redeemed_on_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    redeemed_at TIMESTAMPTZ,
    claimed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS portal_ux_surveys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    guest_session_id TEXT,
    user_friendliness_score INT NOT NULL CHECK (user_friendliness_score BETWEEN 1 AND 5),
    overall_experience_score INT NOT NULL CHECK (overall_experience_score BETWEEN 1 AND 5),
    feedback_tags TEXT[] DEFAULT '{}',
    improvement_comment TEXT,
    exit_page_path TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number TEXT UNIQUE NOT NULL DEFAULT ('TKT-' || TO_CHAR(NOW(), 'YYYY') || '-' || UPPER(SUBSTR(MD5(RANDOM()::TEXT), 1, 6))),
    user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    category TEXT NOT NULL CHECK (category IN ('dfm_help', 'shipping_delay', 'dimensional_defect', 'gst_invoice', 'b2b_quote', 'other')),
    priority TEXT DEFAULT 'high' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    issue_summary TEXT NOT NULL,
    evidence_photo_url TEXT,
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'resolved')),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    sender TEXT NOT NULL CHECK (sender IN ('user', 'assistant', 'system_tool')),
    message_text TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS defect_warranty_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_number TEXT UNIQUE NOT NULL DEFAULT ('CLM-' || TO_CHAR(NOW(), 'YYYY') || '-' || UPPER(SUBSTR(MD5(RANDOM()::TEXT), 1, 5))),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    claim_type defect_claim_type NOT NULL,
    customer_description TEXT NOT NULL,
    unboxing_or_caliper_photo_urls TEXT[] NOT NULL,
    status TEXT DEFAULT 'pending_admin_review' CHECK (status IN ('pending_admin_review', 'reprint_dispatched', 'rejected_outside_tolerance')),
    fault_attributed_to TEXT CHECK (fault_attributed_to IN ('vendor_fault', 'courier_damage', 'platform_goodwill')),
    reprint_vendor_job_id UUID REFERENCES vendor_jobs(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS whatsapp_notification_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    cad_asset_id UUID REFERENCES cad_assets(id) ON DELETE SET NULL,
    recipient_phone TEXT NOT NULL,
    stage_code whatsapp_stage_code NOT NULL,
    meta_message_id TEXT,
    delivery_status TEXT DEFAULT 'queued' CHECK (delivery_status IN ('queued', 'sent', 'delivered', 'read', 'failed')),
    error_message TEXT,
    sent_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE NULLS NOT DISTINCT (user_id, order_id, cad_asset_id, stage_code)
);

-- 8. ANALYTICAL VIEW FOR POTENTIAL LEADS & ABANDONED CAD QUOTES
CREATE OR REPLACE VIEW crm_leads_and_prospects_view AS
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
WHERE p.role = 'customer'
GROUP BY p.id, p.full_name, p.email, p.phone_number, p.company_name, p.gstin, p.created_at;

-- 9. CORE FUNCTIONS, TRIGGERS & RPC BUSINESS GUARDRAILS
CREATE OR REPLACE FUNCTION public.handle_new_user_signup()
RETURNS TRIGGER AS $$
DECLARE
    matched_vendor_id UUID;
    assigned_role user_role_type := 'customer';
BEGIN
    SELECT id INTO matched_vendor_id FROM public.vendors WHERE email = NEW.email LIMIT 1;
    IF matched_vendor_id IS NOT NULL THEN assigned_role := 'vendor'; END IF;
    INSERT INTO public.profiles (id, email, full_name, phone_number, role)
    VALUES (NEW.id, NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
        COALESCE(NEW.phone, NEW.raw_user_meta_data->>'phone', ''),
        assigned_role)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_signup();

CREATE OR REPLACE FUNCTION claim_guest_cad_assets(p_guest_session_id TEXT)
RETURNS INT AS $$
DECLARE claimed_count INT;
BEGIN
    UPDATE cad_assets SET user_id = auth.uid(), guest_session_id = NULL
    WHERE guest_session_id = p_guest_session_id AND user_id IS NULL;
    GET DIAGNOSTICS claimed_count = ROW_COUNT;
    RETURN claimed_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION prevent_unauthorized_cad_deletion()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('app.admin_manual_delete', true) IS DISTINCT FROM 'ON' THEN
        RAISE EXCEPTION 'SECURITY LOCK: 3D CAD assets cannot be deleted automatically. Only manual Admin override is permitted.';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_cad_vault ON cad_assets;
CREATE TRIGGER trg_protect_cad_vault BEFORE DELETE ON cad_assets
FOR EACH ROW EXECUTE FUNCTION prevent_unauthorized_cad_deletion();

CREATE OR REPLACE FUNCTION generate_fy_gst_invoice_number()
RETURNS TEXT AS $$
DECLARE
    curr_year INT := EXTRACT(YEAR FROM NOW() AT TIME ZONE 'Asia/Kolkata');
    curr_month INT := EXTRACT(MONTH FROM NOW() AT TIME ZONE 'Asia/Kolkata');
    fy_str TEXT; next_val INT;
BEGIN
    IF curr_month >= 4 THEN
        fy_str := LPAD((curr_year % 100)::TEXT, 2, '0') || '-' || LPAD(((curr_year + 1) % 100)::TEXT, 2, '0');
    ELSE
        fy_str := LPAD(((curr_year - 1) % 100)::TEXT, 2, '0') || '-' || LPAD((curr_year % 100)::TEXT, 2, '0');
    END IF;
    INSERT INTO fy_invoice_counters (fy_label, last_seq) VALUES (fy_str, 1)
    ON CONFLICT (fy_label) DO UPDATE SET last_seq = fy_invoice_counters.last_seq + 1
    RETURNING last_seq INTO next_val;
    RETURN 'MH' || fy_str || '/' || LPAD(next_val::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_gst_credit_note_number()
RETURNS TEXT AS $$
DECLARE
    curr_year INT := EXTRACT(YEAR FROM NOW() AT TIME ZONE 'Asia/Kolkata');
    curr_month INT := EXTRACT(MONTH FROM NOW() AT TIME ZONE 'Asia/Kolkata');
    fy_str TEXT; next_val INT;
BEGIN
    IF curr_month >= 4 THEN
        fy_str := LPAD((curr_year % 100)::TEXT, 2, '0') || '-' || LPAD(((curr_year + 1) % 100)::TEXT, 2, '0');
    ELSE
        fy_str := LPAD(((curr_year - 1) % 100)::TEXT, 2, '0') || '-' || LPAD((curr_year % 100)::TEXT, 2, '0');
    END IF;
    INSERT INTO fy_credit_note_counters (fy_label, last_seq) VALUES (fy_str, 1)
    ON CONFLICT (fy_label) DO UPDATE SET last_seq = fy_credit_note_counters.last_seq + 1
    RETURNING last_seq INTO next_val;
    RETURN 'CN' || fy_str || '/' || LPAD(next_val::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION process_new_product_review()
RETURNS TRIGGER AS $$
DECLARE
    v_qualifying_order_id UUID;
    v_item order_items%ROWTYPE;
    v_profile profiles%ROWTYPE;
    v_config review_reward_settings%ROWTYPE;
    v_already_claimed BOOLEAN;
    v_new_code TEXT;
    v_new_coupon_id UUID;
    v_desc TEXT;
    v_expiry TIMESTAMPTZ;
BEGIN
    SELECT * INTO v_profile FROM profiles WHERE id = NEW.user_id;
    SELECT id INTO v_qualifying_order_id FROM orders
    WHERE user_id = NEW.user_id
      AND status IN ('paid', 'in_production', 'packed', 'shipped', 'out_for_delivery', 'delivered')
      AND (NEW.order_id IS NULL OR id = NEW.order_id)
    ORDER BY created_at DESC LIMIT 1;

    IF v_qualifying_order_id IS NOT NULL THEN
        NEW.is_verified_order := TRUE;
        NEW.order_id := v_qualifying_order_id;
        SELECT * INTO v_item FROM order_items WHERE order_id = v_qualifying_order_id LIMIT 1;
        NEW.material_used := v_item.material;
        NEW.technology_used := v_item.technology;
    ELSE
        NEW.is_verified_order := FALSE;
    END IF;

    IF NEW.overall_rating <= 2 OR NEW.dimensional_accuracy_rating <= 2 THEN
        NEW.status := 'flagged_for_resolution';
    ELSE
        NEW.status := 'published';
    END IF;

    SELECT * INTO v_config FROM review_reward_settings WHERE id = 1;
    SELECT EXISTS(SELECT 1 FROM user_review_reward_claims WHERE user_id = NEW.user_id) INTO v_already_claimed;

    IF v_config.is_reward_enabled = TRUE AND v_qualifying_order_id IS NOT NULL AND v_already_claimed = FALSE THEN
        v_new_code := 'RWD-' || UPPER(SUBSTR(MD5(NEW.user_id::TEXT || NOW()::TEXT), 1, 6));
        v_expiry := NOW() + (v_config.coupon_validity_days || ' days')::INTERVAL;
        IF v_config.discount_type = 'percentage' THEN
            v_desc := 'Thank-You Reward: ' || v_config.discount_value || '% OFF (Up to ₹' || COALESCE(v_config.max_discount_cap_inr, 500) || ') on your next order';
        ELSE
            v_desc := 'Thank-You Reward: Flat ₹' || v_config.discount_value || ' OFF on your next order';
        END IF;

        INSERT INTO promo_coupons (
            code, description, discount_type, discount_value, min_order_subtotal_inr,
            max_discount_cap_inr, enforce_vendor_cost_floor, specific_user_email,
            max_total_uses, max_uses_per_user, is_public_on_checkout, is_active, valid_until
        ) VALUES (
            v_new_code, v_desc, v_config.discount_type, v_config.discount_value,
            v_config.min_order_subtotal_inr, v_config.max_discount_cap_inr, TRUE,
            v_profile.email, 1, 1, FALSE, TRUE, v_expiry
        ) RETURNING id INTO v_new_coupon_id;

        -- NOTE: review row is inserted after this BEFORE trigger, so the claim row
        -- (which references review_id) is written by trg_record_review_claim in 003.
        NEW.generated_reward_coupon_code := v_new_code;
        NEW.wallet_reward_issued := TRUE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_process_product_review ON product_service_reviews;
CREATE TRIGGER trg_process_product_review BEFORE INSERT ON product_service_reviews
FOR EACH ROW EXECUTE FUNCTION process_new_product_review();
