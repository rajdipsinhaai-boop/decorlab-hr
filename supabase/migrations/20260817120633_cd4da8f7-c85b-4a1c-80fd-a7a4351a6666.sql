CREATE TYPE public.access_role AS ENUM ('leadership', 'manager');

ALTER TABLE public.allowed_emails
  ADD COLUMN role public.access_role NOT NULL DEFAULT 'leadership';