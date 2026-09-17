#!/usr/bin/env node
/**
 * ============================================================
 * prueba-limpiar-backups-gdrive.mjs
 * ------------------------------------------------------------
 * Pruebas del script scripts/limpiar-backups-gdrive.mjs SIN
 * tocar Google de verdad:
 *
 *   1. Parser de fechas del nombre del archivo.
 *   2. Clasificación (mantener / borrar / omitir).
 *   3. JWT de la cuenta de servicio (firma verificable).
 *   4. Flujo completo de main() con la API de Drive simulada:
 *      ensayo, borrado real, malla de seguridad y clave faltante.
 *
 * Ejecutar:  node scripts/prueba-limpiar-backups-gdrive.mjs
 * (o)        npm run test:backups
 * ============================================================
 */

import { generateKeyPairSync, createVerify } from 'node:crypto';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_URL = new URL('./limpiar-backups-gdrive.mjs', import.meta.url);

let fallos = 0;
function chequeo(nombre, fn) {
  try {
    fn();
    console.log('  ✔ ' + nombre);
  } catch (e) {
    fallos++;
    console.error('  ✘ ' + nombre + ' → ' + (e.message || e));
  }
}

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = {
  client_email: 'backup-cleaner@test-proyecto.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
};
const SA_DIR = mkdtempSync(tmpdir() + '/backuptest-');
const SA_FILE = path.join(SA_DIR, 'sa.json');
writeFileSync(SA_FILE, JSON.stringify(SA));

// Hoy fijo para las pruebas: 2026-09-17 03:00
const HOY = [2026, 8, 17, 3, 0, 0];

// ----------------------------------------------------------
// 1) Parser de fechas
// ----------------------------------------------------------
const { parseFechaDeNombre, clasificarArchivos, obtenerToken } = await import(
  './limpiar-backups-gdrive.mjs'
);
const fmt = (d) => (d ? d.toISOString().slice(0, 10) : null);

console.log('\n1) Parser de fechas del nombre:');
const casos = [
  ['backup-2026-09-17.sql', '2026-09-17'],
  ['CRM_2026-09-15.zip', '2026-09-15'],
  ['respaldo.2026.09.17.sql.gz', '2026-09-17'],
  ['backup-17-09-2026.sql', '2026-09-17'],
  ['respaldo_17_09_2026.zip', '2026-09-17'],
  ['backup-17/09/2026.sql', '2026-09-17'],
  ['backup20260917.zip', '2026-09-17'],
  ['CRM_20260917_040000.sql', '2026-09-17'],
  ['backup_20260917120000.zip', '2026-09-17'],
  ['respaldo-17-09-26.zip', '2026-09-17'],
  ['backup-09-17-26.sql', null], // mes 17 inválido → se omite
  ['backup.sql', null],
  ['respaldo-final.sql', null],
  ['clientes-573001234567.csv', null], // teléfono → no es fecha
  ['backup-2026-13-45.sql', null], // mes 13 inválido
  ['nota.txt', null],
];
for (const [nombre, esperada] of casos) {
  chequeo(`"${nombre}" → ${esperada}`, () => {
    assert.strictEqual(fmt(parseFechaDeNombre(nombre)), esperada);
  });
}

// ----------------------------------------------------------
// 2) Clasificación
// ----------------------------------------------------------
console.log('\n2) Clasificación (hoy = 2026-09-17, conservar 2 días):');
const r = clasificarArchivos(
  [
    { id: 'a', name: 'backup-2026-09-17.sql', size: 5 * 1024 * 1024 }, // hoy
    { id: 'b', name: 'backup-2026-09-16.sql', size: 5 * 1024 * 1024 }, // ayer
    { id: 'c', name: 'backup-2026-09-15.sql', size: 5 * 1024 * 1024 }, // antier → borrar
    { id: 'd', name: 'backup-2026-09-01.sql', size: 5 * 1024 * 1024 }, // viejo → borrar
    { id: 'e', name: 'backup.sql', size: 1024 }, // sin fecha → omitir
    { id: 'f', name: 'backup-2026-10-01.sql', size: 1024 }, // futuro → omitir
  ],
  { keepDays: 2, hoy: new Date(...HOY) }
);
chequeo('corte = 2026-09-16 (ayer)', () => {
  assert.strictEqual(r.corte.toISOString().slice(0, 10), '2026-09-16');
});
chequeo('mantener: hoy + ayer', () => {
  assert.deepStrictEqual(
    r.conservar.map((x) => x.file.name),
    ['backup-2026-09-17.sql', 'backup-2026-09-16.sql']
  );
});
chequeo('borrar: antier y más viejos', () => {
  assert.deepStrictEqual(
    r.borrar.map((x) => x.file.name),
    ['backup-2026-09-15.sql', 'backup-2026-09-01.sql']
  );
});
chequeo('omitir: sin fecha y fecha futura', () => {
  assert.deepStrictEqual(
    r.omitir.map((x) => x.file.name),
    ['backup.sql', 'backup-2026-10-01.sql']
  );
});

// ----------------------------------------------------------
// 3) JWT de la cuenta de servicio
// ----------------------------------------------------------
console.log('\n3) JWT de cuenta de servicio:');
{
  const realFetch = globalThis.fetch;
  let assertionVista = null;
  globalThis.fetch = async (url, opts = {}) => {
    assert.ok(String(url).includes('oauth2.googleapis.com/token'));
    assertionVista = new URLSearchParams(opts.body).get('assertion');
    return { ok: true, status: 200, json: async () => ({ access_token: 'TOKEN-FAKE' }) };
  };
  let token;
  try {
    token = await obtenerToken(SA);
  } finally {
    globalThis.fetch = realFetch;
  }
  chequeo('obtiene el access token', () => assert.strictEqual(token, 'TOKEN-FAKE'));
  chequeo('JWT con claims correctos y firma RSA válida', () => {
    const [h, c, s] = assertionVista.split('.');
    const claims = JSON.parse(
      Buffer.from(c.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
    );
    assert.strictEqual(claims.iss, SA.client_email);
    assert.strictEqual(claims.aud, 'https://oauth2.googleapis.com/token');
    assert.ok(claims.scope.includes('/auth/drive'));
    assert.ok(claims.exp > claims.iat);
    const sigB64 = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((4 - (s.length % 4)) % 4);
    const okFirma = createVerify('RSA-SHA256')
      .update(h + '.' + c)
      .verify(publicKey, sigB64, 'base64');
    assert.ok(okFirma, 'la firma debe verificar contra la clave pública');
  });
}

// ----------------------------------------------------------
// 4) Flujo completo de main() con Drive simulado
// ----------------------------------------------------------
console.log('\n4) Flujo completo (API de Drive simulada):');

function mockDrive(filesIniciales) {
  const estado = {
    archivos: filesIniciales.map(([id, name, size]) => ({ id, name, size })),
    borrados: [],
  };
  const fetchFake = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    if (u.includes('oauth2.googleapis.com/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'TOKEN-FAKE' }) };
    }
    if (u.includes('drive/v3/files?')) {
      assert.strictEqual(opts.headers?.Authorization, 'Bearer TOKEN-FAKE');
      return { ok: true, status: 200, json: async () => ({ files: [...estado.archivos] }) };
    }
    const m = u.match(/drive\/v3\/files\/([^?]+)/);
    if (m && method === 'DELETE') {
      const idx = estado.archivos.findIndex((f) => f.id === m[1]);
      if (idx === -1) return { ok: false, status: 404, text: async () => 'no existe' };
      const [quit] = estado.archivos.splice(idx, 1);
      estado.borrados.push(quit.name);
      return { ok: true, status: 204, text: async () => '' };
    }
    throw new Error('URL inesperada: ' + u);
  };
  return { estado, fetchFake };
}

/**
 * Ejecuta el main() REAL del script en este proceso, con fetch, Date,
 * argv y env controlados (reimportando el módulo con caché limpia para
 * que lea los nuevos valores). Devuelve { capt, estado, codigoSalida }.
 */
async function ejecutarScript({ archivos, apply = false, minFilesAfter, claveFaltante = false }) {
  const { estado, fetchFake } = mockDrive(archivos);
  const lineas = [];
  const realFetch = globalThis.fetch;
  const RealDate = globalThis.Date;
  const realArgv = process.argv;
  const realEnvKey = process.env.GOOGLE_SA_KEY;
  const realEnvMin = process.env.MIN_FILES_AFTER;
  const realEnvFolder = process.env.BACKUP_FOLDER_ID;

  let codigoSalida = null;

  try {
    console.log = (...a) => lineas.push(a.join(' '));
    console.error = (...a) => lineas.push(a.join(' '));

    // Date congelado en 2026-09-17 03:00 (solo cuando no hay argumentos)
    globalThis.Date = class extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(...HOY);
        else super(...args);
      }
    };
    globalThis.fetch = fetchFake;
    process.env.GOOGLE_SA_KEY = claveFaltante ? '/no/existe/clave.json' : SA_FILE;
    if (minFilesAfter !== undefined) process.env.MIN_FILES_AFTER = String(minFilesAfter);
    delete process.env.BACKUP_FOLDER_ID;

    // El módulo lee process.argv al importar, así que se fija antes.
    process.argv = ['node', 'limpiar-backups-gdrive.mjs', ...(apply ? ['--apply'] : [])];

    // Reimportar con caché limpia para que relea argv/env.
    const t = Math.random().toString(36).slice(2);
    const mod = await import(SCRIPT_URL.href + '?t=' + t);

    try {
      await mod.main();
    } catch (e) {
      if (e instanceof mod.Salida) codigoSalida = e.code;
      else throw e;
    }
  } finally {
    console.log = (...a) => process.stdout.write(a.join(' ') + '\n');
    console.error = (...a) => process.stderr.write(a.join(' ') + '\n');
    globalThis.fetch = realFetch;
    globalThis.Date = RealDate;
    process.argv = realArgv;
    if (realEnvKey !== undefined) process.env.GOOGLE_SA_KEY = realEnvKey;
    else delete process.env.GOOGLE_SA_KEY;
    if (realEnvMin !== undefined) process.env.MIN_FILES_AFTER = realEnvMin;
    else delete process.env.MIN_FILES_AFTER;
    if (realEnvFolder !== undefined) process.env.BACKUP_FOLDER_ID = realEnvFolder;
    else delete process.env.BACKUP_FOLDER_ID;
  }

  return { capt: { texto: () => lineas.join('\n') }, estado, codigoSalida };
}

// 4a) ENSAYO: muestra qué borraría pero no borra
{
  const res = await ejecutarScript({
    archivos: [
      ['a', 'backup-2026-09-17.sql', 5 * 1024 * 1024],
      ['b', 'backup-2026-09-16.sql', 5 * 1024 * 1024],
      ['c', 'backup-2026-09-15.sql', 5 * 1024 * 1024],
      ['d', 'backup-2026-08-20.sql', 5 * 1024 * 1024],
      ['e', 'backup.sql', 1024],
    ],
  });
  chequeo('ensayo: no borró nada', () => assert.deepStrictEqual(res.estado.borrados, []));
  chequeo('ensayo: lista los 2 viejos como "SE BORRARÍA"', () => {
    const t = res.capt.texto();
    assert.ok(t.includes('SE BORRARÍA'), 'debe mostrar SE BORRARÍA');
    assert.ok(t.includes('backup-2026-09-15.sql') && t.includes('backup-2026-08-20.sql'));
    assert.ok(t.includes('ENSAYO'), 'debe indicar que está en modo ensayo');
  });
  chequeo('ensayo: omite el archivo sin fecha', () => {
    assert.ok(res.capt.texto().includes('[OMITIR]'));
  });
  chequeo('ensayo: sugiere --apply y la línea de crontab', () => {
    const t = res.capt.texto();
    assert.ok(t.includes('--apply'));
    assert.ok(t.includes('crontab'));
  });
}

// 4b) --apply: borra solo los viejos
{
  const res = await ejecutarScript({
    archivos: [
      ['a', 'backup-2026-09-17.sql', 5 * 1024 * 1024],
      ['b', 'backup-2026-09-16.sql', 5 * 1024 * 1024],
      ['c', 'backup-2026-09-15.sql', 5 * 1024 * 1024],
      ['d', 'backup-2026-08-20.sql', 5 * 1024 * 1024],
      ['e', 'backup.sql', 1024],
    ],
    apply: true,
  });
  chequeo('apply: borró exactamente los 2 viejos', () => {
    assert.deepStrictEqual(
      res.estado.borrados.sort(),
      ['backup-2026-08-20.sql', 'backup-2026-09-15.sql']
    );
  });
  chequeo('apply: quedaron hoy + ayer + el sin fecha', () => {
    assert.deepStrictEqual(
      res.estado.archivos.map((f) => f.name).sort(),
      ['backup-2026-09-16.sql', 'backup-2026-09-17.sql', 'backup.sql']
    );
  });
  chequeo('apply: resume espacio liberado y 0 errores', () => {
    const t = res.capt.texto();
    assert.ok(t.includes('0 errores'), 'debe decir 0 errores');
    assert.ok(/Espacio liberado/.test(t));
  });
}

// 4c) Malla de seguridad: si quedaría 1 solo archivo, aborta (exit 2)
{
  const res = await ejecutarScript({
    archivos: [
      ['a', 'backup-2026-09-17.sql', 5 * 1024 * 1024], // único reciente
      ['b', 'backup-2026-09-10.sql', 5 * 1024 * 1024],
      ['c', 'backup-2026-09-05.sql', 5 * 1024 * 1024],
    ],
    apply: true,
  });
  chequeo('malla: abortó sin borrar nada (exit 2)', () => {
    assert.strictEqual(res.codigoSalida, 2);
    assert.deepStrictEqual(res.estado.borrados, []);
    assert.ok(res.capt.texto().includes('MALLA DE SEGURIDAD'));
  });
}

// 4d) Malla con MIN_FILES_AFTER=1: en ese caso sí borra
{
  const res = await ejecutarScript({
    archivos: [
      ['a', 'backup-2026-09-17.sql', 5 * 1024 * 1024],
      ['b', 'backup-2026-09-10.sql', 5 * 1024 * 1024],
      ['c', 'backup-2026-09-05.sql', 5 * 1024 * 1024],
    ],
    apply: true,
    minFilesAfter: 1,
  });
  chequeo('malla con MIN_FILES_AFTER=1: borra los 2 viejos', () => {
    assert.deepStrictEqual(
      res.estado.borrados.sort(),
      ['backup-2026-09-05.sql', 'backup-2026-09-10.sql']
    );
  });
}

// 4e) Nada que borrar
{
  const res = await ejecutarScript({
    archivos: [
      ['a', 'backup-2026-09-17.sql', 5 * 1024 * 1024],
      ['b', 'backup-2026-09-16.sql', 5 * 1024 * 1024],
    ],
    apply: true,
  });
  chequeo('solo respaldos recientes: "todo en orden"', () => {
    assert.deepStrictEqual(res.estado.borrados, []);
    assert.ok(res.capt.texto().includes('todo en orden'));
  });
}

// 4f) Clave faltante: mensaje amigable y exit 1
{
  const res = await ejecutarScript({ archivos: [], claveFaltante: true });
  chequeo('clave faltante: mensaje amigable y exit 1', () => {
    assert.strictEqual(res.codigoSalida, 1);
    const t = res.capt.texto();
    assert.ok(t.includes('No se encontró la clave'));
    assert.ok(t.includes('GOOGLE_SA_KEY'));
  });
}

// ----------------------------------------------------------
// 5) Resumen
// ----------------------------------------------------------
rmSync(SA_DIR, { recursive: true, force: true });
console.log('');
if (fallos === 0) {
  console.log('TODO OK ✔ — parser, JWT, ensayo, borrado y malla de seguridad verificados.');
  process.exit(0);
} else {
  console.error('HAY FALLOS: ' + fallos);
  process.exit(1);
}
