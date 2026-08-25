/**
 * Prueba real de la migración supabase/migrations/20260905_eliminar_cliente_total.sql
 * Levanta un PostgreSQL de verdad (embedded-postgres), crea un esquema igual al
 * del CRM, aplica las dos migraciones y verifica que eliminar_cliente_completo()
 * borre TODO el cliente y sólo ese cliente.
 *
 * Se corre con: npm run test:eliminar:sql
 * Necesita (sólo para esta prueba, no se usan en la app):
 *   npm i -D embedded-postgres @embedded-postgres/linux-x64 pg
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-pg-"));

let EmbeddedPostgres, pg;
try {
  EmbeddedPostgres = (await import("embedded-postgres")).default;
  pg = (await import("pg")).default;
} catch {
  console.error(
    "Faltan las dependencias de esta prueba. Instálalas con:\n" +
    "  npm i -D embedded-postgres @embedded-postgres/linux-x64 pg"
  );
  process.exit(1);
}
fs.rmSync(dataDir, { recursive: true, force: true });

const servidor = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port: 55432,
  persistent: false,
});

let fallos = 0;
function ok(condicion, mensaje) {
  if (condicion) console.log("  ✅ " + mensaje);
  else { fallos += 1; console.log("  ❌ " + mensaje); }
}

const ESQUEMA = `
-- Roles que existen en Supabase y que usan los GRANT de las migraciones.
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;
create extension if not exists pgcrypto;
create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  telefono text, telefono_display text, nombre text, nombre_manual text,
  estado text, grupo text, es_spam boolean default false,
  notas_personales text, detalles_caso text,
  motivo_consulta text, motivo_categoria text, luna_etapa text,
  tipo_trabajo text, nombre_otra_persona text,
  foto_otra_persona boolean, foto_mano boolean,
  creado_en timestamptz default now(), actualizado_en timestamptz default now()
);
create table public.conversaciones (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clientes(id) on delete cascade,
  chatwoot_conversation_id text, numero_whatsapp text, fuente text,
  archivada boolean default false, ultimo_mensaje text,
  ultimo_mensaje_en timestamptz, actualizado_en timestamptz default now()
);
create table public.mensajes (
  id uuid primary key default gen_random_uuid(),
  conversacion_id uuid references public.conversaciones(id) on delete cascade,
  chatwoot_message_id text, tipo text, contenido text, tipo_contenido text,
  url_archivo text, creado_en timestamptz default now()
);
create table public.pagos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clientes(id) on delete cascade,
  monto numeric(12,2), creado_en timestamptz default now()
);
create table public.tareas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clientes(id) on delete cascade,
  titulo text, creado_en timestamptz default now()
);
create table public.recordatorios_whatsapp (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clientes(id) on delete cascade,
  etapa text, tipo text, plantilla text, enviado_en timestamptz default now()
);
create table public.cerebro_reglas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clientes(id) on delete set null,
  conversacion_id uuid references public.conversaciones(id) on delete set null,
  regla text, creado_en timestamptz default now()
);
-- Tabla inventada "del futuro" (no la conoce ninguna lista fija de tablas):
create table public.seguimientos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clientes(id) on delete cascade,
  nota text
);
-- Tabla que cuelga de la conversación y no del cliente:
create table public.notas_internas (
  id uuid primary key default gen_random_uuid(),
  conversacion_id uuid references public.conversaciones(id) on delete cascade,
  texto text
);
-- Una vista: NO debe entrar en el barrido dinámico (rompería el DELETE).
create view public.v_clientes_activos as select * from public.clientes where es_spam = false;
create view public.v_conversaciones_activas as select * from public.conversaciones where archivada = false;
`;

async function main() {
  await servidor.initialise();
  await servidor.start();
  const cliente = new pg.Client({
    host: "127.0.0.1", port: 55432, user: "postgres", password: "postgres", database: "postgres",
  });
  await cliente.connect();

  await cliente.query(ESQUEMA);

  console.log("\n— Se aplican las migraciones del repo —");
  const vieja = fs.readFileSync(`${REPO}/supabase/migrations/20260904_eliminar_cliente_completo.sql`, "utf8");
  const nueva = fs.readFileSync(`${REPO}/supabase/migrations/20260905_eliminar_cliente_total.sql`, "utf8");
  await cliente.query(vieja);
  console.log("  ✅ 20260904_eliminar_cliente_completo.sql aplicada");
  await cliente.query(nueva);
  console.log("  ✅ 20260905_eliminar_cliente_total.sql aplicada (reemplaza la anterior)");

  // ------------------------------------------------------------- datos de prueba
  const { rows: [cliA] } = await cliente.query(
    `insert into public.clientes (telefono, telefono_display, nombre, estado, grupo, luna_etapa, motivo_consulta)
     values ('+573001112233','+57 300 1112233','Cliente A','datos','templo','datos','amarre de pareja')
     returning id`
  );
  const { rows: [cliB] } = await cliente.query(
    `insert into public.clientes (telefono, telefono_display, nombre, estado, grupo)
     values ('+573009998877','+57 300 9998877','Cliente B','nuevo_lead','templo') returning id`
  );

  const { rows: [conv1] } = await cliente.query(
    `insert into public.conversaciones (cliente_id, chatwoot_conversation_id, numero_whatsapp, fuente)
     values ($1,'101','+573001112233','meta_business') returning id`, [cliA.id]
  );
  const { rows: [conv2] } = await cliente.query(
    `insert into public.conversaciones (cliente_id, chatwoot_conversation_id, numero_whatsapp, fuente)
     values ($1,'102','+573001112233','evolution') returning id`, [cliA.id]
  );
  const { rows: [convB] } = await cliente.query(
    `insert into public.conversaciones (cliente_id, chatwoot_conversation_id, numero_whatsapp, fuente)
     values ($1,'201','+573009998877','meta_business') returning id`, [cliB.id]
  );

  await cliente.query(
    `insert into public.mensajes (conversacion_id, tipo, contenido) values
     ($1,'recibido','hola'),($1,'enviado','buenas'),($2,'recibido','necesito un amarre')`,
    [conv1.id, conv2.id]
  );
  await cliente.query(`insert into public.mensajes (conversacion_id, tipo, contenido) values ($1,'recibido','otro cliente')`, [convB.id]);
  await cliente.query(`insert into public.pagos (cliente_id, monto) values ($1, 350000)`, [cliA.id]);
  await cliente.query(`insert into public.pagos (cliente_id, monto) values ($1, 120000)`, [cliB.id]);
  await cliente.query(`insert into public.tareas (cliente_id, titulo) values ($1,'llamar')`, [cliA.id]);
  await cliente.query(`insert into public.recordatorios_whatsapp (cliente_id, etapa, tipo, plantilla) values ($1,'datos','etapa','hola')`, [cliA.id]);
  await cliente.query(
    `insert into public.cerebro_reglas (cliente_id, conversacion_id, regla) values ($1,$2,'regla 1'),($1,$2,'regla 2')`,
    [cliA.id, conv1.id]
  );
  await cliente.query(`insert into public.seguimientos (cliente_id, nota) values ($1,'seguimiento A')`, [cliA.id]);
  await cliente.query(`insert into public.notas_internas (conversacion_id, texto) values ($1,'ficha'),($1,'otra ficha')`, [conv1.id]);

  console.log("\n— Antes de eliminar —");
  const conteo = async (sql, params) => (await cliente.query(sql, params)).rows[0].total;
  ok(await conteo(`select count(*)::int total from public.clientes where id=$1`, [cliA.id]) === 1, "cliente A existe");

  // ------------------------------------------------------------- ELIMINAR
  console.log("\n— SELECT public.eliminar_cliente_completo(cliente A) —");
  const { rows: [res] } = await cliente.query(`select public.eliminar_cliente_completo($1) as r`, [cliA.id]);
  console.log("  →", JSON.stringify(res.r));

  const r = res.r;
  console.log("\n— Resumen devuelto por la función —");
  ok(r.cliente_eliminado === 1, "cliente_eliminado = 1");
  ok(r.conversaciones_eliminadas === 2, "conversaciones_eliminadas = 2 (personal + templo)");
  ok(r.mensajes_eliminados === 3, "mensajes_eliminados = 3");
  ok(r.pagos_eliminados === 1, "pagos_eliminados = 1");
  ok(r.tareas_eliminadas === 1, "tareas_eliminadas = 1");
  ok(r.recordatorios_eliminados === 1, "recordatorios_eliminados = 1");
  ok(r.reglas_cerebro_eliminadas === 2, "reglas_cerebro_eliminadas = 2");
  ok(r.otras_tablas?.seguimientos === 1, "barrido dinámico encontró la tabla nueva (seguimientos = 1)");
  ok(r.otras_tablas?.notas_internas === 2, "barrido dinámico limpió la tabla que cuelga de la conversación (notas_internas = 2)");

  console.log("\n— Estado de la base después de eliminar —");
  ok(await conteo(`select count(*)::int total from public.clientes where id=$1`, [cliA.id]) === 0, "no queda el cliente A");
  ok(await conteo(`select count(*)::int total from public.conversaciones where cliente_id=$1`, [cliA.id]) === 0, "no quedan conversaciones de A");
  ok(await conteo(`select count(*)::int total from public.mensajes where conversacion_id in ($1,$2)`, [conv1.id, conv2.id]) === 0, "no quedan mensajes de A");
  ok(await conteo(`select count(*)::int total from public.pagos where cliente_id=$1`, [cliA.id]) === 0, "no quedan pagos de A");
  ok(await conteo(`select count(*)::int total from public.tareas where cliente_id=$1`, [cliA.id]) === 0, "no quedan tareas de A");
  ok(await conteo(`select count(*)::int total from public.recordatorios_whatsapp where cliente_id=$1`, [cliA.id]) === 0, "no quedan recordatorios de A");
  ok(await conteo(`select count(*)::int total from public.cerebro_reglas where cliente_id=$1`, [cliA.id]) === 0, "no quedan reglas del Cerebro de A");
  ok(await conteo(`select count(*)::int total from public.seguimientos where cliente_id=$1`, [cliA.id]) === 0, "no quedan seguimientos de A");
  ok(await conteo(`select count(*)::int total from public.notas_internas where conversacion_id in ($1,$2)`, [conv1.id, conv2.id]) === 0, "no quedan notas internas de A");

  console.log("\n— El otro cliente no se toca —");
  ok(await conteo(`select count(*)::int total from public.clientes where id=$1`, [cliB.id]) === 1, "cliente B sigue existiendo");
  ok(await conteo(`select count(*)::int total from public.mensajes where conversacion_id=$1`, [convB.id]) === 1, "mensajes de B intactos");
  ok(await conteo(`select count(*)::int total from public.pagos where cliente_id=$1`, [cliB.id]) === 1, "pagos de B intactos");

  console.log("\n— El número queda libre para volver a entrar como lead nuevo —");
  const { rows: [nuevo] } = await cliente.query(
    `insert into public.clientes (telefono, telefono_display, nombre, estado) values ('+573001112233','+57 300 1112233','Cliente WhatsApp','nuevo_lead_templo') returning id, estado`
  );
  ok(Boolean(nuevo?.id) && nuevo.id !== cliA.id, "se puede crear un cliente nuevo con el mismo número");
  ok(nuevo.estado === "nuevo_lead_templo", "entra como lead nuevo (sin etapa previa)");

  console.log("\n— Casos borde —");
  await cliente.query("begin");
  let errorClienteInexistente = null;
  try {
    await cliente.query(`select public.eliminar_cliente_completo('00000000-0000-0000-0000-000000000000')`);
  } catch (e) { errorClienteInexistente = e.message; }
  ok(Boolean(errorClienteInexistente), "avisa si el cliente no existe: " + (errorClienteInexistente || "(sin error)"));
  await cliente.query("rollback");

  await cliente.query("begin");
  let errorNulo = null;
  try {
    await cliente.query(`select public.eliminar_cliente_completo(null)`);
  } catch (e) { errorNulo = e.message; }
  ok(Boolean(errorNulo), "rechaza un id vacío: " + (errorNulo || "(sin error)"));
  await cliente.query("rollback");

  // Idempotencia: borrar dos veces seguidas no explota si el cliente ya no está.
  const { rows: [res2] } = await cliente.query(`select public.eliminar_cliente_completo($1) as r`, [nuevo.id]);
  ok(res2.r.cliente_eliminado === 1, "se puede borrar el cliente recién creado");

  await cliente.end();
  await servidor.stop();

  console.log(fallos === 0 ? "\n🎉 TODAS LAS PRUEBAS PASARON" : `\n💥 ${fallos} PRUEBAS FALLARON`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("💥 Error en la prueba:", e);
  try { await servidor.stop(); } catch {}
  process.exit(1);
});
