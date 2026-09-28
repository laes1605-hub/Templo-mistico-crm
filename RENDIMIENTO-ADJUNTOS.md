# Por qué los audios tardaban 15-20 s (y qué se cambió)

Resumen en una frase: **el audio se bajaba por el camino más largo posible —y en
fila detrás de todos los demás—**. Ahora suena al instante (streaming desde la
URL original), los bytes se bajan en paralelo con prioridad y, en cuanto el
servidor copia el archivo a Supabase Storage, sale directo del CDN.

---

## 1. Diagnóstico: qué pasaba exactamente

### a) El chat bajaba TODO el historial de audios al abrirse

`VoiceNotePlayer` pedía sus bytes al montarse, y el chat pinta todos los mensajes
de golpe (sin virtualizar). Con 8-10 notas en pantalla, las 8-10 descargas
entraban a una cola **FIFO de 2 simultáneas**: la nota nueva (la última de la
fila) esperaba a que bajaran las 7 anteriores. De ahí los 15-20 s.

### b) Cada descarga daba dos saltos de red y un viaje perdido

Los adjuntos entrantes viven en Chatwoot (`/rails/active_storage/...`), no en
Supabase. El teléfono no los puede pedir directo porque **Chatwoot no manda
cabeceras CORS**, así que `resolveMediaBlob` intentaba el `fetch` directo
(que siempre falla), y recién después iba al proxy `/api/media/download`, que a
su vez bajaba el archivo de Chatwoot. Resultado: teléfono → Vercel → Chatwoot →
Vercel → teléfono, con el archivo entero esperando en cada paso.

### c) La respuesta del proxy no se podía cachear

`/api/media/download` respondía con `Cache-Control: public, max-age=86400` pero
el CDN de Vercel no lo guardaba (le faltaba `s-maxage`), así que **cada
reproducción volvía a bajar el archivo del origen**, y no se respetaban las
peticiones `Range` (el navegador pide rangos para empezar a sonar sin bajar
todo el archivo).

### d) Los mensajes viejos con base64 pesaban en cada apertura del chat

Los adjuntos históricos guardados como `data:` (varios MB por fila) viajan en
cada `select` del chat: eso también alarga la carga del historial. La migración a
Storage ya existía (`/api/admin/migrar-media-storage`, botón en Ajustes), pero
solo se ejecutaba a mano.

---

## 2. Qué se cambió

| Archivo | Cambio |
| --- | --- |
| `src/components/VoiceNotePlayer.tsx` | **Carga perezosa** (`IntersectionObserver`: solo lo que está por verse) + **arranque inmediato**: al tocar play se le pasa la URL directa al `<audio>` y suena en ~1 s, mientras los bytes se bajan en paralelo. Onda real y duración exacta siguen llegando después. La decodificación tiene tope de 2 a la vez para no fundir el teléfono. |
| `src/lib/download-media.ts` | **Cola con prioridad** (play > visible > precarga, 4 descargas simultáneas en vez de 2), **deduplicación** (dos burbujas del mismo archivo comparten descarga), **caché de blobs por URL** (cambiar de chat y volver ya no vuelve a bajar) y **atajo al proxy** para las URLs de Chatwoot (se ahorra el intento CORS que siempre fallaba). |
| `src/app/api/media/download/route.ts` | Caché fuerte de CDN (`s-maxage`) + navegador, soporte de `Range` (206 parcial) y `HEAD`/`OPTIONS`. La segunda escucha ya no toca el origen. |
| `src/lib/media-fuente.ts` *(nuevo)* | Cabeceras y candados de seguridad compartidos (hosts privados fuera, token de Chatwoot, API de Chatwoot bloqueada). |
| `src/lib/media-ingest.ts` *(nuevo)* | Copia un adjunto a Storage (desde URL externa **o** desde base64), con topes de tamaño/tiempo y MIME corregido. |
| `src/app/api/media/persistir/route.ts` *(nuevo)* | Endpoint que hace esa copia en segundo plano. `POST {ids}`, `POST {conversacionIds}`, `POST {}` (barrido general) y `GET` → cuántos quedan. |
| `src/app/page.tsx` | Dispara la copia **sin bloquear la UI**: al llegar un mensaje con adjunto, al abrir un chat, y un barrido corto al abrir la app. Además escucha los `UPDATE` de `mensajes` para adoptar la URL nueva de Storage sin recargar el chat. |
| `src/components/ChatImage.tsx` | Imágenes con `decoding="async"`. |
| `scripts/medir-adjuntos.mjs` *(nuevo)* | Mide y compara: origen Chatwoot vs proxy del CRM vs Storage. |

Con el archivo ya en Storage, el teléfono lo pide **directo al CDN de Supabase**
(con `Range`, caché de borde y sin función de servidor de por medio): el mismo
archivo pasa de 15-20 s a ~1 s o menos.

---

## 3. Cómo comprobarlo

En tu máquina (necesita internet y las llaves del proyecto):

```bash
node scripts/medir-adjuntos.mjs --limite 8
```

Imprime, para los últimos adjuntos:

```
· <id> audio  externo (Chatwoot) · 480 KB
    origen  (Chatwoot) : 2100 ms
    proxy   (CRM)      : 3900 ms · CDN MISS
    storage (CDN SB)   : 260 ms
```

Y al final el contador de pendientes (`GET /api/media/persistir`).

Si querés forzar la copia de un chat concreto:

```bash
curl -X POST https://TU-CRM.vercel.app/api/media/persistir \
  -H 'Content-Type: application/json' \
  -d '{"conversacionIds":["<id-de-conversacion>"],"limite":6}'
```

En la app: al abrir un chat, las notas visibles suenan al toque y el resto de los
adjuntos se optimiza detrás. En Ajustes sigue estando **Migrar adjuntos** para
vaciar el historial viejo de una vez.

## 4. Qué NO cambia (y por qué)

- **Videos y documentos grandes** no se copian a Storage (límite de 12 MB por
  archivo): siguen por el proxy, que ahora cachea mejor.
- **Los archivos no se borran de Chatwoot**: el CRM se queda con su propia copia,
  así que aunque Chatwoot pierda la nota, el chat la sigue reproduciendo.
- **Sin Storage configurado** todo sigue funcionando: si la copia falla, el
  mensaje conserva su URL original y el proxy lo sirve igual.
