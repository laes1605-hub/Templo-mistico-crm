#!/usr/bin/env node
/**
 * Guardia contra el bug de los triggers borrados.
 *
 * El 19–20/09/2026 la migración `fix_migraciones_duplicadas_idempotentes` hacía
 * DROP TRIGGER de seis triggers (huella de respuestas rápidas, ventana de 24 h,
 * no leídos, enrutado por número, atendido) y no los volvía a crear. Con la
 * columna `respuestas_rapidas.huella` en NOT NULL, TODA inserción fallaba:
 *   «null value in column "huella" of relation "respuestas_rapidas"
 *    violates not-null constraint»
 *
 * Esta prueba revisa, sobre los .sql del repo, que ningún archivo deje un
 * trigger protegido borrado sin recrearlo. Se corre con:
 *   npm run test:sql-triggers
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR_MIGRACIONES = path.join(raiz, "supabase", "migrations");

const PROTEGIDOS = [
  { trigger: "respuestas_rapidas_calcular_huella", tabla: "respuestas_rapidas", funcion: "calcular_huella_respuesta_rapida" },
  { trigger: "trg_actualizar_ultimo_entrante", tabla: "mensajes", funcion: "actualizar_ultimo_entrante" },
  { trigger: "trg_incrementar_no_leidos_entrante", tabla: "mensajes", funcion: "incrementar_no_leidos_entrante" },
  { trigger: "clientes_enrutar_por_numero", tabla: "clientes", funcion: "clientes_enrutar_por_numero_trg" },
  { trigger: "conversaciones_enrutar_cliente", tabla: "conversaciones", funcion: "conversaciones_enrutar_cliente_trg" },
  { trigger: "trg_clientes_atendido", tabla: "clientes", funcion: "marcar_atendido" },
];

let ok = 0;
const fallos = [];
const check = (titulo, condicion, detalle = "") => {
  if (condicion) {
    ok += 1;
    console.log("  ✓ " + titulo);
  } else {
    fallos.push(titulo + (detalle ? " — " + detalle : ""));
    console.log("  ✗ " + titulo + (detalle ? " — " + detalle : ""));
  }
};

const archivos = [
  ...fs
    .readdirSync(DIR_MIGRACIONES)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(DIR_MIGRACIONES, f)),
  path.join(raiz, "MIGRAR-A-NUEVO-SUPABASE.sql"),
];

// Los comentarios hablan de los DROP TRIGGER: se quitan antes de revisar, para
// que las pruebas miren sólo el SQL que se ejecuta.
const soloCodigo = (sql) => sql.replace(/--[^\n]*/g, "");

const archivosConDropSinCreate = [];

console.log("\n1) Ningún .sql deja un trigger protegido borrado sin recrear");
for (const archivo of archivos) {
  if (!fs.existsSync(archivo)) continue;
  const sql = soloCodigo(fs.readFileSync(archivo, "utf8"));
  const nombre = path.basename(archivo);
  for (const { trigger } of PROTEGIDOS) {
    const borraDirecto = new RegExp(`DROP\\s+TRIGGER\\s+(IF\\s+EXISTS\\s+)?${trigger}\\b`, "i").test(sql);
    // Borrado dinámico: EXECUTE format('DROP TRIGGER ...', tgname) dentro de un
    // bucle `tgname IN (...)`. Ahí el nombre no aparece pegado al DROP.
    const borraDinamico = new RegExp(`DROP TRIGGER[^']*%I`, "i").test(sql) && sql.includes(`'${trigger}'`);
    const recrea = new RegExp(`CREATE\\s+TRIGGER\\s+${trigger}\\b`, "i").test(sql);
    if ((borraDirecto || borraDinamico) && !recrea) {
      archivosConDropSinCreate.push(`${nombre} → ${trigger}`);
    }
  }
}
check(
  "Todos los borrados tienen su CREATE TRIGGER en el mismo archivo",
  archivosConDropSinCreate.length === 0,
  archivosConDropSinCreate.join(", ")
);

console.log("\n2) La migración de «duplicados» ya no borra triggers");
const fix = soloCodigo(
  fs.readFileSync(
    path.join(DIR_MIGRACIONES, "20260920000001_fix_migraciones_duplicadas_idempotentes.sql"),
    "utf8"
  )
);
check(
  "No quedó ningún DROP TRIGGER (ni directo ni dinámico)",
  !/DROP\s+TRIGGER/i.test(fix) && !/EXECUTE\s+format\(\s*'DROP TRIGGER/i.test(fix)
);
check(
  "Explica por qué no se borran",
  /NO SE BORRA NADA/i.test(
    fs.readFileSync(
      path.join(DIR_MIGRACIONES, "20260920000001_fix_migraciones_duplicadas_idempotentes.sql"),
      "utf8"
    )
  )
);

console.log("\n3) La migración de restauración repone los seis triggers");
const restauracion = soloCodigo(
  fs.readFileSync(
    path.join(DIR_MIGRACIONES, "20260922000001_restaurar_triggers_perdidos.sql"),
    "utf8"
  )
);
for (const { trigger, tabla, funcion } of PROTEGIDOS) {
  const creacion = new RegExp(
    `CREATE TRIGGER ${trigger}\\s+[\\s\\S]{0,200}?ON public\\.${tabla}[\\s\\S]{0,200}?${funcion}\\(\\)`,
    "i"
  );
  check(`${trigger} → ${tabla} · ${funcion}()`, creacion.test(restauracion));
  check(
    `${trigger} se recrea con DROP IF EXISTS previo (idempotente)`,
    new RegExp(`DROP TRIGGER IF EXISTS ${trigger}\\b`, "i").test(restauracion)
  );
}
check("Reaparece la función de la huella con hash_bytes", /COALESCE\(NEW\.hash_bytes, NEW\.contenido\)/.test(restauracion));
check("Recalcula las marcas viejas", /recalcular_ultimos_entrantes\(\)/.test(restauracion) && /sincronizar_no_leidos\(\)/.test(restauracion));
check("No crea triggers sin comprobar que la función existe", (restauracion.match(/to_regprocedure\(/g) || []).length >= 5);

console.log("\n4) El paquete MIGRAR-A-NUEVO-SUPABASE.sql trae la restauración al final");
const bundle = fs.readFileSync(path.join(raiz, "MIGRAR-A-NUEVO-SUPABASE.sql"), "utf8");
check("Incluye el bloque de restauración", /RESTAURAR TRIGGERS/.test(bundle));
check("Incluye la fecha de entrada a la etapa", /FECHA DE ENTRADA A LA ETAPA/.test(bundle));
check(
  "El bloque incluido crea los seis triggers",
  PROTEGIDOS.every(({ trigger }) => new RegExp(`CREATE TRIGGER ${trigger}\\b`, "i").test(soloCodigo(bundle)))
);
check(
  "El bloque de restauración va después de las tablas",
  bundle.indexOf("RESTAURAR TRIGGERS") > bundle.indexOf("respuestas_rapidas")
);

console.log("\n" + "─".repeat(60));
if (fallos.length) {
  console.log(`❌ ${fallos.length} prueba(s) fallaron · ${ok} OK`);
  for (const f of fallos) console.log("   · " + f);
  process.exit(1);
}
console.log(`✅ ${ok} pruebas OK — triggers de las migraciones`);
