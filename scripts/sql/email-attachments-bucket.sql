-- email-attachments-recipients: the private Storage bucket for files attached to composed emails.
--
-- Run ONCE per environment in the Supabase SQL editor (Dashboard -> SQL Editor). It is NOT applied by the app or by
-- drizzle. Idempotent: running it again only re-asserts the same bucket settings and policies.
--
-- Mirrors `linkedin-imports` (README, "LinkedIn messages import"): the browser uploads straight to the bucket with the
-- signed-in user's own session, inside its own `<auth.uid()>/` folder; the server only receives the path. A file never
-- goes through a server action (Vercel caps request bodies at about 4.5 MB). The CRM does not keep the files: the app
-- deletes each object right after the send, and a sweeper deletes orphans (see src/lib/email/attachments/sweep.ts).
--
-- Object path: `<auth.uid()>/<uuid>/<ascii file name>`.
-- Scheduled emails are sent by a cron job with no user session; that path uses the service-role key
-- (SUPABASE_SERVICE_ROLE_KEY, server-only), which bypasses these policies.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'email-attachments',
  'email-attachments',
  false,
  6291456, -- 6 MB per file (the app also enforces 5 files and 10 MB in total)
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'image/png',
    'image/jpeg',
    'text/plain',
    'text/csv'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "email-attachments: own folder insert" on storage.objects;
create policy "email-attachments: own folder insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'email-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "email-attachments: own folder select" on storage.objects;
create policy "email-attachments: own folder select"
on storage.objects for select
to authenticated
using (
  bucket_id = 'email-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "email-attachments: own folder delete" on storage.objects;
create policy "email-attachments: own folder delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'email-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Rollback / cleanup (run by hand; do not leave enabled):
--   drop policy if exists "email-attachments: own folder insert" on storage.objects;
--   drop policy if exists "email-attachments: own folder select" on storage.objects;
--   drop policy if exists "email-attachments: own folder delete" on storage.objects;
--   delete from storage.objects where bucket_id = 'email-attachments';  -- or empty it from the dashboard
--   delete from storage.buckets where id = 'email-attachments';
