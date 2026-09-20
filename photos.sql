-- Optional: private progress photos for the BODY page.
-- Run after setup.sql, in the same tutorial project. No events are changed.
-- This file can be run again. It only replaces the policies it owns.
begin;

-- Other permissive Storage policies are OR-combined with these policies.
-- Stop rather than silently inherit broader read/write access.
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and permissive = 'PERMISSIVE'
      and roles && array['public', 'anon', 'authenticated']::name[]
      and policyname not in ('wire_body_progress_read_v1', 'wire_body_progress_insert_v1')
  ) then
    raise exception 'Other Storage policies already exist. Review their access before adding private BODY photos; this setup did not change anything.';
  end if;

  if exists (
    select 1 from pg_policy p
    where p.polrelid = 'storage.objects'::regclass
      and p.polname in ('wire_body_progress_read_v1', 'wire_body_progress_insert_v1')
      and obj_description(p.oid, 'pg_policy') is distinct from 'wire-starter private BODY photos v1'
  ) then
    raise exception 'A photo policy name is already in use by another setup. Nothing was changed.';
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'body-progress', 'body-progress', false, 6291456,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Never turn an existing public or differently configured bucket into this one.
do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'body-progress' and name = 'body-progress'
      and public = false and file_size_limit = 6291456
      and allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp']
      and allowed_mime_types <@ array['image/jpeg', 'image/png', 'image/webp']
  ) then
    raise exception 'body-progress already exists with different settings. It must be private, limited to 6 MiB, and allow only JPEG, PNG and WebP. Nothing was changed.';
  end if;
end;
$$;

drop policy if exists wire_body_progress_read_v1 on storage.objects;
drop policy if exists wire_body_progress_insert_v1 on storage.objects;

create policy wire_body_progress_read_v1
on storage.objects for select to authenticated
using (
  bucket_id = 'body-progress'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy wire_body_progress_insert_v1
on storage.objects for insert to authenticated
with check (
  bucket_id = 'body-progress'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

comment on policy wire_body_progress_read_v1 on storage.objects
  is 'wire-starter private BODY photos v1';
comment on policy wire_body_progress_insert_v1 on storage.objects
  is 'wire-starter private BODY photos v1';

-- No UPDATE or DELETE policy. New photo paths only; upload with upsert: false.
commit;
