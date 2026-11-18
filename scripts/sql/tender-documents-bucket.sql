-- tender-detail: the private Storage bucket for the pliegos (tender documents) uploaded on /licitaciones/[id].
--
-- Run ONCE per environment in the Supabase SQL editor. It is NOT applied by the app or by drizzle. Idempotent.
--
-- Same shape as `email-attachments`: the browser uploads straight to the bucket with the signed-in user's own session,
-- inside its own `<auth.uid()>/` folder; the server only receives the path. The one difference is READ: tenders are
-- company-wide, so any signed-in BD may read any pliego (the analysis runs as whoever clicks it). Only the uploader
-- may write or delete inside their folder.
--
-- Object path: `<auth.uid()>/<uuid>/<ascii file name>`. PDF only, 20 MB.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tender-documents', 'tender-documents', false, 20971520, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "tender-documents: own folder insert" on storage.objects;
create policy "tender-documents: own folder insert"
on storage.objects for insert
to authenticated
with check (bucket_id = 'tender-documents' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "tender-documents: any signed-in select" on storage.objects;
create policy "tender-documents: any signed-in select"
on storage.objects for select
to authenticated
using (bucket_id = 'tender-documents');

drop policy if exists "tender-documents: own folder delete" on storage.objects;
create policy "tender-documents: own folder delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'tender-documents' and (storage.foldername(name))[1] = auth.uid()::text);

-- Rollback (run by hand):
--   drop policy if exists "tender-documents: own folder insert" on storage.objects;
--   drop policy if exists "tender-documents: any signed-in select" on storage.objects;
--   drop policy if exists "tender-documents: own folder delete" on storage.objects;
--   delete from storage.objects where bucket_id = 'tender-documents';
--   delete from storage.buckets where id = 'tender-documents';
