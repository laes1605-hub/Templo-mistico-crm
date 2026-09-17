#!/usr/bin/env node
/**
 * ============================================================
 * limpiar-backups-gdrive.mjs
 * ------------------------------------------------------------
 * Mantiene en Google Drive solo los respaldos de los ÚLTIMOS
 * 2 DÍAS (hoy y ayer) y borra los anteriores para no llenar
 * el espacio de tu cuenta de Google.
 *
 * - CERO dependencias: solo Node 18 o superior.
 * - Usa una "cuenta de servicio" de Google (un archivo .json
 *   de clave). NUNCA inicia sesión en tu cuenta personal.
 * - La fecha se lee del NOMBRE del archivo. Formatos que
 *   reconoce: 2026-09-17, 17-09-2026, 17/09/2026, 20260917,
 *   17-09-26 y sellos de tiempo largos (20260917120000).
 * - SEGURIDAD:
 *     · Si no logra leer la fecha de un archivo, NUNCA lo borra.
 *     · Nunca borra archivos con fecha en el futuro.
 *     · Si al borrar quedarían menos de MIN_FILES_AFTER
 *       archivos en la carpeta, ABORTA sin borrar nada.
 *
 * USO:
 *   node limpiar-backups-gdrive.mjs            → ENSAYO: muestra
 *                                                qué borraría, sin borrar nada.
 *   node limpiar-backups-gdrive.mjs --apply    → BORRA de verdad.
 *
 * VARIABLES DE ENTORNO (opcionales):
 *   GOOGLE_SA_KEY      Ruta al .json de la cuenta de servicio
 *                      (por defecto: google-service-account.json
 *                      junto a este script).
 *   BACKUP_FOLDER_ID   ID de la carpeta de Drive donde están los
 *                      respaldos (por defecto: raíz del Drive).
 *                      El ID es lo que va después de /folders/
 *                      en la URL de la carpeta.
 *   KEEP_DAYS          Cuántos días conservar (por defecto 2,
 *                      es decir: hoy + ayer).
 *   MIN_FILES_AFTER    Malla de seguridad: nunca dejar menos de
 *                      esta cantidad de archivos (por defecto 2).
 *
 * Códigos de salida:
 *   0 = ok · 1 = error de configuración/red · 2 = malla de
 *   seguridad (abortó sin borrar) · 3 = borró con algunos errores.
 * ============================================================
 */

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const DRY_RUN = !APPLY;

const KEY_FILE = process.env.GOOGLE_SA_KEY
  ? path.resolve(process.env.GOOGLE_SA_KEY)
  : path.join(__dirname, 'google-service-account.json');
const FOLDER_ID = (process.env.BACKUP_FOLDER_ID || '').trim();
const KEEP_DAYS = Math.max(1, parseInt(process.env.KEEP_DAYS || '2', 10) || 2);
const MIN_FILES_AFTER = Math.max(0, parseInt(process.env.MIN_FILES_AFTER || '2', 10) || 2);
const SCOPE = 'https://www.googleapis.com/auth/drive';

/** Error de "salida normal con código": se convierte en process.exit(). */
class Salida extends Error {
  constructor(code, mensaje) {
    super(mensaje || `Salida ${code}`);
    this.code = code;
  }
}

// ------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------
function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function inicioDia(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fmtFecha(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmtMB(bytes) {
  const n = Number(bytes) || 0;
  return n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;
}

// ------------------------------------------------------------
// Leer la fecha del NOMBRE del archivo.
// Devuelve un Date (inicio de día) o null si no la entiende.
// ------------------------------------------------------------
function parseFechaDeNombre(nombre) {
  const n = String(nombre || '');
  const valida = (y, m, d) => {
    if (y < 2000 || y > 2100) return null;
    if (m < 1 || m > 12) return null;
    if (d < 1 || d > 31) return null;
    return new Date(y, m - 1, d);
  };

  // 1) Año completo al inicio: 2026-09-17 / 2026_09_17 / 2026.09.17
  let m = n.match(/(?<!\d)(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})(?!\d)/);
  if (m) return valida(+m[1], +m[2], +m[3]);

  // 2) Año completo al final: 17-09-2026 / 17_09_2026 / 17/09/2026
  m = n.match(/(?<!\d)(\d{1,2})[-_/](\d{1,2})[-_/](\d{4})(?!\d)/);
  if (m) return valida(+m[3], +m[2], +m[1]);

  // 3) Sello de tiempo largo (14-16 dígitos): 20260917120000
  //    → los primeros 8 dígitos son año-mes-día.
  m = n.match(/(?<!\d)(\d{4})(\d{2})(\d{2})(\d{6,})(?!\d)/);
  if (m) return valida(+m[1], +m[2], +m[3]);

  // 4) Compacto de 8 dígitos: 20260917
  m = n.match(/(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/);
  if (m) return valida(+m[1], +m[2], +m[3]);

  // 5) Año corto de 2 dígitos: 17-09-26 → 2026-09-17
  m = n.match(/(?<!\d)(\d{1,2})[-_/](\d{1,2})[-_/](\d{2})(?!\d)/);
  if (m) return valida(2000 + +m[3], +m[2], +m[1]);

  return null;
}

// ------------------------------------------------------------
// Clasificar archivos: conservar / borrar / omitir.
// ------------------------------------------------------------
function clasificarArchivos(files, { keepDays = KEEP_DAYS, hoy = new Date() } = {}) {
  const corte = inicioDia(hoy);
  corte.setDate(corte.getDate() - (keepDays - 1)); // 2 días → ayer
  const hoyDia = inicioDia(hoy);

  const resultado = { corte, hoyDia, conservar: [], borrar: [], omitir: [] };
  for (const f of files) {
    const fecha = parseFechaDeNombre(f.name);
    if (!fecha) {
      resultado.omitir.push({ file: f, motivo: 'no hay fecha legible en el nombre' });
      continue;
    }
    if (fecha > hoyDia) {
      resultado.omitir.push({ file: f, motivo: `fecha en el futuro (${fmtFecha(fecha)})` });
      continue;
    }
    if (fecha < corte) {
      resultado.borrar.push({ file: f, fecha });
    } else {
      resultado.conservar.push({ file: f, fecha });
    }
  }
  return resultado;
}

// ------------------------------------------------------------
// Autenticación con cuenta de servicio (JWT → token OAuth2)
// ------------------------------------------------------------
async function obtenerToken(sa) {
  const ahora = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: ahora,
    exp: ahora + 3600,
  };
  const firmaEntrada =
    base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(claims));
  // Firma como Buffer y se codifica a base64url una sola vez.
  const firma = createSign('RSA-SHA256').update(firmaEntrada).sign(sa.private_key);
  const jwt = firmaEntrada + '.' + base64url(firma);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(
      'No se pudo obtener el token de Google (revisa la clave .json y que el ' +
        'Drive API esté habilitado en el proyecto): ' + (await res.text())
    );
  }
  const data = await res.json();
  return data.access_token;
}

// ------------------------------------------------------------
// Listar los archivos (sin recursión) de la carpeta o raíz
// ------------------------------------------------------------
async function listarArchivos(token) {
  const archivos = [];
  let pageToken;
  do {
    const q = (FOLDER_ID ? `'${FOLDER_ID}' in parents` : '') + ' and trashed = false';
    const url =
      'https://www.googleapis.com/drive/v3/files?' +
      new URLSearchParams({
        q,
        fields: 'nextPageToken,files(id,name,size,modifiedTime)',
        pageSize: '1000',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      }).toString() +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(
        'Error al listar archivos en Drive (¿la carpeta está compartida con la cuenta de servicio?): ' +
          (await res.text())
      );
    }
    const data = await res.json();
    archivos.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return archivos;
}

// ------------------------------------------------------------
// Borrar un archivo (de forma permanente, no va a la papelera)
// ------------------------------------------------------------
async function borrarArchivo(token, file) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${file.id}?supportsAllDrives=true`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.ok) return { ok: true };
  if (res.status === 404) return { ok: true, yaNoExiste: true };
  throw new Error(`Fallo al borrar "${file.name}": HTTP ${res.status} ${await res.text()}`);
}

// ------------------------------------------------------------
// Programa principal
// ------------------------------------------------------------
async function main() {
  console.log('==========================================================');
  console.log(' Limpieza de respaldos en Google Drive (últimos 2 días)');
  console.log('==========================================================');
  console.log(` Modo: ${DRY_RUN ? 'ENSAYO (no borra nada)' : 'BORRAR DE VERDAD (--apply)'}`);
  console.log(` Clave: ${KEY_FILE}`);
  console.log(` Carpeta: ${FOLDER_ID ? 'ID ' + FOLDER_ID : 'raíz del Drive'}`);

  let sa;
  try {
    sa = JSON.parse(readFileSync(KEY_FILE, 'utf8'));
  } catch (e) {
    console.error('');
    console.error('No se encontró la clave de la cuenta de servicio.');
    console.error('Guarda el archivo .json que descargaste de Google Cloud como:');
    console.error(`  ${KEY_FILE}`);
    console.error('o pásalo por variable de entorno: GOOGLE_SA_KEY=/ruta/a/clave.json');
    console.error('');
    console.error('Los pasos están en BACKUPS-GOOGLE.md de este repositorio.');
    throw new Salida(1, 'falta la clave');
  }
  if (!sa.private_key || !sa.client_email) {
    console.error('El .json no parece una clave de cuenta de servicio de Google (falta private_key).');
    throw new Salida(1, 'clave inválida');
  }

  const token = await obtenerToken(sa);
  const files = await listarArchivos(token);

  if (files.length === 0) {
    console.log(' No hay archivos en la carpeta. Nada que hacer.');
    return;
  }

  const { corte, conservar, borrar, omitir } = clasificarArchivos(files);

  console.log('');
  console.log(` Corte: conservar respaldos del ${fmtFecha(corte)} (ayer) en adelante.`);
  console.log(` Archivos encontrados: ${files.length}\n`);

  for (const { file, fecha } of conservar) {
    console.log(`   [MANTENER] ${file.name}  (fecha ${fmtFecha(fecha)}, ${fmtMB(file.size)})`);
  }
  for (const { file, motivo } of omitir) {
    console.log(`   [OMITIR]   ${file.name}  → no se toca: ${motivo}`);
  }
  for (const { file, fecha } of borrar) {
    const etiqueta = DRY_RUN ? 'SE BORRARÍA' : 'SE BORRA';
    console.log(`   [${etiqueta}] ${file.name}  (fecha ${fmtFecha(fecha)}, ${fmtMB(file.size)})`);
  }

  console.log('');
  if (borrar.length === 0) {
    console.log(' Ya está todo en orden: no hay respaldos por borrar.');
    return;
  }

  // Malla de seguridad: no dejar la carpeta casi vacía.
  const restantes = files.length - borrar.length;
  if (restantes < MIN_FILES_AFTER) {
    console.error('');
    console.error('MALLA DE SEGURIDAD: al borrar estos archivos quedarían solo');
    console.error(` ${restantes} en la carpeta (mínimo permitido: ${MIN_FILES_AFTER}).`);
    console.error(' No se borró NADA. Revisa el listado anterior: es posible que');
    console.error(' la fecha de los archivos no sea legible o que falten respaldos.');
    throw new Salida(2, 'malla de seguridad');
  }

  const librarBytes = borrar.reduce((acc, { file }) => acc + (Number(file.size) || 0), 0);

  if (DRY_RUN) {
    console.log(` Ensayo: se BORRARÍAN ${borrar.length} archivos y se liberarían ${fmtMB(librarBytes)}.`);
    console.log('');
    console.log(' Si todo se ve correcto, ejecuta de verdad con:');
    console.log('   node limpiar-backups-gdrive.mjs --apply');
    console.log('');
    console.log(' Y para que se haga solo cada día, agrega a "crontab -e" (ejemplo,');
    console.log(' 15 minutos después de que se genere el respaldo):');
    console.log('   15 4 * * * cd /ruta/donde/esta/este/script && node limpiar-backups-gdrive.mjs --apply >> /var/log/limpiar-backups-gdrive.log 2>&1');
    return;
  }

  let borrados = 0;
  let errores = 0;
  for (const { file } of borrar) {
    try {
      const r = await borrarArchivo(token, file);
      if (r.ok) {
        borrados++;
        console.log(`   ✔ Borrado: ${file.name}${r.yaNoExiste ? ' (ya no existía)' : ''}`);
      }
    } catch (e) {
      errores++;
      console.error(`   ✘ Error: ${e.message}`);
    }
  }
  console.log('');
  console.log(` Terminó: ${borrados} borrados, ${errores} errores, ${conservar.length + omitir.length} conservados.`);
  console.log(` Espacio liberado estimado: ${fmtMB(librarBytes)}`);
  if (errores > 0) throw new Salida(3, 'errores al borrar');
}

// Solo corre el programa cuando se ejecuta directamente
// (node scripts/limpiar-backups-gdrive.mjs), no cuando se importa.
const esDirecto =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (esDirecto) {
  main().catch((e) => {
    try {
      if (e instanceof Salida) {
        process.exit(e.code);
        return;
      }
      console.error('');
      console.error('Error inesperado:', e.message || e);
      process.exit(1);
    } catch (_) {
      // En pruebas, process.exit puede estar interceptado y lanzar.
    }
  });
}

// Exportado para pruebas (scripts/prueba-limpiar-backups-gdrive.mjs).
export { parseFechaDeNombre, clasificarArchivos, obtenerToken, Salida, main };
