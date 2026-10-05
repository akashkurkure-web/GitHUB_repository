-- ============================================================================
-- 004_owner_admin.sql  —  run AFTER 001, 002 and 003.
-- Makes the owner's account an admin automatically:
--   • if the account already exists, it is upgraded now;
--   • if it doesn't exist yet, it becomes admin the moment it signs up.
-- Keep "Confirm email" ON in Supabase Auth so nobody else can claim this email.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.owner_admin_emails (email TEXT PRIMARY KEY);
ALTER TABLE public.owner_admin_emails ENABLE ROW LEVEL SECURITY;  -- no policies: invisible to the website
INSERT INTO public.owner_admin_emails (email) VALUES ('akash.kurkure@gmail.com') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_user_signup()
RETURNS TRIGGER AS $$
DECLARE
    assigned_role user_role_type := 'customer';
BEGIN
    IF EXISTS (SELECT 1 FROM public.owner_admin_emails WHERE email = lower(NEW.email)) THEN
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
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Already signed up? Upgrade now.
UPDATE public.profiles SET role = 'admin'
WHERE lower(email) IN (SELECT email FROM public.owner_admin_emails);

-- Check: should list akash.kurkure@gmail.com once you have signed up.
SELECT email, role FROM public.profiles WHERE role = 'admin';
