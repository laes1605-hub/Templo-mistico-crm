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
