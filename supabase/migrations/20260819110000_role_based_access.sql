-- Role-based access for the Decorlab HR dashboard.
-- Existing leadership accounts are treated as admins for backward compatibility.
DO $$
BEGIN
  ALTER TYPE public.access_role ADD VALUE IF NOT EXISTS 'admin';
  ALTER TYPE public.access_role ADD VALUE IF NOT EXISTS 'employee';
EXCEPTION
  WHEN undefined_object THEN
    CREATE TYPE public.access_role AS ENUM ('admin', 'manager', 'employee');
END $$;

ALTER TABLE public.allowed_emails
  ADD COLUMN IF NOT EXISTS employee_id text,
  ADD COLUMN IF NOT EXISTS employee_name text;

UPDATE public.allowed_emails
SET role = 'admin'
WHERE lower(email) = lower('rajdipsinhaai@gmail.com');

UPDATE public.allowed_emails
SET role = 'admin'
WHERE role = 'leadership';

ALTER TABLE public.allowed_emails
  ALTER COLUMN role SET DEFAULT 'employee';

COMMENT ON COLUMN public.allowed_emails.employee_id IS 'Employee Master identifier for manager/employee report-card matching.';
COMMENT ON COLUMN public.allowed_emails.employee_name IS 'Employee Master name for manager/employee report-card matching.';
