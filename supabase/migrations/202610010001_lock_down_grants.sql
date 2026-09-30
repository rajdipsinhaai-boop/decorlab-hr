-- The server uses the service role; browsers only need RLS-filtered reads.
-- Remove blanket grants (incl. TRUNCATE, which bypasses RLS) from API roles.
revoke all on public.allowed_emails,
              public.monthly_director_ratings,
              public.monthly_director_rating_details from anon;

revoke truncate, references, trigger on public.allowed_emails,
              public.monthly_director_ratings,
              public.monthly_director_rating_details from authenticated;

-- allowed_emails is read-only for signed-in users (only a SELECT policy exists).
revoke insert, update, delete on public.allowed_emails from authenticated;
