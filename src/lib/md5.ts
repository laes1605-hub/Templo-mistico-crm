/**
 * MD5 en JavaScript puro (sin dependencias ni WebCrypto).
 *
 * Se usa como HUELLA DE CONTENIDO para deduplicar archivos binarios, no para
 * seguridad. Hace falta una función que devuelva EXACTAMENTE el mismo valor en
 * tres sitios distintos:
 *   - el navegador (el teléfono prepara la respuesta rápida),
 *   - el servidor (`/api/admin/migrar-*`, con node:crypto),
 *   - Postgres (`md5(decode(..., 'base64'))` en la migración SQL).
 * crypto.subtle sólo trae SHA-256, está en contexto seguro y es async; MD5 es
 * síncrono y coincide byte a byte con el `md5()` de la base de datos, que ya es
 * la función que calcula `respuestas_rapidas.huella`.
 */

const ROT = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

// K[i] = floor(abs(sin(i + 1)) * 2^32). Hardcodeado para que el resultado no
// dependa de la precisión de Math.sin del motor JS.
const K = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

const rotl = (x: number, c: number): number => (x << c) | (x >>> (32 - c));

/** Palabra de 32 bits escrita en orden little-endian, como pide el RFC 1321. */
function hexLE(n: number): string {
  let out = "";
  for (let i = 0; i < 4; i++) out += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
  return out;
}

/** MD5 de unos bytes → 32 caracteres hexadecimales (igual que md5() en Postgres). */
export function md5Hex(bytes: Uint8Array): string {
  const len = bytes.length;
  // Longitud final: múltiplo de 64 con 1 byte 0x80 + 8 bytes de longitud.
  const total = (Math.floor((len + 8) / 64) + 1) * 64;
  const msg = new Uint8Array(total);
  msg.set(bytes);
  msg[len] = 0x80;

  const view = new DataView(msg.buffer);
  view.setUint32(total - 8, (len * 8) >>> 0, true);
  view.setUint32(total - 4, Math.floor((len * 8) / 4294967296) >>> 0, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < total; offset += 64) {
    const m: number[] = new Array(16);
    for (let j = 0; j < 16; j++) m[j] = view.getInt32(offset + j * 4, true);

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let j = 0; j < 64; j++) {
      let F: number;
      let g: number;
      if (j < 16) {
        F = (B & C) | (~B & D);
        g = j;
      } else if (j < 32) {
        F = (D & B) | (~D & C);
        g = (5 * j + 1) & 15;
      } else if (j < 48) {
        F = B ^ C ^ D;
        g = (3 * j + 5) & 15;
      } else {
        F = C ^ (B | ~D);
        g = (7 * j) & 15;
      }
      F = (F + A + K[j] + m[g]) | 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl(F, ROT[j])) | 0;
    }

    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }

  return hexLE(a0) + hexLE(b0) + hexLE(c0) + hexLE(d0);
}
