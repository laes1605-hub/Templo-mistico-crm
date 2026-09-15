-- ============================================================================
-- MEDIA A STORAGE (ahorro de Egress)
-- ----------------------------------------------------------------------------
-- Problema: las notas de voz e imágenes enviadas desde el CRM se guardaban
-- como data-URI base64 dentro de mensajes.url_archivo (~1 MB por nota). Cada
-- refetch del chat y cada evento realtime re-transmitía esos megabytes, lo que
-- reventó la cuota de Egress del plan Free (15 GB de 5 GB).
--
-- Solución: los adjuntos van al bucket `media-mensajes` de Supabase Storage y
-- en la tabla sólo queda la URL pública. El archivo se descarga únicamente
-- cuando alguien lo reproduce o lo abre (y el navegador lo cachea).
-- ============================================================================

-- 1) Bucket público de solo-lectura para los adjuntos del chat.
insert into storage.buckets (id, name, public)
values ('media-mensajes', 'media-mensajes', true)
on conflict (id) do update set public = true;

-- 2) Políticas: cualquiera puede LEER (el bucket es público y las URLs son
--    impredecibles); escribir puede hacerlo la app (anon/authenticated),
--    igual que ya puede escribir en la tabla mensajes.
drop policy if exists "media-mensajes lectura publica" on storage.objects;
create policy "media-mensajes lectura publica"
  on storage.objects for select
  using (bucket_id = 'media-mensajes');

drop policy if exists "media-mensajes subir" on storage.objects;
create policy "media-mensajes subir"
  on storage.objects for insert
  with check (bucket_id = 'media-mensajes');

drop policy if exists "media-mensajes actualizar" on storage.objects;
create policy "media-mensajes actualizar"
  on storage.objects for update
  using (bucket_id = 'media-mensajes')
  with check (bucket_id = 'media-mensajes');

drop policy if exists "media-mensajes borrar" on storage.objects;
create policy "media-mensajes borrar"
  on storage.objects for delete
  using (bucket_id = 'media-mensajes');
