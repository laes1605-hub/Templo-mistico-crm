-- ============================================================================
-- 🚀 MIGRACIÓN COMPLETA A NUEVO SUPABASE — Templo Místico CRM
-- Proyecto destino: zcljlddtcoyfyvshlyfk
-- ----------------------------------------------------------------------------
-- CÓMO USAR ESTE ARCHIVO (2 minutos):
--   1. Abre https://supabase.com/dashboard/project/zcljlddtcoyfyvshlyfk/sql/new
--   2. Pega TODO el contenido de este archivo
--   3. Pulsa RUN (o Ctrl+Enter)
--   4. Si aparece algún error al final, avísanos y revisamos.
--
-- Este archivo concatena las 26 migraciones del proyecto EN ORDEN.
-- Todas son idempotentes: si algo falla a mitad, se puede volver a correr
-- completo sin romper lo que ya se aplicó.
-- ============================================================================

BEGIN;

-- ############################################################################
-- [01/26] 20260824_archivado_eliminado.sql
-- ############################################################################

-- ============================================================================
-- 📦 ARCHIVADOS Y ELIMINADOS — Templo Místico CRM (FIXED)
-- Versión corregida que no falla en Supabase
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='conversaciones' AND column_name='archivada') THEN
    ALTER TABLE public.conversaciones ADD COLUMN archivada boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='conversaciones' AND column_name='fecha_archivado') THEN
    ALTER TABLE public.conversaciones ADD COLUMN fecha_archivado timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='conversaciones' AND column_name='motivo_archivado') THEN
    ALTER TABLE public.conversaciones ADD COLUMN motivo_archivado text;
  END IF;
  -- Asegurar valores por defecto
  EXECUTE 'UPDATE public.conversaciones SET archivada = false WHERE archivada IS NULL';
  BEGIN
    ALTER TABLE public.conversaciones ALTER COLUMN archivada SET NOT NULL;
  EXCEPTION WHEN others THEN NULL;
  END;
  ALTER TABLE public.conversaciones ALTER COLUMN archivada SET DEFAULT false;
END $$;

CREATE INDEX IF NOT EXISTS conversaciones_archivada_idx ON public.conversaciones (archivada);
CREATE INDEX IF NOT EXISTS conversaciones_fecha_archivado_idx ON public.conversaciones (fecha_archivado DESC) WHERE archivada = true;

CREATE OR REPLACE VIEW public.v_conversaciones_activas AS SELECT * FROM public.conversaciones WHERE archivada = false;
CREATE OR REPLACE VIEW public.v_conversaciones_archivadas AS SELECT * FROM public.conversaciones WHERE archivada = true;

CREATE OR REPLACE FUNCTION public.archivar_conversaciones_inactivas(dias int DEFAULT 7)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE filas integer;
BEGIN
  UPDATE public.conversaciones SET archivada = true, fecha_archivado = now(), motivo_archivado = 'inactivo_' || dias || 'd'
  WHERE archivada = false AND ultimo_mensaje_en < now() - (dias || ' days')::interval;
  GET DIAGNOSTICS filas = ROW_COUNT; RETURN filas;
END; $$;


-- ############################################################################
-- [02/26] 20260824_fase3_cerebro_ia.sql
-- ############################################################################

-- ============================================================================
-- 🧠 FASE 3: CEREBRO IA (Auto-Aprendizaje de Ventas) — Templo Místico CRM
-- ----------------------------------------------------------------------------
-- Ejecutar TODO este archivo en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede volver a correr sin romper nada.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- 1. TABLA PRINCIPAL: cerebro_reglas
--    Cada fila es una "lección de venta" que Luna aprendió de una conversación
--    real que terminó en pago o agendamiento.
-- ============================================================================
create table if not exists public.cerebro_reglas (
  id                uuid primary key default gen_random_uuid(),

  -- Contenido de la lección
  titulo            text not null,
  regla             text not null,            -- Instrucción que se inyecta al prompt de Luna
  categoria         text not null default 'cierre',
  ejemplo           text,                     -- Frase textual real que funcionó
  justificacion     text,                     -- Por qué la IA cree que funciona
  impacto_estimado  text,                     -- alto | medio | bajo

  -- Scoring y control
  confianza         numeric(4,3) not null default 0.500,  -- 0.000 a 1.000
  prioridad         integer not null default 0,           -- Mayor = se inyecta primero
  estado            text not null default 'pendiente',    -- pendiente|aprobada|rechazada|archivada

  -- Trazabilidad
  origen            text not null default 'n8n_extractor',-- n8n_extractor|crm_manual|crm_extract
  cliente_id        uuid references public.clientes(id) on delete set null,
  conversacion_id   uuid references public.conversaciones(id) on delete set null,
  evidencia         jsonb not null default '{}'::jsonb,   -- Fragmentos, monto, canal, etc.

  -- Métricas de uso (cuántas veces Luna la cargó en su memoria)
  veces_usada       integer not null default 0,
  ultima_inyeccion_en timestamptz,

  -- Anti-duplicados: hash del texto normalizado de la regla
  hash_regla        text unique,

  -- Auditoría de aprobación
  revisado_en       timestamptz,
  revisado_por      text,
  nota_revision     text,

  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now()
);

-- Compatibilidad con instalaciones donde `cerebro_reglas` ya existía antes
-- de esta versión. `create table if not exists` NO agrega las columnas que
-- falten a una tabla existente; por eso, sin este bloque, una tabla antigua
-- puede fallar más abajo al crear el check de `confianza`.
alter table public.cerebro_reglas
  add column if not exists titulo text,
  add column if not exists regla text,
  add column if not exists categoria text default 'cierre',
  add column if not exists ejemplo text,
  add column if not exists justificacion text,
  add column if not exists impacto_estimado text,
  add column if not exists confianza numeric(4,3) default 0.500,
  add column if not exists prioridad integer default 0,
  add column if not exists estado text default 'pendiente',
  add column if not exists origen text default 'n8n_extractor',
  add column if not exists cliente_id uuid references public.clientes(id) on delete set null,
  add column if not exists conversacion_id uuid references public.conversaciones(id) on delete set null,
  add column if not exists evidencia jsonb default '{}'::jsonb,
  add column if not exists veces_usada integer default 0,
  add column if not exists ultima_inyeccion_en timestamptz,
  add column if not exists hash_regla text,
  add column if not exists revisado_en timestamptz,
  add column if not exists revisado_por text,
  add column if not exists nota_revision text,
  add column if not exists creado_en timestamptz default now(),
  add column if not exists actualizado_en timestamptz default now();

-- Completa valores nulos de tablas antiguas antes de aplicar las restricciones.
update public.cerebro_reglas
set confianza = coalesce(confianza, 0.500),
    prioridad = coalesce(prioridad, 0),
    estado = coalesce(estado, 'pendiente'),
    categoria = coalesce(categoria, 'cierre'),
    origen = coalesce(origen, 'n8n_extractor'),
    evidencia = coalesce(evidencia, '{}'::jsonb),
    veces_usada = coalesce(veces_usada, 0),
    creado_en = coalesce(creado_en, now()),
    actualizado_en = coalesce(actualizado_en, now());

alter table public.cerebro_reglas
  alter column confianza set default 0.500,
  alter column confianza set not null,
  alter column prioridad set default 0,
  alter column prioridad set not null,
  alter column estado set default 'pendiente',
  alter column estado set not null,
  alter column categoria set default 'cierre',
  alter column categoria set not null,
  alter column origen set default 'n8n_extractor',
  alter column origen set not null,
  alter column evidencia set default '{}'::jsonb,
  alter column evidencia set not null,
  alter column veces_usada set default 0,
  alter column veces_usada set not null,
  alter column creado_en set default now(),
  alter column creado_en set not null,
  alter column actualizado_en set default now(),
  alter column actualizado_en set not null;

-- Restricciones de dominio (se agregan sólo si no existen)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cerebro_reglas'::regclass
      and contype = 'u'
      and conkey = array[(select attnum from pg_attribute where attrelid = 'public.cerebro_reglas'::regclass and attname = 'hash_regla')]
  ) then
    alter table public.cerebro_reglas
      add constraint cerebro_reglas_hash_regla_key unique (hash_regla);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'cerebro_reglas_estado_check') then
    alter table public.cerebro_reglas
      add constraint cerebro_reglas_estado_check
      check (estado in ('pendiente','aprobada','rechazada','archivada'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'cerebro_reglas_categoria_check') then
    alter table public.cerebro_reglas
      add constraint cerebro_reglas_categoria_check
      check (categoria in (
        'cierre','objecion','precio','urgencia','empatia',
        'agendamiento','seguimiento','confianza','descubrimiento','otro'
      ));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'cerebro_reglas_confianza_check') then
    alter table public.cerebro_reglas
      add constraint cerebro_reglas_confianza_check
      check (confianza >= 0 and confianza <= 1);
  end if;
end $$;

create index if not exists cerebro_reglas_estado_idx     on public.cerebro_reglas (estado);
create index if not exists cerebro_reglas_categoria_idx  on public.cerebro_reglas (categoria);
create index if not exists cerebro_reglas_creado_idx     on public.cerebro_reglas (creado_en desc);
create index if not exists cerebro_reglas_activas_idx    on public.cerebro_reglas (prioridad desc, confianza desc)
  where estado = 'aprobada';

-- ============================================================================
-- 2. TABLA DE BITÁCORA: cerebro_ejecuciones
--    Registra cada corrida del extractor (n8n semanal o botón manual del CRM).
-- ============================================================================
create table if not exists public.cerebro_ejecuciones (
  id                    uuid primary key default gen_random_uuid(),
  origen                text not null default 'n8n_extractor',
  estado                text not null default 'ok',        -- ok | error
  conversaciones_analizadas integer not null default 0,
  mensajes_analizados   integer not null default 0,
  reglas_sugeridas      integer not null default 0,
  reglas_nuevas         integer not null default 0,
  reglas_duplicadas     integer not null default 0,
  modelo                text,
  detalle               jsonb not null default '{}'::jsonb,
  error                 text,
  creado_en             timestamptz not null default now()
);

-- Igual que con las reglas, actualiza una eventual tabla creada por una versión
-- anterior del archivo antes de crear índices o activar RLS.
alter table public.cerebro_ejecuciones
  add column if not exists origen text default 'n8n_extractor',
  add column if not exists estado text default 'ok',
  add column if not exists conversaciones_analizadas integer default 0,
  add column if not exists mensajes_analizados integer default 0,
  add column if not exists reglas_sugeridas integer default 0,
  add column if not exists reglas_nuevas integer default 0,
  add column if not exists reglas_duplicadas integer default 0,
  add column if not exists modelo text,
  add column if not exists detalle jsonb default '{}'::jsonb,
  add column if not exists error text,
  add column if not exists creado_en timestamptz default now();

update public.cerebro_ejecuciones
set origen = coalesce(origen, 'n8n_extractor'),
    estado = coalesce(estado, 'ok'),
    conversaciones_analizadas = coalesce(conversaciones_analizadas, 0),
    mensajes_analizados = coalesce(mensajes_analizados, 0),
    reglas_sugeridas = coalesce(reglas_sugeridas, 0),
    reglas_nuevas = coalesce(reglas_nuevas, 0),
    reglas_duplicadas = coalesce(reglas_duplicadas, 0),
    detalle = coalesce(detalle, '{}'::jsonb),
    creado_en = coalesce(creado_en, now());

alter table public.cerebro_ejecuciones
  alter column origen set default 'n8n_extractor',
  alter column origen set not null,
  alter column estado set default 'ok',
  alter column estado set not null,
  alter column conversaciones_analizadas set default 0,
  alter column conversaciones_analizadas set not null,
  alter column mensajes_analizados set default 0,
  alter column mensajes_analizados set not null,
  alter column reglas_sugeridas set default 0,
  alter column reglas_sugeridas set not null,
  alter column reglas_nuevas set default 0,
  alter column reglas_nuevas set not null,
  alter column reglas_duplicadas set default 0,
  alter column reglas_duplicadas set not null,
  alter column detalle set default '{}'::jsonb,
  alter column detalle set not null,
  alter column creado_en set default now(),
  alter column creado_en set not null;

create index if not exists cerebro_ejecuciones_creado_idx on public.cerebro_ejecuciones (creado_en desc);

-- ============================================================================
-- 3. TRIGGER: mantener actualizado_en
-- ============================================================================
create or replace function public.cerebro_touch_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en = now();
  return new;
end;
$$;

drop trigger if exists cerebro_reglas_touch on public.cerebro_reglas;
create trigger cerebro_reglas_touch
  before update on public.cerebro_reglas
  for each row execute function public.cerebro_touch_actualizado_en();

-- ============================================================================
-- 4. VISTA: cerebro_memoria_activa
--    Lo que Luna realmente carga en su cabeza (sólo reglas APROBADAS).
-- ============================================================================
create or replace view public.cerebro_memoria_activa as
select
  id, titulo, regla, categoria, ejemplo, confianza, prioridad,
  veces_usada, revisado_en
from public.cerebro_reglas
where estado = 'aprobada'
order by prioridad desc, confianza desc, revisado_en desc nulls last;

-- ============================================================================
-- 5. RPC: cerebro_registrar_uso(ids)
--    n8n la llama después de inyectar la memoria en Luna, para saber qué
--    reglas se están usando de verdad.
-- ============================================================================
create or replace function public.cerebro_registrar_uso(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  filas integer;
begin
  update public.cerebro_reglas
     set veces_usada = veces_usada + 1,
         ultima_inyeccion_en = now()
   where id = any(p_ids);
  get diagnostics filas = row_count;
  return filas;
end;
$$;

-- ============================================================================
-- 6. RPC: cerebro_prompt_luna()
--    Devuelve el bloque de texto listo para pegar en el System Prompt de Luna.
--    Útil si querés que n8n lo saque con una sola llamada RPC.
-- ============================================================================
create or replace function public.cerebro_prompt_luna()
returns text
language sql
stable
as $$
  select case
    when count(*) = 0 then ''
    else
      '=== MEMORIA DE VENTAS APRENDIDA (CEREBRO DE LUNA) ===' || E'\n' ||
      'Lecciones extraídas de conversaciones reales del Templo Místico que terminaron en PAGO o AGENDAMIENTO.' || E'\n' ||
      'Aplicalas de forma natural, nunca las menciones ni las leas literalmente.' || E'\n\n' ||
      string_agg(
        '• [' || upper(categoria) || '] ' || titulo || ': ' || regla ||
        coalesce(E'\n  Ejemplo real: "' || ejemplo || '"', ''),
        E'\n'
        order by prioridad desc, confianza desc
      ) || E'\n\n=== FIN DE LA MEMORIA APRENDIDA ==='
  end
  from public.cerebro_reglas
  where estado = 'aprobada';
$$;

-- ============================================================================
-- 7. SEGURIDAD (RLS)
--    El CRM lee con la anon key; las escrituras van por la API de Next.js
--    usando la SERVICE ROLE KEY (que ignora RLS).
-- ============================================================================
alter table public.cerebro_reglas      enable row level security;
alter table public.cerebro_ejecuciones enable row level security;

drop policy if exists "cerebro_reglas_lectura_publica" on public.cerebro_reglas;
create policy "cerebro_reglas_lectura_publica"
  on public.cerebro_reglas for select
  using (true);

drop policy if exists "cerebro_ejecuciones_lectura_publica" on public.cerebro_ejecuciones;
create policy "cerebro_ejecuciones_lectura_publica"
  on public.cerebro_ejecuciones for select
  using (true);

-- ⚠️ OPCIONAL — Descomentá SOLO si NO vas a configurar SUPABASE_SERVICE_ROLE_KEY
-- en Vercel. Permite que el CRM apruebe/rechace reglas con la anon key.
--
-- drop policy if exists "cerebro_reglas_escritura_anon" on public.cerebro_reglas;
-- create policy "cerebro_reglas_escritura_anon"
--   on public.cerebro_reglas for all
--   using (true) with check (true);
--
-- drop policy if exists "cerebro_ejecuciones_escritura_anon" on public.cerebro_ejecuciones;
-- create policy "cerebro_ejecuciones_escritura_anon"
--   on public.cerebro_ejecuciones for all
--   using (true) with check (true);

-- ============================================================================
-- 8. REALTIME: para que las tarjetas del CRM se actualicen solas
-- ============================================================================
do $$
begin
  begin
    alter publication supabase_realtime add table public.cerebro_reglas;
  exception when duplicate_object then null;
  end;
end $$;

-- ============================================================================
-- 9. SEMILLA DE EJEMPLO (opcional, borrala si no la querés)
--    Sirve para ver la pestaña "Cerebro" funcionando antes de la 1ª extracción.
-- ============================================================================
insert into public.cerebro_reglas
  (titulo, regla, categoria, ejemplo, justificacion, impacto_estimado, confianza, prioridad, estado, origen, hash_regla)
values
  (
    'Nombrar el dolor antes del precio',
    'Antes de mencionar cualquier valor, repetile al cliente con sus propias palabras el dolor que te contó y confirmá que lo entendiste. Sólo después presentá la inversión del trabajo.',
    'precio',
    'Entiendo perfectamente: llevas 3 meses sin saber nada de él y sientes que hay una tercera persona de por medio. Eso te está quitando el sueño. El trabajo de amarre que necesitas tiene una inversión de...',
    'En las conversaciones cerradas, el precio siempre llegó después de un espejo emocional; cuando el precio se dio primero, el lead se enfrió.',
    'alto',
    0.850, 10, 'pendiente', 'seed',
    'seed-nombrar-el-dolor-antes-del-precio'
  )
on conflict (hash_regla) do nothing;

-- ============================================================================
-- ✅ LISTO. Verificá con:
--    select * from public.cerebro_reglas;
--    select public.cerebro_prompt_luna();
-- ============================================================================


-- ############################################################################
-- [03/26] 20260825_fix_all.sql
-- ############################################################################

-- ============================================================================
-- FIX MIGRACION ARCHIVADOS + NOTAS PERSONALES + DIVISAS
-- Esta migración es 100% compatible y no falla si las columnas ya existen
-- Ejecutar en Supabase SQL Editor
-- ============================================================================

-- 1. ARCHIVADOS (versión corregida, sin NOT NULL inmediato)
-- Primero agregamos la columna nullable, luego la llenamos, luego ponemos default
DO $$
BEGIN
  -- archivada
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='conversaciones' AND column_name='archivada') THEN
    ALTER TABLE public.conversaciones ADD COLUMN archivada boolean DEFAULT false;
  END IF;
  
  -- fecha_archivado
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='conversaciones' AND column_name='fecha_archivado') THEN
    ALTER TABLE public.conversaciones ADD COLUMN fecha_archivado timestamptz;
  END IF;

  -- motivo_archivado
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='conversaciones' AND column_name='motivo_archivado') THEN
    ALTER TABLE public.conversaciones ADD COLUMN motivo_archivado text;
  END IF;

  -- Actualizar nulls a false
  EXECUTE 'UPDATE public.conversaciones SET archivada = false WHERE archivada IS NULL';

  -- Ahora poner NOT NULL si no lo tiene
  BEGIN
    ALTER TABLE public.conversaciones ALTER COLUMN archivada SET NOT NULL;
  EXCEPTION WHEN others THEN
    -- Si ya es NOT NULL o falla, ignorar
    NULL;
  END;

  ALTER TABLE public.conversaciones ALTER COLUMN archivada SET DEFAULT false;
END $$;

-- Indices
CREATE INDEX IF NOT EXISTS conversaciones_archivada_idx ON public.conversaciones (archivada);
CREATE INDEX IF NOT EXISTS conversaciones_fecha_archivado_idx ON public.conversaciones (fecha_archivado DESC) WHERE archivada = true;

-- Vistas (reemplazables)
CREATE OR REPLACE VIEW public.v_conversaciones_activas AS
SELECT * FROM public.conversaciones WHERE archivada = false;

CREATE OR REPLACE VIEW public.v_conversaciones_archivadas AS
SELECT * FROM public.conversaciones WHERE archivada = true;

-- Función helper auto-archivar
CREATE OR REPLACE FUNCTION public.archivar_conversaciones_inactivas(dias int DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  filas integer;
BEGIN
  UPDATE public.conversaciones
  SET archivada = true,
      fecha_archivado = now(),
      motivo_archivado = 'inactivo_' || dias || 'd'
  WHERE archivada = false
    AND ultimo_mensaje_en < now() - (dias || ' days')::interval;
  
  GET DIAGNOSTICS filas = ROW_COUNT;
  RETURN filas;
END;
$$;

-- 2. NOTAS PERSONALES PARA CLIENTES
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clientes' AND column_name='notas_personales') THEN
    ALTER TABLE public.clientes ADD COLUMN notas_personales text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clientes' AND column_name='detalles_caso') THEN
    ALTER TABLE public.clientes ADD COLUMN detalles_caso text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clientes' AND column_name='notas_actualizado_en') THEN
    ALTER TABLE public.clientes ADD COLUMN notas_actualizado_en timestamptz;
  END IF;
END $$;

COMMENT ON COLUMN public.clientes.notas_personales IS 'Notas privadas del operador sobre el cliente, detalles del caso, preferencias, etc';
COMMENT ON COLUMN public.clientes.detalles_caso IS 'Detalles específicos del trabajo esotérico solicitado';

-- 3. DIVISAS Y COMISIONES EN PAGOS
DO $$
BEGIN
  -- moneda: COP, PYG, USD, EUR, BRL, etc
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pagos' AND column_name='moneda') THEN
    ALTER TABLE public.pagos ADD COLUMN moneda text DEFAULT 'COP';
  END IF;

  -- comision_porcentaje: comisión de cambio (ej: 7%)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pagos' AND column_name='comision_porcentaje') THEN
    ALTER TABLE public.pagos ADD COLUMN comision_porcentaje numeric DEFAULT 0;
  END IF;

  -- tasa_cambio: tasa usada para conversión a COP en ese momento
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pagos' AND column_name='tasa_cambio') THEN
    ALTER TABLE public.pagos ADD COLUMN tasa_cambio numeric DEFAULT 1;
  END IF;

  -- monto_convertido_cop: monto final en COP después de comisión y conversión
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pagos' AND column_name='monto_convertido_cop') THEN
    ALTER TABLE public.pagos ADD COLUMN monto_convertido_cop numeric;
  END IF;

  -- monto_original: guardar monto en moneda original si se quiere auditoría
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pagos' AND column_name='monto_original') THEN
    ALTER TABLE public.pagos ADD COLUMN monto_original numeric;
  END IF;

  -- Actualizar existentes
  EXECUTE 'UPDATE public.pagos SET moneda = ''COP'' WHERE moneda IS NULL';
  EXECUTE 'UPDATE public.pagos SET comision_porcentaje = 0 WHERE comision_porcentaje IS NULL';
  EXECUTE 'UPDATE public.pagos SET tasa_cambio = 1 WHERE tasa_cambio IS NULL';
  EXECUTE 'UPDATE public.pagos SET monto_original = monto WHERE monto_original IS NULL';
  EXECUTE 'UPDATE public.pagos SET monto_convertido_cop = monto WHERE monto_convertido_cop IS NULL';
END $$;

-- Indices para cartera
CREATE INDEX IF NOT EXISTS pagos_moneda_idx ON public.pagos (moneda);
CREATE INDEX IF NOT EXISTS pagos_fecha_pago_idx ON public.pagos (fecha_pago);
CREATE INDEX IF NOT EXISTS pagos_monto_convertido_idx ON public.pagos (monto_convertido_cop);

COMMENT ON COLUMN public.pagos.moneda IS 'Divisa original: COP, PYG, USD, EUR, etc';
COMMENT ON COLUMN public.pagos.comision_porcentaje IS 'Comisión de cambio en %, normalmente 7% para PYG';
COMMENT ON COLUMN public.pagos.tasa_cambio IS 'Tasa de cambio usada: ej 0.55 COP por 1 PYG, 4100 COP por 1 USD';
COMMENT ON COLUMN public.pagos.monto_convertido_cop IS 'Monto final convertido a COP después de quitar comisión';

-- 4. TABLA DE CONFIGURACION GLOBAL DE DIVISAS (opcional, para guardar tasas)
CREATE TABLE IF NOT EXISTS public.config_divisas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text UNIQUE NOT NULL, -- COP, PYG, USD, etc
  nombre text NOT NULL,
  tasa_a_cop numeric NOT NULL DEFAULT 1, -- Cuánto vale 1 unidad de esta moneda en COP
  simbolo text,
  activo boolean DEFAULT true,
  actualizado_en timestamptz DEFAULT now()
);

-- Insertar tasas por defecto si no existen
INSERT INTO public.config_divisas (codigo, nombre, tasa_a_cop, simbolo) VALUES
  ('COP', 'Peso Colombiano', 1, '$'),
  ('PYG', 'Guaraní Paraguayo', 0.55, '₲'),
  ('USD', 'Dólar Americano', 4100, 'US$'),
  ('EUR', 'Euro', 4500, '€'),
  ('BRL', 'Real Brasileño', 800, 'R$'),
  ('MXN', 'Peso Mexicano', 230, '$')
ON CONFLICT (codigo) DO NOTHING;

-- Config global de comisión
CREATE TABLE IF NOT EXISTS public.config_general (
  clave text PRIMARY KEY,
  valor text NOT NULL,
  descripcion text,
  actualizado_en timestamptz DEFAULT now()
);

INSERT INTO public.config_general (clave, valor, descripcion) VALUES
  ('comision_cambio_default', '7', 'Comisión por defecto para cambio de divisa en %'),
  ('tasa_pyg_cop', '0.55', 'Tasa de conversión PYG a COP'),
  ('tasa_usd_cop', '4100', 'Tasa de conversión USD a COP')
ON CONFLICT (clave) DO NOTHING;

-- RLS para nuevas tablas (lectura pública)
ALTER TABLE public.config_divisas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_general ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "config_divisas_lectura_publica" ON public.config_divisas;
CREATE POLICY "config_divisas_lectura_publica" ON public.config_divisas FOR SELECT USING (true);

DROP POLICY IF EXISTS "config_general_lectura_publica" ON public.config_general;
CREATE POLICY "config_general_lectura_publica" ON public.config_general FOR SELECT USING (true);

-- 5. COMENTARIOS FINALES
COMMENT ON TABLE public.config_divisas IS 'Tasas de cambio configurables para conversión a COP';
COMMENT ON TABLE public.config_general IS 'Configuraciones globales del CRM';


-- ############################################################################
-- [04/26] 20260825_recordatorios_whatsapp_etapa.sql
-- ############################################################################

-- Recordatorios automáticos de WhatsApp por etapa.
-- Ejecutar antes de importar n8n/03-recordatorios-whatsapp-por-etapa.json.
-- La clave única evita que una ejecución repetida envíe dos veces el mismo
-- recordatorio al mismo cliente en el mismo día.

CREATE TABLE IF NOT EXISTS public.recordatorios_whatsapp (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  conversacion_id uuid REFERENCES public.conversaciones(id) ON DELETE SET NULL,
  etapa text NOT NULL,
  tipo text NOT NULL,
  plantilla smallint NOT NULL DEFAULT 1,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  mensaje text NOT NULL,
  enviado_en timestamptz NOT NULL DEFAULT now(),
  proveedor text NOT NULL DEFAULT 'chatwoot'
);

-- Se permite un intento distinto en el mismo día (30 min, 3 h, 12 h y 23:30 h),
-- pero nunca se duplica el mismo intento.
DROP INDEX IF EXISTS public.recordatorios_whatsapp_unico_dia;
CREATE UNIQUE INDEX IF NOT EXISTS recordatorios_whatsapp_unico_intento
  ON public.recordatorios_whatsapp (cliente_id, etapa, tipo, plantilla, fecha);
CREATE INDEX IF NOT EXISTS recordatorios_whatsapp_enviado_idx
  ON public.recordatorios_whatsapp (enviado_en);

ALTER TABLE public.recordatorios_whatsapp ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recordatorios_whatsapp_lectura_publica" ON public.recordatorios_whatsapp;
DROP POLICY IF EXISTS "recordatorios_whatsapp_escritura_publica" ON public.recordatorios_whatsapp;
CREATE POLICY "recordatorios_whatsapp_lectura_publica"
  ON public.recordatorios_whatsapp FOR SELECT USING (true);
CREATE POLICY "recordatorios_whatsapp_escritura_publica"
  ON public.recordatorios_whatsapp FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.recordatorios_whatsapp IS
  'Auditoría/idempotencia de recordatorios automáticos enviados por etapa en WhatsApp API.';


-- ############################################################################
-- [05/26] 20260826_mejoras_luna_grupos_colores.sql
-- ############################################################################

-- ============================================================================
-- 🎨 MEJORAS: Apagar Luna global, Grupos Personal/Templo, Colores pipeline,
--             Sin nombre inicial para leads
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede volver a correr sin romper nada.
-- ============================================================================

-- 1. KILL SWITCH GLOBAL PARA LUNA (apagar/encender de todos los chats de una)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='config_general') THEN
    CREATE TABLE public.config_general (
      clave text PRIMARY KEY,
      valor text NOT NULL,
      descripcion text,
      actualizado_en timestamptz DEFAULT now()
    );
    ALTER TABLE public.config_general ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Asegurar política de lectura pública
DROP POLICY IF EXISTS "config_general_lectura_publica" ON public.config_general;
CREATE POLICY "config_general_lectura_publica" ON public.config_general
  FOR SELECT USING (true);

-- Política de escritura (para que el CRM pueda cambiar los valores)
DROP POLICY IF EXISTS "config_general_escritura_publica" ON public.config_general;
CREATE POLICY "config_general_escritura_publica" ON public.config_general
  FOR ALL USING (true) WITH CHECK (true);

-- Insertar el kill switch y configuraciones de grupos
INSERT INTO public.config_general (clave, valor, descripcion) VALUES
  ('luna_global_activa', 'true', 'Si es false, Luna se apaga en TODOS los chats (kill switch global)'),
  ('grupo_activo', 'personal', 'Grupo seleccionado actualmente: personal | templo'),
  ('personal_label', 'Personal', 'Nombre visible del grupo Personal (editable)'),
  ('templo_label', 'Templo', 'Nombre visible del grupo Templo (editable)')
ON CONFLICT (clave) DO NOTHING;

-- 2. PIPELINE ETAPAS: AGREGAR COLUMNA DE GRUPO Y MEJORAR COLORES
DO $$
BEGIN
  -- Si la tabla pipeline_etapas no existe, crearla
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='pipeline_etapas') THEN
    CREATE TABLE public.pipeline_etapas (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      clave text UNIQUE NOT NULL,
      nombre text NOT NULL,
      orden integer NOT NULL DEFAULT 0,
      color text DEFAULT 'border-purple-500',
      bg_color text DEFAULT 'bg-purple-500/10',
      text_color text DEFAULT 'text-purple-300',
      grupo text DEFAULT 'personal',  -- 'personal' | 'templo' | 'spam'
      es_spam boolean DEFAULT false,
      es_archivado boolean DEFAULT false,
      creado_en timestamptz DEFAULT now()
    );

    ALTER TABLE public.pipeline_etapas ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "pipeline_etapas_lectura_publica" ON public.pipeline_etapas;
    CREATE POLICY "pipeline_etapas_lectura_publica" ON public.pipeline_etapas
      FOR SELECT USING (true);

    DROP POLICY IF EXISTS "pipeline_etapas_escritura_publica" ON public.pipeline_etapas;
    CREATE POLICY "pipeline_etapas_escritura_publica" ON public.pipeline_etapas
      FOR ALL USING (true) WITH CHECK (true);

    -- Semilla inicial Personal
    INSERT INTO public.pipeline_etapas (clave, nombre, orden, color, bg_color, text_color, grupo, es_spam, es_archivado) VALUES
      ('nuevo_lead', 'Nuevo Lead', 1, 'border-blue-500', 'bg-blue-500/10', 'text-blue-300', 'personal', false, false),
      ('en_consulta', 'En Consulta', 2, 'border-yellow-500', 'bg-yellow-500/10', 'text-yellow-300', 'personal', false, false),
      ('consulta_hecha', 'Consulta Hecha', 3, 'border-orange-500', 'bg-orange-500/10', 'text-orange-300', 'personal', false, false),
      ('pago_recibido', 'Pago Recibido', 4, 'border-emerald-500', 'bg-emerald-500/10', 'text-emerald-300', 'personal', false, false),
      ('trabajo_proceso', 'Trabajo en Proceso', 5, 'border-purple-500', 'bg-purple-500/10', 'text-purple-300', 'personal', false, false),
      ('trabajo_completado', 'Trabajo Completado', 6, 'border-green-500', 'bg-green-500/10', 'text-green-300', 'personal', false, false),
      ('perdido', 'Perdido', 7, 'border-red-500', 'bg-red-500/10', 'text-red-300', 'personal', false, false),
      ('spam_personal', 'Spam', 99, 'border-red-700', 'bg-red-900/30', 'text-red-400', 'personal', true, false),
      ('archivado_personal', 'Archivados', 98, 'border-amber-600', 'bg-amber-900/20', 'text-amber-400', 'personal', false, true);

    -- Semilla inicial Templo
    INSERT INTO public.pipeline_etapas (clave, nombre, orden, color, bg_color, text_color, grupo, es_spam, es_archivado) VALUES
      ('nuevo_lead_templo', 'Nuevo Lead', 1, 'border-indigo-500', 'bg-indigo-500/10', 'text-indigo-300', 'templo', false, false),
      ('en_consulta_templo', 'En Consulta', 2, 'border-pink-500', 'bg-pink-500/10', 'text-pink-300', 'templo', false, false),
      ('consulta_hecha_templo', 'Consulta Hecha', 3, 'border-fuchsia-500', 'bg-fuchsia-500/10', 'text-fuchsia-300', 'templo', false, false),
      ('pago_recibido_templo', 'Pago Recibido', 4, 'border-teal-500', 'bg-teal-500/10', 'text-teal-300', 'templo', false, false),
      ('trabajo_proceso_templo', 'Trabajo en Proceso', 5, 'border-violet-500', 'bg-violet-500/10', 'text-violet-300', 'templo', false, false),
      ('trabajo_completado_templo', 'Trabajo Completado', 6, 'border-cyan-500', 'bg-cyan-500/10', 'text-cyan-300', 'templo', false, false),
      ('perdido_templo', 'Perdido', 7, 'border-rose-500', 'bg-rose-500/10', 'text-rose-300', 'templo', false, false),
      ('spam_templo', 'Spam', 99, 'border-red-700', 'bg-red-900/30', 'text-red-400', 'templo', true, false),
      ('archivado_templo', 'Archivados', 98, 'border-amber-600', 'bg-amber-900/20', 'text-amber-400', 'templo', false, true);
  END IF;

  -- Agregar columnas si no existen
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pipeline_etapas' AND column_name='grupo') THEN
    ALTER TABLE public.pipeline_etapas ADD COLUMN grupo text DEFAULT 'personal';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pipeline_etapas' AND column_name='bg_color') THEN
    ALTER TABLE public.pipeline_etapas ADD COLUMN bg_color text DEFAULT 'bg-purple-500/10';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pipeline_etapas' AND column_name='text_color') THEN
    ALTER TABLE public.pipeline_etapas ADD COLUMN text_color text DEFAULT 'text-purple-300';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pipeline_etapas' AND column_name='es_spam') THEN
    ALTER TABLE public.pipeline_etapas ADD COLUMN es_spam boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pipeline_etapas' AND column_name='es_archivado') THEN
    ALTER TABLE public.pipeline_etapas ADD COLUMN es_archivado boolean DEFAULT false;
  END IF;
END $$;

-- Actualizar valores por defecto para etapas existentes sin grupo
UPDATE public.pipeline_etapas SET grupo = 'personal' WHERE grupo IS NULL OR grupo = '';
UPDATE public.pipeline_etapas SET bg_color = 'bg-purple-500/10' WHERE bg_color IS NULL OR bg_color = '';
UPDATE public.pipeline_etapas SET text_color = 'text-purple-300' WHERE text_color IS NULL OR text_color = '';
UPDATE public.pipeline_etapas SET color = 'border-purple-500' WHERE color IS NULL OR color = '';
UPDATE public.pipeline_etapas SET es_spam = false WHERE es_spam IS NULL;
UPDATE public.pipeline_etapas SET es_archivado = false WHERE es_archivado IS NULL;

-- Asegurar que existan las etapas semilla para AMBOS grupos (incluso si la tabla ya existía)
-- Personal
INSERT INTO public.pipeline_etapas (clave, nombre, orden, color, bg_color, text_color, grupo, es_spam, es_archivado) VALUES
  ('nuevo_lead',       'Nuevo Lead',          1, 'border-blue-500',    'bg-blue-500/10',    'text-blue-300',    'personal', false, false),
  ('en_consulta',      'En Consulta',         2, 'border-yellow-500',  'bg-yellow-500/10',  'text-yellow-300',  'personal', false, false),
  ('consulta_hecha',   'Consulta Hecha',      3, 'border-orange-500',  'bg-orange-500/10',  'text-orange-300',  'personal', false, false),
  ('pago_recibido',    'Pago Recibido',       4, 'border-emerald-500', 'bg-emerald-500/10', 'text-emerald-300', 'personal', false, false),
  ('trabajo_proceso',  'Trabajo en Proceso',  5, 'border-purple-500',  'bg-purple-500/10',  'text-purple-300',  'personal', false, false),
  ('trabajo_completado','Trabajo Completado', 6, 'border-green-500',   'bg-green-500/10',   'text-green-300',   'personal', false, false),
  ('perdido',          'Perdido',             7, 'border-red-500',     'bg-red-500/10',     'text-red-300',     'personal', false, false),
  ('spam_personal',    'Spam',               99, 'border-red-700',     'bg-red-900/30',     'text-red-400',     'personal', true,  false),
  ('archivado_personal','Archivados',         98, 'border-amber-600',   'bg-amber-900/20',   'text-amber-400',   'personal', false, true)
ON CONFLICT (clave) DO NOTHING;

-- Templo
INSERT INTO public.pipeline_etapas (clave, nombre, orden, color, bg_color, text_color, grupo, es_spam, es_archivado) VALUES
  ('nuevo_lead_templo',       'Nuevo Lead',          1, 'border-indigo-500',  'bg-indigo-500/10',  'text-indigo-300',  'templo', false, false),
  ('en_consulta_templo',      'En Consulta',         2, 'border-pink-500',    'bg-pink-500/10',    'text-pink-300',    'templo', false, false),
  ('consulta_hecha_templo',   'Consulta Hecha',      3, 'border-fuchsia-500', 'bg-fuchsia-500/10', 'text-fuchsia-300', 'templo', false, false),
  ('pago_recibido_templo',    'Pago Recibido',       4, 'border-teal-500',    'bg-teal-500/10',    'text-teal-300',    'templo', false, false),
  ('trabajo_proceso_templo',  'Trabajo en Proceso',  5, 'border-violet-500',  'bg-violet-500/10',  'text-violet-300',  'templo', false, false),
  ('trabajo_completado_templo','Trabajo Completado', 6, 'border-cyan-500',    'bg-cyan-500/10',    'text-cyan-300',    'templo', false, false),
  ('perdido_templo',          'Perdido',             7, 'border-rose-500',    'bg-rose-500/10',    'text-rose-300',    'templo', false, false),
  ('spam_templo',             'Spam',               99, 'border-red-700',     'bg-red-900/30',     'text-red-400',     'templo', true,  false),
  ('archivado_templo',        'Archivados',         98, 'border-amber-600',   'bg-amber-900/20',   'text-amber-400',   'templo', false, true)
ON CONFLICT (clave) DO NOTHING;

-- Asegurar RLS
ALTER TABLE public.pipeline_etapas ENABLE ROW LEVEL SECURITY;

-- 3. CLIENTES: AGREGAR COLUMNA GRUPO (personal/templo) y limpiar nombres vacíos
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clientes' AND column_name='grupo') THEN
    ALTER TABLE public.clientes ADD COLUMN grupo text DEFAULT 'personal';
  END IF;
END $$;

UPDATE public.clientes SET grupo = 'personal' WHERE grupo IS NULL OR grupo = '';

-- Asegurar índice
CREATE INDEX IF NOT EXISTS clientes_grupo_idx ON public.clientes (grupo);
CREATE INDEX IF NOT EXISTS clientes_estado_idx ON public.clientes (estado);

-- RLS clientes: asegurar política de lectura + escritura públicas (como el resto del CRM)
DO $$
BEGIN
  ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "clientes_lectura_publica" ON public.clientes;
  DROP POLICY IF EXISTS "clientes_escritura_publica" ON public.clientes;
  CREATE POLICY "clientes_lectura_publica" ON public.clientes FOR SELECT USING (true);
  CREATE POLICY "clientes_escritura_publica" ON public.clientes FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN others THEN
  RAISE NOTICE 'No se pudo aplicar RLS a clientes (probablemente ya tenía políticas): %', SQLERRM;
END $$;

-- RLS conversaciones: asegurar política de escritura (para toggle global de Luna)
DO $$
BEGIN
  ALTER TABLE public.conversaciones ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "conversaciones_escritura_publica" ON public.conversaciones;
  CREATE POLICY "conversaciones_escritura_publica" ON public.conversaciones FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN others THEN
  RAISE NOTICE 'RLS conversaciones ya configurada: %', SQLERRM;
END $$;

-- 4. CONVERSACIONES: asegurar que agente_activo respete el kill switch global
-- (esto se hace a nivel de aplicación, no necesitamos trigger en BD)

-- ============================================================================
-- ✅ LISTO.
--    Ahora ve al CRM y:
--    1) Arriba de los chats verás el botón 🌙 "Apagar Luna" global.
--    2) Hay dos botones grandes: Personal y Templo.
--    3) Cada etapa del pipeline tiene color; la tarjeta del chat toma ese color.
--    4) Los leads sin nombre muestran solo su número con el +.
-- ============================================================================


-- ############################################################################
-- [06/26] 20260827_cartera_proximos_pagos.sql
-- ############################################################################

-- ============================================================================
-- 💰 CARTERA POR COBRAR — Control de Próximos Pagos
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede volver a correr sin romper nada.
--
-- Qué hace:
--   1. Índices para que la cartera (control de próximos pagos) cargue rápido.
--   2. Documenta el estado 'cancelado' en public.pagos (pago eliminado de la
--      cartera por abandono, sin borrar el registro).
--   3. Vista v_cartera_por_cobrar con el cálculo de pendiente por cliente.
-- ============================================================================

-- 1. ÍNDICES DE CARTERA
-- Consultas típicas de la cartera: pagos pendientes ordenados por fecha.
CREATE INDEX IF NOT EXISTS pagos_estado_fecha_idx ON public.pagos (estado, fecha_vencimiento);
CREATE INDEX IF NOT EXISTS pagos_cliente_estado_idx ON public.pagos (cliente_id, estado);

-- 2. DOCUMENTAR EL ESTADO 'cancelado' (opcional pero útil para auditoría)
COMMENT ON COLUMN public.pagos.estado IS
  'Estado del pago: pendiente (por cobrar) | pagado (cobrado) | cancelado (eliminado de la cartera por abandono)';

-- 3. VISTA: CARTERA REAL POR COBRAR (por cliente)
-- Total pendiente en COP (ya convertido), próximo pago y días de vencimiento.
CREATE OR REPLACE VIEW public.v_cartera_por_cobrar AS
SELECT
  c.id AS cliente_id,
  c.nombre,
  c.telefono_display,
  c.grupo,
  -- Total del servicio: suma de pagos no cancelados convertidos a COP
  COALESCE(SUM(CASE WHEN p.estado <> 'cancelado' THEN COALESCE(p.monto_convertido_cop, p.monto) END), 0) AS total_servicio_cop,
  -- Total pendiente: suma de pagos pendientes convertidos a COP
  COALESCE(SUM(CASE WHEN p.estado = 'pendiente' THEN COALESCE(p.monto_convertido_cop, p.monto) END), 0) AS total_pendiente_cop,
  -- Próximo pago (el pendiente más antiguo)
  MIN(CASE WHEN p.estado = 'pendiente' THEN p.fecha_vencimiento END) AS proximo_pago_fecha,
  -- Días hasta el próximo pago (negativo = vencido)
  (MIN(CASE WHEN p.estado = 'pendiente' THEN p.fecha_vencimiento END) - CURRENT_DATE) AS dias_para_pago,
  COUNT(*) FILTER (WHERE p.estado = 'pendiente') AS pagos_pendientes,
  COUNT(*) FILTER (WHERE p.estado = 'pagado') AS pagos_pagados
FROM public.clientes c
LEFT JOIN public.pagos p ON p.cliente_id = c.id
WHERE c.es_spam IS NOT TRUE
GROUP BY c.id, c.nombre, c.telefono_display, c.grupo
HAVING COUNT(*) FILTER (WHERE p.estado = 'pendiente') > 0
ORDER BY MIN(CASE WHEN p.estado = 'pendiente' THEN p.fecha_vencimiento END) ASC NULLS LAST;

COMMENT ON VIEW public.v_cartera_por_cobrar IS
  'Cartera real por cobrar: clientes con al menos un pago pendiente, total pendiente en COP, próximo pago y días de vencimiento (negativo = vencido).';


-- ############################################################################
-- [07/26] 20260828_no_leidos_atendidos_spam_negro.sql
-- ############################################################################

-- ============================================================================
-- 📩 MENSAJES NO LEÍDOS + CLIENTES ATENDIDOS + SPAM COMO PIPELINE NEGRO
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede volver a correr sin romper nada.
--
-- 1. Conversaciones: contador de mensajes no leídos (no_leidos) que SOLO se
--    limpia cuando el operador abre/revisa el chat (no cuando responde la agente).
-- 2. Clientes: columna atendido (pasó por la etapa "Consulta Hecha" alguna vez).
--    El contador de "Clientes atendidos" se mantiene aunque salga del pipeline.
-- 3. Spam: etapa del pipeline fija de color negro, no editable, no eliminable,
--    sin agente ni recordatorios.
-- ============================================================================

-- 1. CONTADOR DE MENSAJES NO LEÍDOS POR CONVERSACIÓN
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='conversaciones' AND column_name='no_leidos') THEN
    ALTER TABLE public.conversaciones ADD COLUMN no_leidos integer NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='conversaciones' AND column_name='ultimo_leido_en') THEN
    ALTER TABLE public.conversaciones ADD COLUMN ultimo_leido_en timestamptz;
  END IF;
END $$;

-- Nada queda como "no leído" retroactivamente: lo anterior ya fue revisado
UPDATE public.conversaciones SET ultimo_leido_en = now() WHERE ultimo_leido_en IS NULL;

CREATE INDEX IF NOT EXISTS mensajes_no_leidos_idx ON public.mensajes (conversacion_id, tipo, creado_en);

-- RPC: marcar una conversación como leída (solo el operador la limpia al revisar)
CREATE OR REPLACE FUNCTION public.marcar_leido(p_conv_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversaciones
  SET no_leidos = 0, ultimo_leido_en = now()
  WHERE id = p_conv_id;
END $$;

-- RPC: recalcular no_leidos desde la tabla de mensajes
-- (cubre mensajes que llegaron con la app cerrada; la respuesta de la agente
--  es tipo 'enviado', no cuenta y NO limpia lo pendiente por revisar)
CREATE OR REPLACE FUNCTION public.sincronizar_no_leidos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversaciones c
  SET no_leidos = (
    SELECT count(*)::int
    FROM public.mensajes m
    WHERE m.conversacion_id = c.id
      AND m.tipo <> 'enviado'
      AND m.creado_en > COALESCE(c.ultimo_leido_en, '1970-01-01'::timestamptz)
  );
END $$;

-- 2. CLIENTES ATENDIDOS (pasaron por la etapa "Consulta Hecha" alguna vez)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clientes' AND column_name='atendido') THEN
    ALTER TABLE public.clientes ADD COLUMN atendido boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- Backfill: los que ya pasaron por consulta_hecha (o están más allá) cuentan
UPDATE public.clientes
SET atendido = true
WHERE estado IN (
  'consulta_hecha', 'consulta_hecha_templo',
  'pago_recibido', 'pago_recibido_templo',
  'trabajo_proceso', 'trabajo_proceso_templo',
  'trabajo_completado', 'trabajo_completado_templo'
);

-- Trigger: al pasar a "Consulta Hecha" queda atendido para siempre,
-- aunque después salga del pipeline (perdido, abandonado, etc.)
CREATE OR REPLACE FUNCTION public.marcar_atendido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.estado LIKE 'consulta_hecha%' THEN
    NEW.atendido := true;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_clientes_atendido ON public.clientes;
CREATE TRIGGER trg_clientes_atendido
  BEFORE INSERT OR UPDATE OF estado ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.marcar_atendido();

-- 3. SPAM COMO PIPELINE FIJO DE COLOR NEGRO (no editable, no eliminable)
--    El CRM ya no permite editar ni eliminar etapas con es_spam = true.
UPDATE public.pipeline_etapas
SET color = 'border-black', bg_color = 'bg-black/40', text_color = 'text-gray-300'
WHERE es_spam = true;


-- ############################################################################
-- [08/26] 20260829_nombre_manual_prioridad_telefono.sql
-- ############################################################################

-- ============================================================================
-- 📞 PRIORIDAD TELÉFONO + NOMBRE MANUAL (+ pestaña "Por leer")
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede volver a correr sin romper nada.
--
-- REGLA DE VISUALIZACIÓN DEL CRM:
--   1. Si "nombre_manual" tiene valor → se muestra ese nombre (el operador lo
--      puso a mano desde la ficha del cliente con el lápiz ✏️).
--   2. Si no → se muestra SOLO el número de teléfono en formato internacional
--      con el indicativo del país y el "+". Ej: +573054021111 o +595985123456.
--
-- El campo "nombre" (que llenan automáticamente los webhooks con el nombre
-- cargado de WhatsApp, la agenda del teléfono del maestro o del cliente) DEJA
-- DE MOSTRARSE por completo. No se borra: otras herramientas (Cerebro IA)
-- siguen pudiendo usarlo, pero el CRM nunca lo enseña.
--
-- La pestaña "Por leer" (chats con mensajes sin leer de todas las categorías)
-- NO requiere cambios en la base de datos: usa el contador "no_leidos" de la
-- migración 20260828_no_leidos_atendidos_spam_negro.sql
-- ============================================================================

-- 1. COLUMNA nombre_manual EN CLIENTES
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clientes' AND column_name='nombre_manual') THEN
    ALTER TABLE public.clientes ADD COLUMN nombre_manual text;
  END IF;
END $$;

COMMENT ON COLUMN public.clientes.nombre_manual IS 'Nombre puesto manualmente por el operador en el CRM. NULL = mostrar solo el número de teléfono con el + del país. El campo "nombre" (auto-cargado de WhatsApp/agenda) NO se muestra en la interfaz.';

-- Índice parcial para buscar rápido por nombre manual
CREATE INDEX IF NOT EXISTS clientes_nombre_manual_idx ON public.clientes (nombre_manual) WHERE nombre_manual IS NOT NULL;

-- RLS: clientes ya tiene políticas públicas de lectura/escritura
-- (ver migración 20260826_mejoras_luna_grupos_colores.sql), y las políticas
-- "FOR ALL" cubren automáticamente la columna nueva. Nada que hacer aquí.

-- ============================================================================
-- ✅ LISTO. Ahora en el CRM:
--    1) Todos los chats y tarjetas muestran el número con + (+573054021111).
--    2) Si le pones nombre con el lápiz ✏️ en la ficha, ese nombre se guarda
--       en nombre_manual y pasa a mostrarse (y puede quitarse dejándolo vacío).
--    3) Al lado de "Leads nuevos" aparece la pestaña "Por leer" con los chats
--       de TODAS las categorías que tienen mensajes sin leer.
-- ============================================================================


-- ############################################################################
-- [09/26] 20260830_enrutar_leads_por_numero.sql
-- ############################################################################

-- ============================================================================
-- 📲 ENRUTAR LEADS POR NÚMERO DE LLEGADA (publicidad → WhatsApp API Templo)
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede volver a correr sin romper nada.
--
-- PROBLEMA: los leads de la publicidad paga llegan al número del WhatsApp API
-- (conversaciones.fuente = 'meta_business'), pero el webhook los guarda con
-- grupo='personal' y una etapa del pipeline personal (ej: "No Contesta").
-- Resultado: aparecen en la bandeja del WhatsApp personal en vez de caer en
-- "Nuevo Lead" del grupo Templo.
--
-- SOLUCIÓN: la procedencia la manda el NÚMERO al que escribió el lead:
--   * fuente = 'meta_business'  (WhatsApp API Templo)  → grupo Templo
--   * fuente = 'evolution'      (WhatsApp personal)    → grupo Personal
--
-- Esta migración:
--   1. Corrige los datos que ya están mal (backfill de todos los clientes).
--   2. Deja triggers que auto-corrigen cada vez que un webhook escriba mal,
--      venga de donde venga el dato (ahora y en el futuro).
--
-- REGLAS (solo para clientes con conversación en el número Templo):
--   - Si TODAS sus conversaciones son del número Templo → grupo='templo'.
--   - Si su estado es una etapa del pipeline PERSONAL (ej: "No Contesta",
--     "Nuevo Lead" personal) y el cliente pertenece al Templo → se convierte
--     a su equivalente Templo; las etapas personales personalizadas caen a
--     'nuevo_lead_templo' (Lead Nuevo del Templo).
--   - Los estados Templo válidos y los cambios hechos a mano por el operador
--     NO se tocan.
--   - Los leads del WhatsApp personal (sin conversación meta_business) no se
--     tocan para nada: "No Contesta" del personal sigue igual que siempre.
-- ============================================================================

-- 1. FUNCIÓN DE ENRUTADO (una llamada corrige un cliente según su número)
CREATE OR REPLACE FUNCTION public.enrutar_cliente_por_numero(p_cliente_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta integer;
  v_otras integer;
  v_grupo_actual text;
  v_estado_actual text;
  v_grupo_nuevo text;
  v_estado_nuevo text;
BEGIN
  SELECT count(*) FILTER (WHERE fuente = 'meta_business'),
         count(*) FILTER (WHERE fuente IS DISTINCT FROM 'meta_business')
    INTO v_meta, v_otras
    FROM public.conversaciones
   WHERE cliente_id = p_cliente_id;

  -- Lead sin ninguna conversación en el número Templo: no se toca
  IF v_meta = 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(grupo, ''), COALESCE(estado, '')
    INTO v_grupo_actual, v_estado_actual
    FROM public.clientes
   WHERE id = p_cliente_id;

  -- Grupo: Templo si todas sus conversaciones son del número API
  IF v_otras = 0 THEN
    v_grupo_nuevo := 'templo';
  ELSE
    v_grupo_nuevo := v_grupo_actual;
  END IF;

  -- Estado: etapas del pipeline PERSONAL (o vacías) se convierten a Templo
  v_estado_nuevo := v_estado_actual;
  IF COALESCE(v_grupo_nuevo, '') = 'templo' AND (
       v_estado_actual = '' OR EXISTS (
         SELECT 1 FROM public.pipeline_etapas e
          WHERE e.clave = v_estado_actual
            AND e.grupo = 'personal'
       )
     ) THEN
    v_estado_nuevo := CASE v_estado_actual
      WHEN 'nuevo_lead'         THEN 'nuevo_lead_templo'
      WHEN 'en_consulta'        THEN 'en_consulta_templo'
      WHEN 'consulta_hecha'     THEN 'consulta_hecha_templo'
      WHEN 'pago_recibido'      THEN 'pago_recibido_templo'
      WHEN 'trabajo_proceso'    THEN 'trabajo_proceso_templo'
      WHEN 'trabajo_completado' THEN 'trabajo_completado_templo'
      WHEN 'perdido'            THEN 'perdido_templo'
      ELSE 'nuevo_lead_templo' -- etapas personales personalizadas (ej: "No Contesta") → Lead Nuevo Templo
    END;
  END IF;

  IF v_grupo_nuevo IS DISTINCT FROM NULLIF(v_grupo_actual, '')
     OR v_estado_nuevo IS DISTINCT FROM v_estado_actual THEN
    UPDATE public.clientes
       SET grupo = NULLIF(v_grupo_nuevo, ''),
           estado = NULLIF(v_estado_nuevo, ''),
           atendido = CASE WHEN v_estado_nuevo = 'consulta_hecha_templo'
                           THEN true ELSE clientes.atendido END,
           actualizado_en = now()
     WHERE id = p_cliente_id;
  END IF;
END;
$$;

-- 2. TRIGGER SOBRE CLIENTES: cada vez que un webhook escriba grupo/estado,
--    se re-enruta según el número donde realmente escribió el lead.
CREATE OR REPLACE FUNCTION public.clientes_enrutar_por_numero_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.enrutar_cliente_por_numero(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clientes_enrutar_por_numero ON public.clientes;
CREATE TRIGGER clientes_enrutar_por_numero
AFTER INSERT OR UPDATE OF estado, grupo ON public.clientes
FOR EACH ROW
WHEN (pg_trigger_depth() < 2)
EXECUTE FUNCTION public.clientes_enrutar_por_numero_trg();

-- 3. TRIGGER SOBRE CONVERSACIONES: cuando llegue una conversación nueva al
--    número del WhatsApp API, el cliente queda en el grupo Templo.
CREATE OR REPLACE FUNCTION public.conversaciones_enrutar_cliente_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.cliente_id IS NOT NULL THEN
    PERFORM public.enrutar_cliente_por_numero(NEW.cliente_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversaciones_enrutar_cliente ON public.conversaciones;
CREATE TRIGGER conversaciones_enrutar_cliente
AFTER INSERT OR UPDATE OF fuente, cliente_id ON public.conversaciones
FOR EACH ROW
WHEN (pg_trigger_depth() < 2)
EXECUTE FUNCTION public.conversaciones_enrutar_cliente_trg();

-- 4. BACKFILL: corrige todos los leads que ya cayeron mal clasificados
SELECT public.enrutar_cliente_por_numero(id) FROM public.clientes;

-- ============================================================================
-- ✅ LISTO. A partir de ahora:
--    1) Todo lead que escriba al número del WhatsApp API (Templo) cae en
--       "Nuevo Lead" del grupo Templo, sin importar cómo lo clasifique el
--       webhook ("No Contesta" del personal ya no se lo roba).
--    2) Los leads del WhatsApp personal siguen funcionando igual (incluida
--       su etapa "No Contesta").
--    3) Si mueves un cliente a una etapa del otro grupo desde el CRM, la
--       bandeja lo sigue (el CRM también sincroniza el grupo al mover etapa).
-- ============================================================================


-- ############################################################################
-- [10/26] 20260831_fix_no_leidos_realtime.sql
-- ############################################################################

-- Corrige el contador rojo de mensajes pendientes.
-- La app ya muestra conversaciones.no_leidos; este trigger lo incrementa en el
-- mismo INSERT del mensaje entrante, incluso si la app estaba cerrada.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='conversaciones' AND column_name='no_leidos') THEN
    ALTER TABLE public.conversaciones ADD COLUMN no_leidos integer NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='conversaciones' AND column_name='ultimo_leido_en') THEN
    ALTER TABLE public.conversaciones ADD COLUMN ultimo_leido_en timestamptz;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.incrementar_no_leidos_entrante()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(NEW.tipo, '') <> 'enviado' THEN
    UPDATE public.conversaciones
       SET no_leidos = COALESCE(no_leidos, 0) + 1
     WHERE id = NEW.conversacion_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_incrementar_no_leidos_entrante ON public.mensajes;
CREATE TRIGGER trg_incrementar_no_leidos_entrante
AFTER INSERT ON public.mensajes
FOR EACH ROW EXECUTE FUNCTION public.incrementar_no_leidos_entrante();

-- Recalcular los históricos usando la marca de lectura actual.
SELECT public.sincronizar_no_leidos();


-- ############################################################################
-- [11/26] 20260901_unificar_whatsapp_personal_templo.sql
-- ############################################################################

-- Unifica automáticamente las conversaciones del mismo cliente.
-- Conserva como principal la conversación de WhatsApp Personal (Evolution),
-- copia allí los mensajes del WhatsApp API respetando creado_en y elimina la
-- conversación API duplicada. Se ejecuta dentro de una sola transacción.

CREATE OR REPLACE FUNCTION public.unificar_conversaciones_whatsapp()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente record;
  v_personal uuid;
  v_meta record;
  v_total integer := 0;
  v_ultimo record;
BEGIN
  FOR v_cliente IN
    SELECT DISTINCT c.cliente_id
      FROM public.conversaciones c
     WHERE c.cliente_id IS NOT NULL
       AND c.fuente = 'meta_business'
       AND EXISTS (
         SELECT 1 FROM public.conversaciones p
          WHERE p.cliente_id = c.cliente_id AND p.fuente = 'evolution'
       )
  LOOP
    SELECT id INTO v_personal
      FROM public.conversaciones
     WHERE cliente_id = v_cliente.cliente_id AND fuente = 'evolution'
     ORDER BY ultimo_mensaje_en DESC NULLS LAST, creado_en ASC NULLS LAST
     LIMIT 1;

    FOR v_meta IN
      SELECT id FROM public.conversaciones
       WHERE cliente_id = v_cliente.cliente_id
         AND fuente = 'meta_business'
    LOOP
      -- Evitar duplicados si una ejecución anterior ya copió el mismo mensaje.
      INSERT INTO public.mensajes
        (conversacion_id, tipo, contenido, tipo_contenido, url_archivo, creado_en)
      SELECT v_personal, m.tipo, m.contenido, m.tipo_contenido, m.url_archivo, m.creado_en
        FROM public.mensajes m
       WHERE m.conversacion_id = v_meta.id
         AND NOT EXISTS (
           SELECT 1 FROM public.mensajes x
            WHERE x.conversacion_id = v_personal
              AND x.tipo = m.tipo
              AND x.creado_en = m.creado_en
              AND COALESCE(x.contenido, '') = COALESCE(m.contenido, '')
         );

      DELETE FROM public.mensajes WHERE conversacion_id = v_meta.id;
      DELETE FROM public.conversaciones WHERE id = v_meta.id;
      v_total := v_total + 1;
    END LOOP;

    SELECT m.contenido, m.creado_en
      INTO v_ultimo
      FROM public.mensajes m
     WHERE m.conversacion_id = v_personal
     ORDER BY m.creado_en DESC NULLS LAST
     LIMIT 1;

    UPDATE public.conversaciones
       SET ultimo_mensaje = v_ultimo.contenido,
           ultimo_mensaje_en = v_ultimo.creado_en,
           no_leidos = (
             SELECT count(*)::integer FROM public.mensajes x
              WHERE x.conversacion_id = v_personal
                AND x.tipo <> 'enviado'
                AND x.creado_en > COALESCE(public.conversaciones.ultimo_leido_en, '1970-01-01'::timestamptz)
           )
     WHERE id = v_personal;
  END LOOP;
  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unificar_conversaciones_whatsapp() TO anon, authenticated;


-- ############################################################################
-- [12/26] 20260902_luna_etapas_expediente.sql
-- ############################################################################

-- ============================================================================
-- Luna por etapas: expediente del caso + etapas del pipeline
-- Ejecutar ANTES de importar n8n/05-luna-etapas.json.
--
-- 1) Columnas nuevas en public.clientes para guardar lo que Luna aprende
--    (motivo de la consulta y etapa interna). Si no existen, el workflow
--    igual funciona: guarda el resto y registra el error en _debug.
-- 2) Etapas del pipeline que usa el motor de Luna. Solo se crean si el grupo
--    no tiene ya una etapa con ese nombre (no duplica tu pipeline actual).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CLIENTES: expediente que construye Luna
-- ----------------------------------------------------------------------------
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS motivo_consulta text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS motivo_categoria text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS luna_etapa text;

COMMENT ON COLUMN public.clientes.motivo_consulta IS
  'Resumen del caso que Luna entendio en la etapa Sin respuesta. No se vuelve a preguntar.';
COMMENT ON COLUMN public.clientes.motivo_categoria IS
  'Categoria del trabajo: amarre, retorno, dominio, alejamiento, endulzamiento, sexual, conquista, entierro, desamarre, limpieza, mal_de_ojo, proteccion, prosperidad, empleo, atraccion, juegos, salud, otro.';
COMMENT ON COLUMN public.clientes.luna_etapa IS
  'Ultima etapa en la que Luna atendio al lead: lead_nuevo, sin_respuesta, datos, por_consulta.';

-- ----------------------------------------------------------------------------
-- 2. PIPELINE: etapas del motor de Luna (solo si faltan por nombre)
--    Claves toleradas por el workflow (n8n/luna/code/leer-estado-lead.js):
--      Lead Nuevo    → nuevo_lead, lead_nuevo, ...
--      Sin respuesta → sin_respuesta, no_contesta, ...
--      Datos         → datos, solicitar_datos, en_datos, ...
--      Por consulta  → por_consulta, en_consulta, espera_consulta, ...
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  g text;
BEGIN
  FOREACH g IN ARRAY ARRAY['personal','templo']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.pipeline_etapas
      WHERE grupo = g AND lower(nombre) IN ('sin respuesta','no contesta')
    ) THEN
      INSERT INTO public.pipeline_etapas (clave, nombre, orden, color, bg_color, text_color, grupo)
      VALUES (CASE WHEN g = 'templo' THEN 'sin_respuesta_templo' ELSE 'sin_respuesta' END,
              'Sin respuesta', 2, 'border-slate-500', 'bg-slate-500/10', 'text-slate-300', g);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.pipeline_etapas
      WHERE grupo = g AND lower(nombre) = 'datos'
    ) THEN
      INSERT INTO public.pipeline_etapas (clave, nombre, orden, color, bg_color, text_color, grupo)
      VALUES (CASE WHEN g = 'templo' THEN 'datos_templo' ELSE 'datos' END,
              'Datos', 3, 'border-sky-500', 'bg-sky-500/10', 'text-sky-300', g);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.pipeline_etapas
      WHERE grupo = g AND lower(nombre) IN ('por consulta','en consulta')
    ) THEN
      INSERT INTO public.pipeline_etapas (clave, nombre, orden, color, bg_color, text_color, grupo)
      VALUES (CASE WHEN g = 'templo' THEN 'por_consulta_templo' ELSE 'por_consulta' END,
              'Por consulta', 4, 'border-yellow-500', 'bg-yellow-500/10', 'text-yellow-300', g);
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Nota: no se toca RLS. El workflow escribe con la service_role key (bypass de
-- RLS) y la app ya tiene sus politicas; aqui solo se agregan columnas.
-- ----------------------------------------------------------------------------


-- ############################################################################
-- [13/26] 20260903_mensajes_id_chatwoot.sql
-- ############################################################################

-- ============================================================================
-- Mensajes: anti-duplicado por ID de Chatwoot
-- Ejecutar antes de importar el workflow actualizado de Luna.
--
-- Problema: el workflow comparaba el contenido para no duplicar mensajes, pero
-- los audios y las fotos se guardan como "[audio]"/"[imagen]". Resultado: el
-- segundo audio seguido caía como "duplicado" y nunca llegaba al dashboard.
-- Ahora se deduplica con el ID del mensaje de Chatwoot, que es único.
-- ============================================================================

ALTER TABLE public.mensajes ADD COLUMN IF NOT EXISTS chatwoot_message_id text;

COMMENT ON COLUMN public.mensajes.chatwoot_message_id IS
  'ID del mensaje en Chatwoot. Se usa para no guardar dos veces el mismo mensaje.';

-- Índice para que la consulta de deduplicado sea instantánea
CREATE INDEX IF NOT EXISTS mensajes_chatwoot_message_id_idx
  ON public.mensajes (conversacion_id, chatwoot_message_id)
  WHERE chatwoot_message_id IS NOT NULL;

-- Sin RLS nueva: la tabla ya tiene sus políticas y el workflow escribe con la
-- service_role key.


-- ############################################################################
-- [14/26] 20260904_eliminar_cliente_completo.sql
-- ############################################################################

-- ============================================================================
-- 🗑️ ELIMINAR CLIENTE COMPLETAMENTE
-- ----------------------------------------------------------------------------
-- Borra de forma permanente toda la información del cliente dentro del CRM.
-- Al no quedar ninguna fila en `clientes`, el siguiente mensaje de ese número
-- crea un cliente nuevo y vuelve a entrar como Lead Nuevo.
--
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- La función es transaccional: si una eliminación falla, no deja el cliente
-- borrado a medias.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eliminar_cliente_completo(p_cliente_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversacion_ids uuid[];
  v_conversaciones integer := 0;
  v_mensajes integer := 0;
  v_pagos integer := 0;
  v_tareas integer := 0;
  v_recordatorios integer := 0;
  v_reglas integer := 0;
  v_clientes integer := 0;
BEGIN
  IF p_cliente_id IS NULL THEN
    RAISE EXCEPTION 'El cliente es obligatorio';
  END IF;

  -- Guardamos todas las conversaciones antes de borrarlas. Esto cubre también
  -- historiales duplicados o conversaciones de los dos números de WhatsApp.
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
    INTO v_conversacion_ids
    FROM public.conversaciones
   WHERE cliente_id = p_cliente_id;

  v_conversaciones := cardinality(v_conversacion_ids);

  -- Estas tablas son opcionales en instalaciones antiguas. Se consultan de
  -- forma dinámica para que la migración siga siendo compatible si Cerebro o
  -- los recordatorios todavía no se han instalado.
  IF to_regclass('public.recordatorios_whatsapp') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.recordatorios_whatsapp WHERE cliente_id = $1'
      USING p_cliente_id;
    GET DIAGNOSTICS v_recordatorios = ROW_COUNT;
  END IF;

  IF to_regclass('public.cerebro_reglas') IS NOT NULL THEN
    EXECUTE $sql$
      DELETE FROM public.cerebro_reglas
       WHERE cliente_id = $1
          OR (cardinality($2) > 0 AND conversacion_id = ANY($2))
    $sql$
      USING p_cliente_id, v_conversacion_ids;
    GET DIAGNOSTICS v_reglas = ROW_COUNT;
  END IF;

  -- Borrar primero los registros que dependen del cliente o de sus chats.
  DELETE FROM public.tareas WHERE cliente_id = p_cliente_id;
  GET DIAGNOSTICS v_tareas = ROW_COUNT;

  DELETE FROM public.pagos WHERE cliente_id = p_cliente_id;
  GET DIAGNOSTICS v_pagos = ROW_COUNT;

  IF v_conversaciones > 0 THEN
    DELETE FROM public.mensajes
     WHERE conversacion_id = ANY(v_conversacion_ids);
    GET DIAGNOSTICS v_mensajes = ROW_COUNT;
  END IF;

  DELETE FROM public.conversaciones WHERE cliente_id = p_cliente_id;

  -- Este es el punto clave: eliminar el cliente físico, no archivarlo ni
  -- marcarlo como perdido. Así el webhook no lo puede reutilizar por teléfono.
  DELETE FROM public.clientes WHERE id = p_cliente_id;
  GET DIAGNOSTICS v_clientes = ROW_COUNT;

  RETURN jsonb_build_object(
    'cliente_id', p_cliente_id,
    'cliente_eliminado', v_clientes,
    'conversaciones_eliminadas', v_conversaciones,
    'mensajes_eliminados', v_mensajes,
    'pagos_eliminados', v_pagos,
    'tareas_eliminadas', v_tareas,
    'recordatorios_eliminados', v_recordatorios,
    'reglas_cerebro_eliminadas', v_reglas
  );
END;
$$;

-- El CRM usa la anon key desde el navegador. La función tiene SECURITY DEFINER
-- para poder eliminar en orden aun cuando las tablas tengan RLS activado.
REVOKE ALL ON FUNCTION public.eliminar_cliente_completo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eliminar_cliente_completo(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.eliminar_cliente_completo(uuid) IS
  'Elimina de forma permanente un cliente y todos sus datos CRM; el siguiente mensaje crea un lead nuevo.';


-- ############################################################################
-- [15/26] 20260905_eliminar_cliente_total.sql
-- ############################################################################

-- ============================================================================
-- 🗑️ ELIMINAR CLIENTE TOTAL (versión 2)
-- ----------------------------------------------------------------------------
-- Reemplaza la función de 20260904_eliminar_cliente_completo.sql por una que ya
-- no depende de una lista fija de tablas: recorre TODAS las tablas del esquema
-- public que tengan columna `cliente_id` o `conversacion_id` y borra las filas
-- de ese cliente. Así, aunque mañana agregues una tabla nueva (campañas,
-- seguimientos, lo que sea), el botón Eliminar la sigue limpiando sola.
--
-- Orden de borrado (para no pelear con las llaves foráneas):
--   1) tablas que cuelgan de la conversación (mensajes, reglas del cerebro...)
--   2) tablas que cuelgan del cliente (pagos, tareas, recordatorios...)
--   3) conversaciones
--   4) clientes  ← sin esta fila, el siguiente mensaje crea un lead nuevo
--
-- Toda la función corre en una sola transacción: si algo falla, no queda el
-- cliente borrado a medias.
--
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eliminar_cliente_completo(p_cliente_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversacion_ids uuid[];
  v_tabla            record;
  v_borrados         integer;
  v_conversaciones   integer := 0;
  v_clientes         integer := 0;
  v_detalle          jsonb := '{}'::jsonb;
BEGIN
  IF p_cliente_id IS NULL THEN
    RAISE EXCEPTION 'El cliente es obligatorio';
  END IF;

  -- --------------------------------------------------------------------------
  -- 0. Conversaciones del cliente (puede tener varias: WhatsApp personal y del
  --    templo, o historiales duplicados). Se leen antes de borrar nada.
  -- --------------------------------------------------------------------------
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
    INTO v_conversacion_ids
    FROM public.conversaciones
   WHERE cliente_id = p_cliente_id;

  v_conversaciones := cardinality(v_conversacion_ids);

  -- --------------------------------------------------------------------------
  -- 1. Todo lo que cuelga de una conversación de este cliente.
  --    relkind in ('r','p') deja por fuera vistas y vistas materializadas.
  -- --------------------------------------------------------------------------
  IF v_conversaciones > 0 THEN
    FOR v_tabla IN
      SELECT c.table_name
        FROM information_schema.columns c
        JOIN pg_class      pc ON pc.relname = c.table_name
        JOIN pg_namespace  pn ON pn.oid = pc.relnamespace AND pn.nspname = c.table_schema
       WHERE c.table_schema = 'public'
         AND c.column_name  = 'conversacion_id'
         AND pc.relkind IN ('r','p')
         AND c.table_name NOT IN ('conversaciones')
       ORDER BY c.table_name
    LOOP
      EXECUTE format('DELETE FROM public.%I WHERE conversacion_id = ANY($1)', v_tabla.table_name)
        USING v_conversacion_ids;
      GET DIAGNOSTICS v_borrados = ROW_COUNT;
      IF v_borrados > 0 THEN
        v_detalle := v_detalle || jsonb_build_object(v_tabla.table_name, v_borrados);
      END IF;
    END LOOP;
  END IF;

  -- --------------------------------------------------------------------------
  -- 2. Todo lo que cuelga del cliente.
  -- --------------------------------------------------------------------------
  FOR v_tabla IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN pg_class      pc ON pc.relname = c.table_name
      JOIN pg_namespace  pn ON pn.oid = pc.relnamespace AND pn.nspname = c.table_schema
     WHERE c.table_schema = 'public'
       AND c.column_name  = 'cliente_id'
       AND pc.relkind IN ('r','p')
       AND c.table_name NOT IN ('clientes', 'conversaciones')
     ORDER BY c.table_name
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE cliente_id = $1', v_tabla.table_name)
      USING p_cliente_id;
    GET DIAGNOSTICS v_borrados = ROW_COUNT;
    IF v_borrados > 0 THEN
      v_detalle := v_detalle || jsonb_build_object(v_tabla.table_name, v_borrados);
    END IF;
  END LOOP;

  -- --------------------------------------------------------------------------
  -- 3. Conversaciones y 4. cliente.
  -- --------------------------------------------------------------------------
  DELETE FROM public.conversaciones WHERE cliente_id = p_cliente_id;
  GET DIAGNOSTICS v_conversaciones = ROW_COUNT;

  DELETE FROM public.clientes WHERE id = p_cliente_id;
  GET DIAGNOSTICS v_clientes = ROW_COUNT;

  IF v_clientes = 0 THEN
    RAISE EXCEPTION 'No se encontró el cliente % en public.clientes', p_cliente_id;
  END IF;

  RETURN jsonb_build_object(
    'cliente_id',                  p_cliente_id,
    'cliente_eliminado',           v_clientes,
    'conversaciones_eliminadas',   v_conversaciones,
    'mensajes_eliminados',         COALESCE((v_detalle->>'mensajes')::integer, 0),
    'pagos_eliminados',            COALESCE((v_detalle->>'pagos')::integer, 0),
    'tareas_eliminadas',           COALESCE((v_detalle->>'tareas')::integer, 0),
    'recordatorios_eliminados',    COALESCE((v_detalle->>'recordatorios_whatsapp')::integer, 0),
    'reglas_cerebro_eliminadas',   COALESCE((v_detalle->>'cerebro_reglas')::integer, 0),
    'otras_tablas',                v_detalle - ARRAY['mensajes','pagos','tareas','recordatorios_whatsapp','cerebro_reglas']
  );
END;
$$;

-- El CRM llama esta función con la service role desde el endpoint
-- /api/clientes/eliminar; se deja EXECUTE para anon/authenticated para que la
-- instalación siga funcionando si alguien la llama desde el navegador.
REVOKE ALL ON FUNCTION public.eliminar_cliente_completo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eliminar_cliente_completo(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.eliminar_cliente_completo(uuid) IS
  'Elimina de forma permanente un cliente y TODAS sus filas en Supabase (recorre cualquier tabla con cliente_id o conversacion_id). El siguiente mensaje de ese numero crea un lead nuevo.';

-- ============================================================================
-- Verificación opcional después de ejecutar la migración:
--   SELECT public.eliminar_cliente_completo('uuid-del-cliente');
--   SELECT count(*) FROM public.clientes WHERE id = 'uuid-del-cliente';   -- 0
-- ============================================================================


-- ############################################################################
-- [16/26] 20260906_sincronizacion_directa_chatwoot.sql
-- ############################################################################

-- ============================================================================
-- SINCRONIZACIÓN DIRECTA CHATWOOT → SUPABASE (red de seguridad)
-- ----------------------------------------------------------------------------
-- El dashboard ahora sincroniza con Chatwoot por sí mismo:
--   · /api/chatwoot/sync    → sondeo cada 20 s + al abrir un chat + botón 🔄
--   · /api/chatwoot/webhook → webhook directo de Chatwoot (recomendado)
--
-- Esta migración es OPCIONAL pero muy recomendada: garantiza que existan
-- la columna chatwoot_message_id (deduplicación), las RPC de no_leidos y la
-- publicación realtime de las tablas que la app escucha. Es idempotente:
-- se puede correr las veces que sea sin romper nada.
-- ============================================================================

-- 1) Columna de deduplicación por ID de mensaje de Chatwoot
ALTER TABLE public.mensajes ADD COLUMN IF NOT EXISTS chatwoot_message_id text;

CREATE INDEX IF NOT EXISTS mensajes_chatwoot_message_id_idx
  ON public.mensajes (conversacion_id, chatwoot_message_id)
  WHERE chatwoot_message_id IS NOT NULL;

-- 2) RPC de recálculo de no leídos (por si no existiera)
CREATE OR REPLACE FUNCTION public.sincronizar_no_leidos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversaciones c
  SET no_leidos = (
    SELECT count(*)::int
    FROM public.mensajes m
    WHERE m.conversacion_id = c.id
      AND m.tipo <> 'enviado'
      AND m.creado_en > COALESCE(c.ultimo_leido_en, '1970-01-01'::timestamptz)
  );
END $$;

-- 3) Realtime: publicar las tablas que el dashboard escucha (si no lo están)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mensajes', 'conversaciones', 'clientes'] LOOP
    BEGIN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object THEN
      NULL; -- ya estaba publicada
    END;
  END LOOP;
END $$;


-- ############################################################################
-- [17/26] 20260907_llamadas_seguimiento_contactos.sql
-- ############################################################################

-- ============================================================================
-- 📞 WhatsApp Personal + etapa fija "En seguimiento"
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → New query → Run.
--
-- Esta migración solo crea la etapa de seguimiento del grupo Personal. Las
-- llamadas y la verificación de contactos ocurren de forma local en la APK,
-- porque la agenda y WhatsApp pertenecen al teléfono del operador.
-- ============================================================================

-- "En seguimiento" es una etapa real del pipeline Personal: los clientes se
-- pueden mover desde la ficha, se ven en Pipeline y se filtran desde el chip
-- especial al lado de "Por leer". La clave es estable aunque luego se cambie
-- el nombre visible desde Configurar Pipeline.
DO $$
DECLARE
  v_orden integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.pipeline_etapas
    WHERE clave = 'en_seguimiento'
  ) THEN
    SELECT COALESCE(MAX(orden), 0) + 1
      INTO v_orden
      FROM public.pipeline_etapas
     WHERE grupo = 'personal'
       AND COALESCE(es_spam, false) = false
       AND COALESCE(es_archivado, false) = false;

    INSERT INTO public.pipeline_etapas
      (clave, nombre, orden, color, bg_color, text_color, grupo, es_spam, es_archivado)
    VALUES
      ('en_seguimiento', 'En seguimiento', v_orden,
       'border-cyan-500', 'bg-cyan-500/15', 'text-cyan-300',
       'personal', false, false);
  END IF;
END $$;

COMMENT ON TABLE public.pipeline_etapas IS
  'Etapas configurables del CRM. La clave en_seguimiento pertenece al WhatsApp Personal y activa el aviso local diario de la APK cuando hay clientes en esa etapa.';

-- ============================================================================
-- ✅ LISTO
--
-- En la APK:
--   • La etiqueta "En seguimiento" aparece junto a "Por leer" solo en Personal.
--   • A las 9:00 a. m. el teléfono avisa cada día mientras haya clientes allí.
--   • El horario se programa localmente al abrir/sincronizar la APK y requiere
--     que "Avisos en el teléfono" esté activado en Tema/Ajustes.
-- ============================================================================


-- ############################################################################
-- [18/26] 20260908_unificar_pipeline_cuentas_seguimiento.sql
-- ############################################################################

-- ============================================================================
-- 🔮 UNIFICAR PIPELINE, CUENTAS POR ETAPA, SEGUIMIENTO DIARIO Y ARCHIVADOS
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede ejecutar varias veces sin riesgo.
--
-- CAMBIOS:
--   1. Un solo pipeline y unas solas subcategorías (se eliminan duplicados _templo).
--   2. Cada etapa tiene una cuenta encargada (WhatsApp API / WhatsApp Personal).
--   3. Una sola conversación por cliente unificando historial y chatwoot_id.
--   4. "En seguimiento" como check booleano en clientes con corte diario a las 8:00 AM.
--   5. Reconfirmar que leads de publicidad caen en "Nuevo Lead" (WhatsApp API).
-- ============================================================================

-- 1. COLUMNAS EN CLIENTES: CHECK DE SEGUIMIENTO Y FECHA DE ÚLTIMA REVISIÓN
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clientes' AND column_name = 'en_seguimiento'
  ) THEN
    ALTER TABLE public.clientes ADD COLUMN en_seguimiento boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clientes' AND column_name = 'seguimiento_revisado_en'
  ) THEN
    ALTER TABLE public.clientes ADD COLUMN seguimiento_revisado_en timestamptz DEFAULT NULL;
  END IF;
END $$;

-- 2. COLUMNA EN PIPELINE_ETAPAS: CUENTA RESPONSABLE (meta_business | evolution)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pipeline_etapas' AND column_name = 'cuenta_responsable'
  ) THEN
    ALTER TABLE public.pipeline_etapas ADD COLUMN cuenta_responsable text DEFAULT 'meta_business';
  END IF;
END $$;

-- 3. MIGRAR ESTADOS DE CLIENTES DUPLICADOS (_templo → base)
UPDATE public.clientes SET estado = 'nuevo_lead' WHERE estado = 'nuevo_lead_templo' OR estado IS NULL OR estado = '';
UPDATE public.clientes SET estado = 'en_consulta' WHERE estado = 'en_consulta_templo';
UPDATE public.clientes SET estado = 'consulta_hecha' WHERE estado = 'consulta_hecha_templo';
UPDATE public.clientes SET estado = 'pago_recibido' WHERE estado = 'pago_recibido_templo';
UPDATE public.clientes SET estado = 'trabajo_proceso' WHERE estado = 'trabajo_proceso_templo';
UPDATE public.clientes SET estado = 'trabajo_completado' WHERE estado = 'trabajo_completado_templo';
UPDATE public.clientes SET estado = 'perdido' WHERE estado = 'perdido_templo';

-- Si algún cliente tenía estado = 'en_seguimiento', activar check y pasar a 'en_consulta'
UPDATE public.clientes
   SET en_seguimiento = true,
       estado = 'en_consulta'
 WHERE estado = 'en_seguimiento';

-- 4. LIMPIEZA Y CONFIGURACIÓN DE PIPELINE_ETAPAS (UN SOLO PIPELINE)
-- Eliminar duplicados _templo y etapa en_seguimiento
DELETE FROM public.pipeline_etapas WHERE clave LIKE '%_templo';
DELETE FROM public.pipeline_etapas WHERE clave = 'en_seguimiento';
DELETE FROM public.pipeline_etapas WHERE es_spam = true OR es_archivado = true;

-- Garantizar las 7 etapas base del pipeline unificado con sus cuentas encargadas
INSERT INTO public.pipeline_etapas
  (clave, nombre, orden, color, bg_color, text_color, cuenta_responsable, grupo, es_spam, es_archivado)
VALUES
  ('nuevo_lead',        'Nuevo Lead',          1, 'border-blue-500',    'bg-blue-500/10',    'text-blue-300',    'meta_business', 'general', false, false),
  ('en_consulta',       'En Consulta',         2, 'border-yellow-500',  'bg-yellow-500/10',  'text-yellow-300',  'meta_business', 'general', false, false),
  ('consulta_hecha',    'Consulta Hecha',      3, 'border-orange-500',  'bg-orange-500/10',  'text-orange-300',  'evolution',     'general', false, false),
  ('pago_recibido',     'Pago Recibido',       4, 'border-emerald-500', 'bg-emerald-500/10', 'text-emerald-300', 'evolution',     'general', false, false),
  ('trabajo_proceso',   'Trabajo en Proceso',  5, 'border-purple-500',  'bg-purple-500/10',  'text-purple-300',  'evolution',     'general', false, false),
  ('trabajo_completado','Trabajo Completado',  6, 'border-green-500',   'bg-green-500/10',   'text-green-300',   'evolution',     'general', false, false),
  ('perdido',           'Perdido',             7, 'border-red-500',     'bg-red-500/10',     'text-red-300',     'evolution',     'general', false, false)
ON CONFLICT (clave) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  orden = EXCLUDED.orden,
  color = EXCLUDED.color,
  bg_color = EXCLUDED.bg_color,
  text_color = EXCLUDED.text_color,
  cuenta_responsable = COALESCE(pipeline_etapas.cuenta_responsable, EXCLUDED.cuenta_responsable);

-- 5. FUNCIÓN MEJORADA: UNIFICAR HISTORIAL DE WHATSAPP EN UNA SOLA CONVERSACIÓN
CREATE OR REPLACE FUNCTION public.unificar_conversaciones_whatsapp()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente record;
  v_principal uuid;
  v_sec record;
  v_cw_id text;
  v_total integer := 0;
  v_ultimo record;
BEGIN
  -- Buscar clientes con más de una conversación
  FOR v_cliente IN
    SELECT cliente_id
      FROM public.conversaciones
     WHERE cliente_id IS NOT NULL
     GROUP BY cliente_id
    HAVING count(*) > 1
  LOOP
    -- Elegir la conversación principal: la más activa recientemente
    SELECT id, chatwoot_conversation_id
      INTO v_principal, v_cw_id
      FROM public.conversaciones
     WHERE cliente_id = v_cliente.cliente_id
     ORDER BY ultimo_mensaje_en DESC NULLS LAST, creado_en ASC NULLS LAST
     LIMIT 1;

    -- Si la principal no tiene chatwoot_conversation_id, buscar si alguna secundaria sí lo tiene
    IF v_cw_id IS NULL THEN
      SELECT chatwoot_conversation_id INTO v_cw_id
        FROM public.conversaciones
       WHERE cliente_id = v_cliente.cliente_id
         AND chatwoot_conversation_id IS NOT NULL
       LIMIT 1;

      IF v_cw_id IS NOT NULL THEN
        UPDATE public.conversaciones
           SET chatwoot_conversation_id = v_cw_id
         WHERE id = v_principal;
      END IF;
    END IF;

    -- Mover mensajes de conversaciones secundarias a la principal
    FOR v_sec IN
      SELECT id FROM public.conversaciones
       WHERE cliente_id = v_cliente.cliente_id
         AND id <> v_principal
    LOOP
      INSERT INTO public.mensajes
        (conversacion_id, tipo, contenido, tipo_contenido, url_archivo, creado_en, chatwoot_message_id)
      SELECT v_principal, m.tipo, m.contenido, m.tipo_contenido, m.url_archivo, m.creado_en, m.chatwoot_message_id
        FROM public.mensajes m
       WHERE m.conversacion_id = v_sec.id
         AND NOT EXISTS (
           SELECT 1 FROM public.mensajes x
            WHERE x.conversacion_id = v_principal
              AND x.tipo = m.tipo
              AND x.creado_en = m.creado_en
              AND COALESCE(x.contenido, '') = COALESCE(m.contenido, '')
         );

      DELETE FROM public.mensajes WHERE conversacion_id = v_sec.id;
      DELETE FROM public.conversaciones WHERE id = v_sec.id;
      v_total := v_total + 1;
    END LOOP;

    -- Recalcular último mensaje y no leídos
    SELECT m.contenido, m.creado_en
      INTO v_ultimo
      FROM public.mensajes m
     WHERE m.conversacion_id = v_principal
     ORDER BY m.creado_en DESC NULLS LAST
     LIMIT 1;

    IF v_ultimo.creado_en IS NOT NULL THEN
      UPDATE public.conversaciones
         SET ultimo_mensaje = v_ultimo.contenido,
             ultimo_mensaje_en = v_ultimo.creado_en,
             no_leidos = (
               SELECT count(*)::integer FROM public.mensajes x
                WHERE x.conversacion_id = v_principal
                  AND x.tipo <> 'enviado'
                  AND x.creado_en > COALESCE(public.conversaciones.ultimo_leido_en, '1970-01-01'::timestamptz)
             )
       WHERE id = v_principal;
    END IF;
  END LOOP;

  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unificar_conversaciones_whatsapp() TO anon, authenticated;

-- 6. TRIGGER DE ENRUTADO: LEADS DE PUBLICIDAD SIEMPRE CAEN A NUEVO LEAD
CREATE OR REPLACE FUNCTION public.enrutar_cliente_por_numero(p_cliente_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta integer;
  v_estado_actual text;
BEGIN
  SELECT count(*) FILTER (WHERE fuente = 'meta_business')
    INTO v_meta
    FROM public.conversaciones
   WHERE cliente_id = p_cliente_id;

  IF v_meta > 0 THEN
    SELECT COALESCE(estado, '') INTO v_estado_actual
      FROM public.clientes
     WHERE id = p_cliente_id;

    -- Si el cliente no tiene etapa asignada o tiene una etapa antigua, cae en 'nuevo_lead'
    IF v_estado_actual = '' OR v_estado_actual = 'nuevo_lead_templo' OR v_estado_actual = 'en_seguimiento' THEN
      UPDATE public.clientes
         SET estado = 'nuevo_lead',
             actualizado_en = now()
       WHERE id = p_cliente_id;
    END IF;
  END IF;
END;
$$;

-- Ejecutar unificación inicial de conversaciones
SELECT public.unificar_conversaciones_whatsapp();


-- ############################################################################
-- [19/26] 20260910_eliminar_etapas_pago_recibido_perdido.sql
-- ############################################################################

-- =====================================================================
-- ELIMINAR ETAPAS "PAGO RECIBIDO" Y "PERDIDO" DEL PIPELINE
-- ---------------------------------------------------------------------
-- Pipeline final (5 etapas):
--   1. Nuevo Lead
--   2. En Consulta
--   3. Consulta Hecha
--   4. Trabajo en Proceso
--   5. Trabajo Completado
--
-- Remapeo de clientes existentes:
--   pago_recibido (y *_templo) -> trabajo_proceso
--   perdido       (y *_templo) -> nuevo_lead
-- =====================================================================

-- 1. MOVER CLIENTES QUE ESTÁN EN LAS ETAPAS ELIMINADAS
UPDATE public.clientes
   SET estado = 'trabajo_proceso',
       actualizado_en = now()
 WHERE estado IN ('pago_recibido', 'pago_recibido_templo');

UPDATE public.clientes
   SET estado = 'nuevo_lead',
       actualizado_en = now()
 WHERE estado IN ('perdido', 'perdido_templo');

-- 2. BORRAR LAS ETAPAS DEL PIPELINE
DELETE FROM public.pipeline_etapas
 WHERE clave IN ('pago_recibido', 'pago_recibido_templo', 'perdido', 'perdido_templo');

-- 3. REORDENAR LAS ETAPAS RESTANTES
UPDATE public.pipeline_etapas SET orden = 1 WHERE clave = 'nuevo_lead';
UPDATE public.pipeline_etapas SET orden = 2 WHERE clave = 'en_consulta';
UPDATE public.pipeline_etapas SET orden = 3 WHERE clave = 'consulta_hecha';
UPDATE public.pipeline_etapas SET orden = 4 WHERE clave = 'trabajo_proceso';
UPDATE public.pipeline_etapas SET orden = 5 WHERE clave = 'trabajo_completado';

-- 4. GARANTIZAR QUE LAS 5 ETAPAS VIGENTES EXISTEN
INSERT INTO public.pipeline_etapas
  (clave, nombre, orden, color, bg_color, text_color, cuenta_responsable, grupo, es_spam, es_archivado)
VALUES
  ('nuevo_lead',        'Nuevo Lead',          1, 'border-blue-500',   'bg-blue-500/10',   'text-blue-300',   'meta_business', 'general', false, false),
  ('en_consulta',       'En Consulta',         2, 'border-yellow-500', 'bg-yellow-500/10', 'text-yellow-300', 'meta_business', 'general', false, false),
  ('consulta_hecha',    'Consulta Hecha',      3, 'border-orange-500', 'bg-orange-500/10', 'text-orange-300', 'evolution',     'general', false, false),
  ('trabajo_proceso',   'Trabajo en Proceso',  4, 'border-purple-500', 'bg-purple-500/10', 'text-purple-300', 'evolution',     'general', false, false),
  ('trabajo_completado','Trabajo Completado',  5, 'border-green-500',  'bg-green-500/10',  'text-green-300',  'evolution',     'general', false, false)
ON CONFLICT (clave) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  orden = EXCLUDED.orden,
  color = EXCLUDED.color,
  bg_color = EXCLUDED.bg_color,
  text_color = EXCLUDED.text_color;


-- ############################################################################
-- [20/26] 20260911_luna_datos_nuevo_lead_por_nombre.sql
-- ############################################################################

-- ============================================================================
-- 🔮 LUNA: asegurar etapas "Nuevo Lead" y "Datos" por NOMBRE, no por clave
-- + reactivar Luna en esas etapas
-- ----------------------------------------------------------------------------
-- Problema: Luna no contestaba en las etapas acordadas (nuevo lead y datos).
-- Causa: validacion por clave (etapa_xxx_timestamp) en vez de por nombre visible,
-- y conversaciones con agente_activo=false o luna_pausada=true que no se reactivaban.
--
-- Esta migración:
-- 1. Garantiza que existan etapas con NOMBRE "Nuevo Lead" y "Datos" (validacion por nombre)
--    en grupo "general" y también en "templo"/"personal" por compatibilidad.
-- 2. Reactiva Luna (agente_activo=true) en conversaciones cuyo cliente está
--    en etapa "Nuevo Lead" o "Datos" por NOMBRE y aún no ha enviado lista.
-- 3. Limpia luna_pausada y lista_requisitos_enviada cuando la etapa es "Nuevo Lead" por nombre.
-- 4. Asegura luna_global_activa=true para que Luna esté activa.
-- ============================================================================

-- 1) Asegurar que existan las etapas base por NOMBRE (no por clave)
DO $$
DECLARE
  g text;
BEGIN
  -- Grupos donde deben existir Nuevo Lead y Datos por nombre
  FOREACH g IN ARRAY ARRAY['general','templo','personal']
  LOOP
    -- Nuevo Lead por nombre
    IF NOT EXISTS (
      SELECT 1 FROM public.pipeline_etapas
      WHERE lower(nombre) = 'nuevo lead' AND (grupo = g OR (g = 'general' AND (grupo IS NULL OR grupo = 'general')))
    ) THEN
      INSERT INTO public.pipeline_etapas (clave, nombre, orden, color, bg_color, text_color, cuenta_responsable, grupo, es_spam, es_archivado)
      VALUES (
        CASE WHEN g = 'general' THEN 'nuevo_lead' ELSE 'nuevo_lead_' || g || '_' || extract(epoch from now())::bigint END,
        'Nuevo Lead',
        1,
        'border-blue-500', 'bg-blue-500/10', 'text-blue-300',
        'meta_business',
        g,
        false, false
      )
      ON CONFLICT (clave) DO NOTHING;
    END IF;

    -- Datos por nombre (etapa donde Luna clasifica y envía lista)
    IF NOT EXISTS (
      SELECT 1 FROM public.pipeline_etapas
      WHERE lower(nombre) = 'datos' AND (grupo = g OR (g = 'general' AND (grupo IS NULL OR grupo = 'general')))
    ) THEN
      INSERT INTO public.pipeline_etapas (clave, nombre, orden, color, bg_color, text_color, cuenta_responsable, grupo, es_spam, es_archivado)
      VALUES (
        CASE WHEN g = 'general' THEN 'datos' ELSE 'datos_' || g || '_' || extract(epoch from now())::bigint END,
        'Datos',
        2,
        'border-sky-500', 'bg-sky-500/10', 'text-sky-300',
        'meta_business',
        g,
        false, false
      )
      ON CONFLICT (clave) DO NOTHING;
    END IF;
  END LOOP;

  -- Si la tabla estaba vacía o solo tenía el pipeline unificado de 5 etapas sin Datos,
  -- asegurar que Datos exista en general con orden 2 y reordenar el resto
  IF EXISTS (SELECT 1 FROM public.pipeline_etapas WHERE clave = 'nuevo_lead' AND lower(nombre) = 'nuevo lead') 
     AND NOT EXISTS (SELECT 1 FROM public.pipeline_etapas WHERE clave = 'datos' AND lower(nombre) = 'datos' AND grupo = 'general') THEN
    INSERT INTO public.pipeline_etapas (clave, nombre, orden, color, bg_color, text_color, cuenta_responsable, grupo, es_spam, es_archivado)
    VALUES ('datos','Datos',2,'border-sky-500','bg-sky-500/10','text-sky-300','meta_business','general',false,false)
    ON CONFLICT (clave) DO UPDATE SET nombre='Datos', orden=2;
  END IF;

  -- Reordenar pipeline general para que sea: Nuevo Lead (1), Datos (2), En Consulta (3), Consulta Hecha (4), Trabajo en Proceso (5), Trabajo Completado (6)
  UPDATE public.pipeline_etapas SET orden = 1 WHERE clave = 'nuevo_lead' AND grupo = 'general';
  UPDATE public.pipeline_etapas SET orden = 2 WHERE clave = 'datos' AND grupo = 'general';
  UPDATE public.pipeline_etapas SET orden = 3 WHERE clave = 'en_consulta' AND grupo = 'general';
  UPDATE public.pipeline_etapas SET orden = 4 WHERE clave = 'consulta_hecha' AND grupo = 'general';
  UPDATE public.pipeline_etapas SET orden = 5 WHERE clave = 'trabajo_proceso' AND grupo = 'general';
  UPDATE public.pipeline_etapas SET orden = 6 WHERE clave = 'trabajo_completado' AND grupo = 'general';
END $$;

-- 2) Asegurar luna_global_activa = true (Luna debe estar activa)
INSERT INTO public.config_general (clave, valor, descripcion)
VALUES ('luna_global_activa','true','Luna activa globalmente — validacion por nombre en Nuevo Lead y Datos')
ON CONFLICT (clave) DO UPDATE SET valor='true', actualizado_en=now();

-- 3) Reactivar conversaciones en Nuevo Lead o Datos por NOMBRE
--    - Si el cliente está en etapa cuyo NOMBRE es "Nuevo Lead" o "Datos", poner agente_activo=true
--    - Si está en "Nuevo Lead" por nombre, limpiar pausa de Chatwoot (esto último lo hace n8n, pero dejamos agente_activo true)
DO $$
DECLARE
  etapa_record record;
  clave_datos text;
  clave_nuevo text;
BEGIN
  -- Obtener claves reales por NOMBRE en grupo general
  SELECT clave INTO clave_nuevo FROM public.pipeline_etapas WHERE lower(nombre)='nuevo lead' AND grupo='general' ORDER BY orden LIMIT 1;
  SELECT clave INTO clave_datos FROM public.pipeline_etapas WHERE lower(nombre)='datos' AND grupo='general' ORDER BY orden LIMIT 1;

  -- Si no hay en general, buscar en cualquier grupo por nombre
  IF clave_nuevo IS NULL THEN
    SELECT clave INTO clave_nuevo FROM public.pipeline_etapas WHERE lower(nombre)='nuevo lead' ORDER BY orden LIMIT 1;
  END IF;
  IF clave_datos IS NULL THEN
    SELECT clave INTO clave_datos FROM public.pipeline_etapas WHERE lower(nombre)='datos' ORDER BY orden LIMIT 1;
  END IF;

  -- Reactivar agentes en Nuevo Lead por NOMBRE (todas las claves cuyo nombre es Nuevo Lead)
  FOR etapa_record IN
    SELECT clave FROM public.pipeline_etapas WHERE lower(nombre)='nuevo lead'
  LOOP
    UPDATE public.conversaciones
       SET agente_activo = true
     WHERE cliente_id IN (SELECT id FROM public.clientes WHERE lower(estado)=lower(etapa_record.clave) OR lower(estado)=lower('nuevo_lead') OR lower(estado) LIKE '%nuevo%lead%')
       AND agente_activo = false;
  END LOOP;

  -- Reactivar agentes en Datos por NOMBRE donde lista no ha sido enviada (agente_activo false por pausa previa incorrecta)
  -- Solo reactivamos si la conversación NO tiene luna_pausada true en Chatwoot (no podemos leer Chatwoot desde SQL, así que reactivamos Datos que estaban pausados por error)
  FOR etapa_record IN
    SELECT clave FROM public.pipeline_etapas WHERE lower(nombre)='datos'
  LOOP
    UPDATE public.conversaciones
       SET agente_activo = true
     WHERE cliente_id IN (SELECT id FROM public.clientes WHERE lower(estado)=lower(etapa_record.clave) OR lower(estado)='datos')
       AND agente_activo = false
       -- No reactivar si el cliente ya tiene luna_etapa = datos y lista enviada (eso lo maneja n8n)
       AND cliente_id NOT IN (
         SELECT id FROM public.clientes WHERE luna_etapa='datos' AND motivo_categoria IS NOT NULL
       );
  END LOOP;

  -- Fallback: si hay clientes sin estado o con estado vacío, ponerlos en Nuevo Lead y activar
  UPDATE public.clientes SET estado = COALESCE(clave_nuevo, 'nuevo_lead'), actualizado_en=now() WHERE estado IS NULL OR estado = '';
  UPDATE public.conversaciones SET agente_activo = true WHERE cliente_id IN (SELECT id FROM public.clientes WHERE estado IS NULL OR estado = '');

END $$;

-- 4) Log de verificación
DO $$
DECLARE
  total_nuevo integer;
  total_datos integer;
  total_activas integer;
BEGIN
  SELECT count(*) INTO total_nuevo FROM public.pipeline_etapas WHERE lower(nombre)='nuevo lead';
  SELECT count(*) INTO total_datos FROM public.pipeline_etapas WHERE lower(nombre)='datos';
  SELECT count(*) INTO total_activas FROM public.conversaciones WHERE agente_activo=true;
  RAISE NOTICE 'Luna etapas por NOMBRE: Nuevo Lead=% Datos=% Conversaciones activas=%', total_nuevo, total_datos, total_activas;
END $$;


-- ############################################################################
-- [21/26] 20260912_deduplicar_etapas_luna_por_nombre.sql
-- ############################################################################

-- ============================================================================
-- 🧹 LUNA: consolidar las etapas "Nuevo Lead" y "Datos" POR NOMBRE
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede volver a correr sin riesgo; si no hay duplicados
-- no pasa nada.
--
-- PROBLEMA:
--   Las migraciones anteriores crearon filas EXTRA con nombre "Nuevo Lead" y
--   "Datos" en varios grupos (claves tipo datos_templo_<ts>,
--   datos_personal_<ts> ...), duplicando la etapa "Datos" que ya estaba
--   creada en el pipeline del usuario. El CRM mostraba varias etapas "Datos"
--   y los clientes quedaban apuntando a claves duplicadas.
--
-- LO QUE HACE ESTA MIGRACIÓN (NUNCA CREAR NINGUNA ETAPA):
--   1. Busca todas las filas de pipeline_etapas cuyo NOMBRE visible es
--      "Nuevo Lead" o "Datos" (cualquier clave, cualquier grupo).
--   2. Deja UNA sola fila por nombre, conservando la etapa que ya existe:
--        * "Datos": la etapa creada por el usuario (clave etapa_<ts>), si no
--          hay, la más referenciada por clientes, si no, la más antigua.
--        * "Nuevo Lead": la fila con clave 'nuevo_lead' (el trigger de
--          enrutado de leads escribe esa literal), si no existe, la etapa
--          creada por el usuario, si no, la más referenciada.
--   3. Re-apunta a TODOS los clientes cuyo estado apuntaba a una clave
--      eliminada, o a una clave que no existe en el pipeline pero se
--      reconoce por nombre ("datos", "nuevo_lead", "datos_templo_...", etc.).
--   4. Si no hay ninguna fila con clave 'nuevo_lead', renombra a esa clave la
--      "Nuevo Lead" que sobrevive (sigue siendo la MISMA etapa del usuario:
--      mismo nombre, color y orden), para que el trigger siga haciendo caer
--      los leads de publicidad en la etapa existente.
--
-- RESULTADO: una sola "Nuevo Lead" y una sola "Datos" — la que ya estaba
-- creada — y Luna las reconoce por NOMBRE (el workflow n8n busca por nombre
-- visible y ya no escribe claves inventadas ni crea etapas).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CONSOLIDAR DUPLICADOS POR NOMBRE (sin crear nada)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_nombre text;
  v_sob record;
  v_dup record;
  v_n_elim integer := 0;
BEGIN
  FOREACH v_nombre IN ARRAY ARRAY['nuevo lead', 'datos']
  LOOP
    -- Sobreviviente: UNA sola etapa con ese nombre visible
    SELECT * INTO v_sob
    FROM (
      SELECT p.id, p.clave, p.nombre, p.orden, p.grupo, p.creado_en,
             (SELECT count(*) FROM public.clientes c WHERE c.estado = p.clave) AS refs
        FROM public.pipeline_etapas p
       WHERE lower(btrim(p.nombre)) = v_nombre
         AND COALESCE(p.es_spam, false) = false
         AND COALESCE(p.es_archivado, false) = false
       ORDER BY
         CASE
           WHEN v_nombre = 'nuevo lead' AND p.clave = 'nuevo_lead' THEN 0
           WHEN v_nombre = 'datos' AND p.clave ~ '^etapa_[0-9]+$' THEN 0
           WHEN v_nombre = 'nuevo lead' AND p.clave ~ '^etapa_[0-9]+$' THEN 1
           ELSE 2
         END,
         refs DESC,
         COALESCE(p.creado_en, '1970-01-01'::timestamptz) ASC,
         p.clave ASC
    ) s
    LIMIT 1;

    IF v_sob.id IS NULL THEN
      RAISE NOTICE 'Etapa "%" no existe en el pipeline: no se crea ninguna (Luna no crea etapas; usa la que ya esta creada).', v_nombre;
      CONTINUE;
    END IF;

    -- Eliminar los duplicados con el mismo nombre visible y re-apuntar clientes
    FOR v_dup IN
      SELECT p.id, p.clave, p.nombre
        FROM public.pipeline_etapas p
       WHERE lower(btrim(p.nombre)) = v_nombre
         AND COALESCE(p.es_spam, false) = false
         AND COALESCE(p.es_archivado, false) = false
         AND p.id <> v_sob.id
       ORDER BY p.orden
    LOOP
      UPDATE public.clientes
         SET estado = v_sob.clave, actualizado_en = now()
       WHERE estado = v_dup.clave;
      DELETE FROM public.pipeline_etapas WHERE id = v_dup.id;
      v_n_elim := v_n_elim + 1;
      RAISE NOTICE 'Consolidado: eliminada la etapa duplicada "%" (clave %) → los clientes pasan a la etapa ya creada (clave %).',
        v_dup.nombre, v_dup.clave, v_sob.clave;
    END LOOP;
  END LOOP;

  IF v_n_elim = 0 THEN
    RAISE NOTICE 'Sin duplicados por nombre: no se elimino ninguna etapa.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. RE-APUNTAR CLIENTES CUYO ESTADO ES UNA CLAVE QUE NO EXISTE EN EL
--    PIPELINE pero se reconoce por NOMBRE como "Datos" o "Nuevo Lead"
--    (los que Luna movio antes con claves semilla/duplicadas)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_datos text;
  v_nuevo text;
  v_estado record;
  v_cambios integer := 0;
BEGIN
  SELECT clave INTO v_datos
    FROM public.pipeline_etapas
   WHERE lower(btrim(nombre)) = 'datos'
     AND COALESCE(es_spam, false) = false
     AND COALESCE(es_archivado, false) = false
   ORDER BY orden
   LIMIT 1;

  SELECT clave INTO v_nuevo
    FROM public.pipeline_etapas
   WHERE lower(btrim(nombre)) = 'nuevo lead'
     AND COALESCE(es_spam, false) = false
     AND COALESCE(es_archivado, false) = false
   ORDER BY orden
   LIMIT 1;

  FOR v_estado IN
    SELECT DISTINCT estado FROM public.clientes
     WHERE estado IS NOT NULL
       AND btrim(estado) <> ''
  LOOP
    -- Solo nos interesan los estados cuya clave YA NO existe en el pipeline
    IF EXISTS (SELECT 1 FROM public.pipeline_etapas WHERE clave = v_estado.estado) THEN
      CONTINUE;
    END IF;

    IF v_datos IS NOT NULL AND (
         lower(v_estado.estado) IN (
           'datos', 'datos_templo', 'datos_personal', 'datos_cliente', 'datos_del_cliente',
           'solicitar_datos', 'solicitud_datos', 'pedir_datos', 'en_datos',
           'recoger_datos', 'recoleccion_datos'
         )
         OR lower(v_estado.estado) LIKE 'datos\_%'
       ) THEN
      UPDATE public.clientes
         SET estado = v_datos, actualizado_en = now()
       WHERE estado = v_estado.estado;
      v_cambios := v_cambios + 1;
      RAISE NOTICE 'Clientes con estado "%" (clave que no existe) → etapa ya creada "Datos" (clave %).', v_estado.estado, v_datos;
    ELSIF v_nuevo IS NOT NULL AND (
         lower(v_estado.estado) IN (
           'nuevo_lead', 'lead_nuevo', 'leadnuevo', 'nuevo', 'lead',
           'nuevo_lead_templo', 'nuevo_lead_personal', 'nuevo_templo',
           'nuevo_cliente', 'nuevo_contacto', 'primer_contacto'
         )
         OR lower(v_estado.estado) LIKE 'nuevo_lead\_%'
       ) THEN
      UPDATE public.clientes
         SET estado = v_nuevo, actualizado_en = now()
       WHERE estado = v_estado.estado;
      v_cambios := v_cambios + 1;
      RAISE NOTICE 'Clientes con estado "%" (clave que no existe) → etapa ya creada "Nuevo Lead" (clave %).', v_estado.estado, v_nuevo;
    END IF;
  END LOOP;

  IF v_cambios = 0 THEN
    RAISE NOTICE 'Sin clientes apuntando a claves que no existen.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. CLAVE CANONICA "nuevo_lead": el trigger enrutar_cliente_por_numero
--    escribe esa clave literal al hacer caer leads de publicidad.
--    Si no existe la fila, la "Nuevo Lead" que sobrevive (la misma etapa del
--    usuario, sin crear ninguna) toma esa clave.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pipeline_etapas WHERE clave = 'nuevo_lead') THEN
    UPDATE public.pipeline_etapas
       SET clave = 'nuevo_lead'
     WHERE id = (
       SELECT id FROM public.pipeline_etapas
        WHERE lower(btrim(nombre)) = 'nuevo lead'
          AND COALESCE(es_spam, false) = false
          AND COALESCE(es_archivado, false) = false
        ORDER BY orden
        LIMIT 1
     );
    RAISE NOTICE 'La etapa "Nuevo Lead" ya creada ahora usa la clave canonica "nuevo_lead" (la que escribe el trigger de leads).';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. RESUMEN DE VERIFICACION
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT nombre, clave, orden, grupo,
           (SELECT count(*) FROM public.clientes c WHERE c.estado = clave) AS clientes
      FROM public.pipeline_etapas
     WHERE lower(btrim(nombre)) IN ('nuevo lead', 'datos')
       AND COALESCE(es_spam, false) = false
       AND COALESCE(es_archivado, false) = false
     ORDER BY lower(btrim(nombre)), orden
  LOOP
    RAISE NOTICE 'Pipeline por nombre: "%" | clave=% | orden=% | grupo=% | clientes=%',
      r.nombre, r.clave, r.orden, COALESCE(r.grupo, '(null)'), r.clientes;
  END LOOP;
END $$;

-- ============================================================================
-- ✅ LISTO. A partir de ahora:
--    1) El pipeline tiene UNA sola "Nuevo Lead" y UNA sola "Datos" (las ya
--       creadas; no se creo ninguna etapa nueva).
--    2) Todos los clientes apuntan a esas claves reales.
--    3) Luna (n8n) resuelve las etapas por NOMBRE y ya no escribe claves
--       inventadas: si la etapa no existe, no mueve al cliente ni crea nada.
-- ============================================================================


-- ############################################################################
-- [22/26] 20260913_respuestas_rapidas.sql
-- ############################################################################

-- ===========================================================================
-- Respuestas rápidas compartidas entre todos los dispositivos
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.respuestas_rapidas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('texto', 'audio', 'imagen')),
  titulo text NOT NULL DEFAULT '',
  contenido text NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS respuestas_rapidas_creado_en_idx
  ON public.respuestas_rapidas (creado_en ASC);

ALTER TABLE public.respuestas_rapidas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "respuestas_rapidas_lectura_publica" ON public.respuestas_rapidas;
CREATE POLICY "respuestas_rapidas_lectura_publica"
  ON public.respuestas_rapidas FOR SELECT USING (true);

DROP POLICY IF EXISTS "respuestas_rapidas_escritura_publica" ON public.respuestas_rapidas;
CREATE POLICY "respuestas_rapidas_escritura_publica"
  ON public.respuestas_rapidas FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.respuestas_rapidas REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.respuestas_rapidas;
EXCEPTION WHEN duplicate_object THEN
  NULL;
WHEN undefined_object THEN
  NULL;
END $$;

COMMENT ON TABLE public.respuestas_rapidas IS
  'Textos, audios e imágenes de respuesta rápida compartidos por todos los operadores y dispositivos.';


-- ############################################################################
-- [23/26] 20260914_un_chat_por_cliente.sql
-- ############################################################################

-- Un chat CRM por cliente: guarda todos los conversation_id de Chatwoot
-- (WhatsApp API + WhatsApp Personal) en la misma fila.

ALTER TABLE public.conversaciones
  ADD COLUMN IF NOT EXISTS chatwoot_conversation_ids text[] NOT NULL DEFAULT '{}';

UPDATE public.conversaciones
   SET chatwoot_conversation_ids = ARRAY[chatwoot_conversation_id]
 WHERE chatwoot_conversation_id IS NOT NULL
   AND (chatwoot_conversation_ids IS NULL OR cardinality(chatwoot_conversation_ids) = 0);

CREATE INDEX IF NOT EXISTS conversaciones_chatwoot_ids_gin
  ON public.conversaciones USING gin (chatwoot_conversation_ids);

-- Fusiona duplicados: conserva Evolution (Personal) y mueve mensajes + ids.
CREATE OR REPLACE FUNCTION public.unificar_conversaciones_whatsapp()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente record;
  v_personal uuid;
  v_meta record;
  v_total integer := 0;
  v_ultimo record;
BEGIN
  FOR v_cliente IN
    SELECT DISTINCT c.cliente_id
      FROM public.conversaciones c
     WHERE c.cliente_id IS NOT NULL
     GROUP BY c.cliente_id
    HAVING COUNT(*) > 1
  LOOP
    SELECT id INTO v_personal
      FROM public.conversaciones
     WHERE cliente_id = v_cliente.cliente_id
     ORDER BY (fuente = 'evolution') DESC,
              ultimo_mensaje_en DESC NULLS LAST,
              creado_en ASC NULLS LAST
     LIMIT 1;

    FOR v_meta IN
      SELECT id, chatwoot_conversation_id, chatwoot_conversation_ids
        FROM public.conversaciones
       WHERE cliente_id = v_cliente.cliente_id
         AND id <> v_personal
    LOOP
      INSERT INTO public.mensajes
        (conversacion_id, tipo, contenido, tipo_contenido, url_archivo, creado_en, chatwoot_message_id)
      SELECT v_personal, m.tipo, m.contenido, m.tipo_contenido, m.url_archivo, m.creado_en, m.chatwoot_message_id
        FROM public.mensajes m
       WHERE m.conversacion_id = v_meta.id
         AND NOT EXISTS (
           SELECT 1 FROM public.mensajes x
            WHERE x.conversacion_id = v_personal
              AND (
                (m.chatwoot_message_id IS NOT NULL AND x.chatwoot_message_id = m.chatwoot_message_id)
                OR (
                  x.tipo = m.tipo
                  AND x.creado_en = m.creado_en
                  AND COALESCE(x.contenido, '') = COALESCE(m.contenido, '')
                )
              )
         );

      UPDATE public.conversaciones
         SET chatwoot_conversation_ids = (
           SELECT ARRAY(
             SELECT DISTINCT unnest(
               COALESCE(chatwoot_conversation_ids, '{}')
               || COALESCE(v_meta.chatwoot_conversation_ids, '{}')
               || CASE WHEN v_meta.chatwoot_conversation_id IS NOT NULL
                       THEN ARRAY[v_meta.chatwoot_conversation_id] ELSE '{}' END
             )
           )
         )
       WHERE id = v_personal;

      DELETE FROM public.mensajes WHERE conversacion_id = v_meta.id;
      DELETE FROM public.conversaciones WHERE id = v_meta.id;
      v_total := v_total + 1;
    END LOOP;

    SELECT m.contenido, m.creado_en
      INTO v_ultimo
      FROM public.mensajes m
     WHERE m.conversacion_id = v_personal
     ORDER BY m.creado_en DESC NULLS LAST
     LIMIT 1;

    UPDATE public.conversaciones
       SET ultimo_mensaje = v_ultimo.contenido,
           ultimo_mensaje_en = v_ultimo.creado_en,
           no_leidos = (
             SELECT count(*)::integer FROM public.mensajes x
              WHERE x.conversacion_id = v_personal
                AND x.tipo <> 'enviado'
                AND x.creado_en > COALESCE(public.conversaciones.ultimo_leido_en, '1970-01-01'::timestamptz)
           )
     WHERE id = v_personal;
  END LOOP;
  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unificar_conversaciones_whatsapp() TO anon, authenticated;


-- ############################################################################
-- [24/26] 20260915_sincronizacion_respuestas_rapidas_unica.sql
-- ############################################################################

-- ===========================================================================
-- Biblioteca de respuestas rápidas: sincronización manual sin duplicados.
-- Ejecutar DESPUÉS de 20260913_respuestas_rapidas.sql en Supabase SQL Editor.
-- ===========================================================================
--
-- Conserva la copia más antigua de cada respuesta cuyo tipo y contenido son
-- idénticos. Dos audios con el mismo título pero con audio distinto se conservan:
-- el título no es una clave única.

ALTER TABLE public.respuestas_rapidas
  ADD COLUMN IF NOT EXISTS huella text;

-- Calcula una huella estable para las filas existentes antes de crear el índice.
UPDATE public.respuestas_rapidas
SET huella = md5(tipo || chr(31) || contenido)
WHERE huella IS NULL
   OR huella <> md5(tipo || chr(31) || contenido);

-- El arreglo anterior pudo subir la misma respuesta desde cachés con IDs
-- distintos. Se conserva sólo la más antigua de cada contenido idéntico.
WITH repetidas AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY tipo, huella
      ORDER BY creado_en ASC, id ASC
    ) AS posicion
  FROM public.respuestas_rapidas
)
DELETE FROM public.respuestas_rapidas AS respuesta
USING repetidas
WHERE respuesta.id = repetidas.id
  AND repetidas.posicion > 1;

ALTER TABLE public.respuestas_rapidas
  ALTER COLUMN huella SET NOT NULL;

-- La función se ejecuta antes de insertar/actualizar, así ninguna aplicación
-- puede crear otra fila del mismo archivo o texto aunque sincronice a la vez.
CREATE OR REPLACE FUNCTION public.calcular_huella_respuesta_rapida()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.huella := md5(NEW.tipo || chr(31) || NEW.contenido);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS respuestas_rapidas_calcular_huella
  ON public.respuestas_rapidas;

CREATE TRIGGER respuestas_rapidas_calcular_huella
  BEFORE INSERT OR UPDATE OF tipo, contenido ON public.respuestas_rapidas
  FOR EACH ROW
  EXECUTE FUNCTION public.calcular_huella_respuesta_rapida();

CREATE UNIQUE INDEX IF NOT EXISTS respuestas_rapidas_tipo_huella_unica_idx
  ON public.respuestas_rapidas (tipo, huella);

COMMENT ON COLUMN public.respuestas_rapidas.huella IS
  'MD5 de tipo + separador + contenido. Evita respuestas rápidas duplicadas entre dispositivos.';


-- ############################################################################
-- [25/26] 20260916_media_storage.sql
-- ############################################################################

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


-- ############################################################################
-- [26/26] 20260917_respuestas_rapidas_a_storage.sql
-- ############################################################################

-- ============================================================================
-- RESPUESTAS RÁPIDAS: AUDIOS E IMÁGENES A SUPABASE STORAGE (ahorro de Egress)
-- ----------------------------------------------------------------------------
-- Problema: la biblioteca de respuestas rápidas se descarga COMPLETA en cada
-- sincronización y en cada evento de realtime de la tabla. Como los audios y las
-- imágenes vivían dentro de respuestas_rapidas.contenido en base64 (hasta ~8 MB
-- por audio), cada teléfono volvía a bajar todos los megabytes cada vez que algún
-- operador pulsaba «Sincronizar con todos». Es el mismo problema que ya se resolvió
-- para los adjuntos del chat en 20260916_media_storage.sql.
--
-- Solución: el archivo va al bucket público `media-mensajes` (carpeta
-- `respuestas-rapidas/`) y en la tabla queda sólo la URL. La subida la hace el
-- propio teléfono con la anon key (las políticas de ese bucket ya lo permiten), y
-- la ruta del objeto es el MD5 del archivo, así que dos teléfonos que suben el
-- mismo audio escriben en la misma ruta y no dejan copias duplicadas.
--
-- Consecuencia que arregla esta migración: la huella anti-duplicados se calculaba
-- sobre `contenido`, y una URL ya no representa el archivo. Por eso se añade
-- `hash_bytes` (MD5 de los bytes) y la huella pasa a ser md5(tipo + hash_bytes),
-- con md5(tipo + contenido) sólo como plan B (respuestas en texto, o filas de
-- clientes antiguos que aún no mandan la huella).
--
-- Ejecutar DESPUÉS de 20260913_respuestas_rapidas.sql,
-- 20260915_sincronizacion_respuestas_rapidas_unica.sql y
-- 20260916_media_storage.sql.  Supabase → SQL Editor → New query → Run.
-- ============================================================================

ALTER TABLE public.respuestas_rapidas
  ADD COLUMN IF NOT EXISTS hash_bytes text;

-- 1) Huella de los binarios que todavía están incrustados como data-URI.
--    Se valida el base64 antes de decodificar para que una fila con un texto
--    raro no reviente la migración entera.
UPDATE public.respuestas_rapidas
SET hash_bytes = md5(decode(replace(split_part(contenido, ',', 2), E'\n', ''), 'base64'))
WHERE hash_bytes IS NULL
  AND tipo IN ('audio', 'imagen')
  AND contenido LIKE 'data:%'
  AND position(',' IN contenido) > 0
  AND length(replace(split_part(contenido, ',', 2), E'\n', '')) % 4 = 0
  AND replace(split_part(contenido, ',', 2), E'\n', '') ~* '^[a-z0-9+/]+={0,2}$';

-- 2) La huella ahora sale del hash cuando existe. Se suelta el índice único
--    mientras se recalcula, porque al cambiar la fórmula dos filas distintas
--    pueden resultar idénticas (el mismo audio con dos data-URI que sólo
--    difieren en el MIME escrito en el texto).
DROP INDEX IF EXISTS respuestas_rapidas_tipo_huella_unica_idx;

CREATE OR REPLACE FUNCTION public.calcular_huella_respuesta_rapida()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.huella := md5(NEW.tipo || chr(31) || COALESCE(NEW.hash_bytes, NEW.contenido));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS respuestas_rapidas_calcular_huella ON public.respuestas_rapidas;

CREATE TRIGGER respuestas_rapidas_calcular_huella
  BEFORE INSERT OR UPDATE OF tipo, contenido ON public.respuestas_rapidas
  FOR EACH ROW
  EXECUTE FUNCTION public.calcular_huella_respuesta_rapida();

UPDATE public.respuestas_rapidas
SET huella = md5(tipo || chr(31) || COALESCE(hash_bytes, contenido));

-- 3) Una sola fila por archivo/texto, conservando la más antigua (la que ya
--    puede estar referenciada en mensajes enviados).
WITH repetidas AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY tipo, huella
      ORDER BY creado_en ASC, id ASC
    ) AS posicion
  FROM public.respuestas_rapidas
)
DELETE FROM public.respuestas_rapidas AS respuesta
USING repetidas
WHERE respuesta.id = repetidas.id
  AND repetidas.posicion > 1;

CREATE UNIQUE INDEX IF NOT EXISTS respuestas_rapidas_tipo_huella_unica_idx
  ON public.respuestas_rapidas (tipo, huella);

COMMENT ON COLUMN public.respuestas_rapidas.hash_bytes IS
  'MD5 (hex) de los bytes del audio o de la imagen. Es la huella real del archivo: permite deduplicar aunque contenido ya sea una URL de Storage.';

COMMENT ON COLUMN public.respuestas_rapidas.contenido IS
  'Texto plano, o URL pública de Supabase Storage (bucket media-mensajes, carpeta respuestas-rapidas/). Se admite un data-URI como plan B cuando la subida a Storage falló; /api/admin/migrar-respuestas-rapidas-storage los pasa a Storage.';

COMMENT ON TABLE public.respuestas_rapidas IS
  'Textos, audios e imágenes de respuesta rápida compartidos por todos los operadores. Los binarios viven en Supabase Storage y acá sólo queda su URL + la huella MD5 del archivo.';


-- ############################################################################
-- [FIN] REALTIME — publicar TODAS las tablas que la app escucha
-- ############################################################################
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'mensajes', 'conversaciones', 'clientes',
    'pagos', 'tareas', 'respuestas_rapidas', 'cerebro_reglas'
  ] LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object THEN
      NULL; -- ya estaba publicada
    END;
  END LOOP;
END $$;

COMMIT;

-- ============================================================================
-- ✅ LISTO. Verificación rápida (opcional): en el SQL Editor corre
--    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1;
--    SELECT command FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
-- ============================================================================
