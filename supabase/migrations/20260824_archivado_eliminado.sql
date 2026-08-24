-- ============================================================================
-- 📦 ARCHIVADOS Y ELIMINADOS — Templo Místico CRM
-- Agrega soporte para archivar conversaciones (personas que no contestan)
-- y preparar borrado lógico
-- ============================================================================

-- Agregar columnas de archivado a conversaciones
alter table public.conversaciones
  add column if not exists archivada boolean not null default false,
  add column if not exists fecha_archivado timestamptz,
  add column if not exists motivo_archivado text;

-- Índice para filtrar archivadas rápido
create index if not exists conversaciones_archivada_idx on public.conversaciones (archivada);
create index if not exists conversaciones_fecha_archivado_idx on public.conversaciones (fecha_archivado desc) where archivada = true;

-- Opcional: vista de conversaciones activas vs archivadas
create or replace view public.v_conversaciones_activas as
select * from public.conversaciones where archivada = false;

create or replace view public.v_conversaciones_archivadas as
select * from public.conversaciones where archivada = true;

-- Comentarios para documentación
comment on column public.conversaciones.archivada is 'Si true, la conversación está archivada (no contestan)';
comment on column public.conversaciones.fecha_archivado is 'Fecha en que se archivó';
comment on column public.conversaciones.motivo_archivado is 'Motivo opcional: inactivo_7d, manual, no_responde, etc';

-- Función helper para auto-archivar inactivos > X días
create or replace function public.archivar_conversaciones_inactivas(dias int default 7)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  filas integer;
begin
  update public.conversaciones
  set archivada = true,
      fecha_archivado = now(),
      motivo_archivado = 'inactivo_' || dias || 'd'
  where archivada = false
    and ultimo_mensaje_en < now() - (dias || ' days')::interval;
  
  get diagnostics filas = row_count;
  return filas;
end;
$$;

-- Permisos RLS ya existentes deberían cubrir la nueva columna, pero por si acaso:
-- La anon key ya puede leer (si tenías política de lectura pública)
-- Si usas service_role para escrituras, no necesitas política extra
