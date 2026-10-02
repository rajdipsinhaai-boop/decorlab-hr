-- Job title shown next to each person (Designer, Architect, Supervisor, ...). Descriptive only;
-- the access level stays in the existing role column.
alter table public.allowed_emails add column if not exists position text;
