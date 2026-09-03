# Build Info - Templo Místico CRM

**Fecha:** Wed Sep 02 (rama `arena/01a06498-templo-mistico-crm`)
**Commit:** (ver git log)
**Branch:** arena/01a06498-templo-mistico-crm

## Build 2026-09-02: preparación de emergencia/migración de Supabase + saneo de secretos

**Contexto:** el proyecto de Supabase `qrrkokfmbdtodrqbfehs` quedó suspendido y
el CRM dejó de leer/escribir datos. Además el repo es PÚBLICO y contenía llaves
reales (service role de Supabase, Chatwoot, Evolution, Fish, secreto del Cerebro
y número maestro), lo que es un motivo probable de la restricción.

### Cambios
- `src/lib/supabase-config.ts` (nuevo): configuración central de Supabase. Ya no
  hay URL ni llaves incrustadas; todo viene de variables de entorno.
- `src/lib/supabase.ts` y `src/lib/supabase-admin.ts`: si falta la configuración
  exportan clientes que fallan con un mensaje claro en el primer uso (no rompen
  el build).
- `src/lib/sync-chatwoot.ts`, `src/lib/media-storage.ts`: leen URL/llaves del
  config central; sin config devuelven error legible en vez de llamar a
  `qrrkokfmbdtodrqbfehs`.
- `src/lib/chatwoot.ts`, rutas de media/send-message: se quitó el token de
  Chatwoot y las URLs reales; requieren `CHATWOOT_URL`/`CHATWOOT_API_TOKEN` y
  `EVOLUTION_API_URL`/`EVOLUTION_API_KEY`.
- Workflows n8n y snapshots: se reemplazaron los secretos por marcadores
  `AQUI_*` / URLs `TU-*`. El builder (`n8n/build-luna-workflow.mjs`) sustituye
  marcadores desde `n8n/luna/secrets.local.json` (no versionado).
- `scripts/redactar-secretos.mjs` (nuevo): saneador de secretos; NO guarda las
  llaves en el repo (las lee de un archivo local gitignoreado).
- `scripts/dump-esquema-supabase.mjs` (nuevo): reconstruye `0000_reconstruir_*`
  desde el OpenAPI/PostgREST de un proyecto accesible (recupera el esquema que
  no estaba versionado).
- `.env.example` (nuevo) y `MIGRAR-SUPABASE-EMERGENCIA.md` (nuevo): guía paso a
  paso de recuperación / rotación / migración a otro proyecto.

### Verificación
- `npx tsc --noEmit` ✅ · `npm run build` ✅ · `npm run check:luna` ✅ · `npm run test:rr-storage` ✅
- Saneo: no quedan llaves reales en archivos versionados (sólo el proyecto ref
  en el doc de emergencia).

## Build 2026-09-01: audios de respuestas rápidas a Supabase Storage

**Problema:** los audios (e imágenes) de la biblioteca de respuestas rápidas vivían
dentro de `respuestas_rapidas.contenido` como data-URI base64, hasta ~8 MB por nota de
voz. Como la biblioteca se descarga COMPLETA en cada «Sincronizar con todos» y en cada
evento de realtime de la tabla, cada teléfono volvía a bajar todos los megabytes cada
vez — el mismo agujero de Egress que ya se tapó para los adjuntos del chat
(`20260916_media_storage.sql`), pero multiplicado por todos los operadores.

### Solución
- `src/lib/media-format.ts` (nuevo): helpers puros (data-URI ↔ bytes, MIME/extensión,
  rutas del bucket, subida) que usan TANTO el servidor como el teléfono. Antes la subida
  sólo existía en `media-storage.ts`, que depende de la service role y de `Buffer`, así
  que el navegador no podía usarla.
- `src/lib/md5.ts` (nuevo): MD5 en JS puro. Hace falta que la huella del archivo sea la
  MISMA en el navegador, en `node:crypto` y en `md5()` de Postgres; `crypto.subtle` sólo
  trae SHA-256 y exige contexto seguro.
- `src/lib/respuestas-rapidas.ts`: al publicar una respuesta pendiente, el binario se
  sube al bucket `media-mensajes` (carpeta `respuestas-rapidas/AAAA-MM/`) y en la tabla
  queda la URL pública. Detalles:
  - El objeto se nombra con el MD5 del archivo → dos teléfonos que suben el mismo audio
    escriben en la misma ruta y no dejan copias en el bucket.
  - La deduplicación ya no puede hacerse sobre el texto (una URL no representa el
    archivo): se guarda `hash_bytes` y la `huella` de la tabla pasa a ser
    `md5(tipo + hash_bytes)`. Un teléfono que todavía tiene el base64 en caché reconoce
    la copia publicada y no la vuelve a insertar.
  - Si la subida falla se publica el base64 (plan B, no se pierde nada) y la migración
    de Ajustes lo pasa a Storage después.
  - Borrar una respuesta liberada del bucket sólo borra el objeto si ninguna otra
    respuesta ni ningún mensaje del chat lo está usando.
  - Sin la migración SQL aplicada la app sigue funcionando: si `hash_bytes` no existe,
    reintenta sin esa columna.
- `src/app/page.tsx`: `enviarRespuestaRapida` manda ahora la URL (a través de
  `adjuntoParaEnviar`) en vez del base64 incrustado.
- `src/app/api/send-message/route.ts`: acepta `fileUrl`. El servidor descarga el archivo
  de Storage dentro de la misma región y lo envía; el teléfono no baja 6 MB para volver a
  subirlos. El mensaje enviado apunta al MISMO objeto, así que no se duplica en el bucket.
- `src/app/api/admin/migrar-respuestas-rapidas-storage/route.ts` (nuevo) + botón en
  Ajustes («Ahorro de datos · Supabase → Migrar N audios de respuestas rápidas»): mueve
  los `data:` históricos a Storage por lotes con presupuesto de tiempo, calcula la huella
  y unifica las filas repetidas que aparezcan al recalcularla.
- `supabase/migrations/20260917_respuestas_rapidas_a_storage.sql` (nueva): columna
  `hash_bytes`, huella basada en el hash, recálculo y eliminación de duplicados y comentario
  de las columnas. **Hay que ejecutarla antes de migrar.**

### Verificación
- `npm run test:rr-storage` (`scripts/prueba-respuestas-rapidas-storage.mjs`) — ✅ 32
  pruebas, 0 fallos: vectores del RFC 1321 y coincidencia con `node:crypto`, subida al
  bucket con la huella como nombre, URL (no base64) en la tabla, dos teléfonos con el
  mismo audio = una sola fila, plan B sin Storage, envío por URL, borrado seguro del
  objeto y tolerancia a la tabla sin `hash_bytes`.
- `npx tsc --noEmit` ✅ · `npm run build` ✅ · `npm run check:luna` ✅ (no toca Luna,
  pero es la otra suite del repo)

## Build 2026-08-29 (APK 1.3.2): barra de estado mimetizada con la app (pantalla uniforme)

**Problema:** la franja superior del teléfono (donde Android muestra la hora,
la batería y las notificaciones) se veía de otro color distinto al fondo del
CRM, porque la web no se dibujaba bajo esa zona y el sistema pintaba el fondo
de la ventana nativa (gris/blanco según el modo del teléfono).

### Solución web (se activa al desplegar en Vercel)
- `src/app/layout.tsx`: el viewport ahora declara `viewport-fit=cover`, así la
  interfaz se dibuja a pantalla completa y el fondo del CRM llega hasta el
  borde físico, por detrás de la barra de estado (edge-to-edge). Es lo que la
  documentación de Capacitor 8 recomienda.
- `src/app/globals.css`: variables `--safe-area-inset-top/right/bottom/left`.
  En la APK las rellena Capacitor con los valores reales del teléfono; en
  navegador/PWA usan `env(safe-area-inset-*)` (0 en escritorio, notch del
  iPhone en PWA).
- `src/app/page.tsx`:
  - El contenedor raíz reserva el hueco de la barra de estado con
    `pt-[var(--safe-area-inset-top)]` → el contenido (bandeja, chats,
    pipeline, tareas…) empieza justo debajo de la hora, pero el FONDO morado
    oscuro continúa por detrás de la barra: franja y app del mismo color.
  - La barra de navegación inferior crece hasta cubrir la zona de gestos de
    Android (`calc(4rem + safe-area-inset-bottom)`) y `main` acompaña con el
    margen equivalente, para que la pantalla también sea uniforme por abajo.
- `src/components/ChatImage.tsx`: el visor de imágenes a pantalla completa
  también respeta la franja superior/inferior.
- `src/lib/theme.ts`: al cambiar el tema (oscuro/claro/sistema) se sincronizan
  las barras del sistema de la APK:
  - Plugin nativo propio `StatusBarTheme` (nuevo): pinta la barra de estado y
    de navegación con el color exacto del tema (`#090d16` oscuro,
    `#f1f3f7` claro) y elige iconos blancos u oscuros. En Android 14 y
    anteriores es lo que da el color uniforme; en Android 15+ el color lo
    pone la propia web (edge-to-edge) y el plugin sólo ajusta los iconos.
  - Plugin interno `SystemBars` de Capacitor 8: se alinea su estilo para que
    una rotación de pantalla no revierta los iconos.

### Solución nativa (APK)
- `android/.../StatusBarThemePlugin.java` (nuevo) + registro en
  `MainActivity.java`.
- `android/app/src/main/res/values/colors.xml` (nuevo):
  `tm_window_background = #090D16` (el mismo fondo del tema oscuro del CRM).
- `styles.xml`: `AppTheme.NoActionBar` usa ese color como `windowBackground`,
  `statusBarColor` y `navigationBarColor` → sin franja gris/blanca arriba ni
  destello blanco durante la carga, desde el primer frame.
- Versión: `versionName` 1.3.2, `versionCode` 6.
- `npm run build` ✅ · `tsc --noEmit` ✅ · XML nativos validados ✅

## Build 2026-08-28 (2): latencia de sincronización 1–2 s + barra de cuenta a una línea

### Latencia Chatwoot → dashboard (objetivo: 1–2 s)
- `/api/chatwoot/webhook` es ahora el camino PRINCIPAL y va por la vía rápida:
  si la conversación ya existe, hace 1 búsqueda y luego **inserta el mensaje y
  actualiza el resumen en paralelo** (antes eran ~6–10 consultas en serie y
  descargaba 400 mensajes para deduplicar uno solo). Dedupe por ventana
  temporal (±150 s, la que usa la huella) + verificación exacta por id.
  Acepta también `message_updated` (pies de foto al instante; nunca inserta
  filas nuevas con ese evento). Idempotente ante reintentos de Chatwoot.
- Sondeo del dashboard adaptativo (antes: una pesada cada 20 s):
  - chat abierto: delta cada **2.5 s** (lock propio);
  - bandeja: delta cada **5 s**;
  - reparación completa: al abrir la app, al volver de estar oculta y cada 3 min;
  - cada tipo de sondeo tiene su candado (antes el sondeo del chat y el de la
    bandeja se bloqueaban entre sí).
- Modo `?rapido=1` en `/api/chatwoot/sync`: 1 listado de Chatwoot (100/página,
  antes 5×25 en serie) + **1 solo mapa** de Supabase para decidir qué chats
  cambiaron. Los chats sin novedades cuestan 0 consultas (antes: 4 por chat,
  incluyendo un `PATCH clientes` inútil en cada pasada que disparaba el
  realtime y hacía recargar la lista del teléfono cada 20 s).
- Caché anti-rebombe en el servidor: un chat ya revisado que no cambió no se
  re-descarga durante 45 s (se invalida sola cuando Chatwoot reporta nueva
  actividad; la reparación completa la ignora).
- `upsertCliente`/`upsertConversacion` ya no escriben cuando nada cambió
  (menos eventos realtime vacíos = lista más estable y más barata).
- El webhook de Chatwoot sigue siendo **recomendadísimo**: con él el mensaje
  entra al CRM en <1 s empujado por Chatwoot; el sondeo rápido es la red de
  seguridad (2–3 s) si el webhook no está o falla.
- Pruebas: `node scripts/prueba-sincronizacion-rapida.mjs` (16 checks con
  Chatwoot+PostgREST simulados: idle=2 consultas, webhook≤6 round-trips,
  idempotencia, message_updated seguro). `npm run build` ✅ · `tsc --noEmit` ✅

### Barra de cuenta sobre el compositor (móvil)
- El campo "Responde desde: … • Etapa: …" + aviso 🔔 "En seguimiento" ahora es
  **siempre una sola línea**: trunca con "…" (el detalle completo va en el
  `title`), etiquetas cortas en móvil ("Desde: 👤 Personal · Hoy ✓") y el área
  de mensajes puede encogerse (`min-h-0`). Antes, con etapas largas + la
  campana, hacía wrap a 2–3 líneas, empujaba el área de escritura y el botón
  de envío de audio quedaba tapado tras la barra de navegación.
- Compositor: input encoge antes de que los iconos salten de línea; botón de
  mic/audio con `aria-label`; cabecera del chat con nombre/teléfono truncables
  para que los botones nunca queden fuera de pantalla.

## Build 2026-08-28: notas de voz nativas por WhatsApp API + orden de pestañas

### Notas de voz nativas (burbuja de nota de voz en vez de "audio simple")
- El conversor WebM→OGG/Opus era válido (verificado con decodificador OGG/Opus
  independiente, payload byte a byte idéntico). El problema era que el envío DIRECTO a
  Meta fallaba en silencio (el motivo quedaba solo en los logs del servidor) y la nota
  caía al adjunto de Chatwoot, que sólo reenvía el flag `voice` desde la v4.15.0.
- `src/lib/meta-voice-note.ts` reescrito:
  - Credenciales del canal WhatsApp Cloud, en orden: env `META_VOICE_API_TOKEN` /
    `META_VOICE_PHONE_NUMBER_ID` → `config_general` (claves `meta_voice_token` /
    `meta_voice_phone_number_id`) → `provider_config` del inbox de Chatwoot (éste último
    solo si el token de Chatwoot es administrador).
  - La consulta de la conversación de Chatwoot ya no es fatal: si el id guardado está
    obsoleto se usa el número que ya tiene el CRM.
  - Reintento automático si Meta responde 5xx (el FormData se reconstruye por intento).
  - El motivo del fallo ahora viaja en la respuesta de `/api/send-message`
    (`audioReason`) y se muestra en el aviso de la app: "La nota se envió, pero llegó
    como audio simple… Motivo: …".
- `src/components/AjustesPanel.tsx`: sección nueva "Notas de voz · WhatsApp API" en
  Ajustes: Access Token del canal WhatsApp Cloud + Phone Number ID, guardados en
  `config_general`. Con eso la app habla directa con Meta (`voice: true`) y la nota
  llega como burbuja de nota de voz nativa, sin depender del rol del token de Chatwoot.
- Verificación: `npm run build` ✅ · smoke test de `sendVoiceNoteViaMeta` con fetch
  mockeado ✅ (directo por env, reintento 5xx, reasons legibles) · remuxer re-verificado
  ✅ (páginas OGG válidas + decodificación independiente).

### Orden de subcategorías en la bandeja de chats
- Las pestañas de la bandeja ahora siguen el MISMO ORDEN del pipeline, con la única
  diferencia de que "Por leer" y "En seguimiento" van fijas en las posiciones 2 y 3:
  `Etapa 1 · Por leer · En seguimiento · Etapa 2 · Etapa 3 · …`
- Spam y Archivados se quedan al final, como antes.

## Build anterior — 2026-08-25 (rama `arena/01a036a2-templo-mistico-crm`)

## Build Next.js
- Comando: npm run build
- Output: .next/ (server) y out/ (static para APK)
- Tamaño .next: 86M
- Tamaño out: 736K
- Estado: ✅ compilación verificada (sin errores)

## APK (automática en GitHub Actions)
- Workflow listo: `ci/build-apk.yml` (hay que copiarlo a `.github/workflows/build-apk.yml`
  para activarlo — el token del agente no tiene permiso `workflows` en GitHub)
- Una vez activo, en cada push a `arena/**` o `main`: compila el APK debug en la
  nube, lo sube como artefacto y lo commitea en `apk/templo-mistico-crm-debug.apk`
- App ID: com.templomistico.crm
- App Name: Templo Místico CRM
- Version: 1.3.1 (definida en `package.json` y usada por Android; `versionCode` 5)
- WebDir: out · La APK carga https://templo-mistico-crm.vercel.app (server.url)
  → los cambios web van live con el deploy de Vercel, sin rebuild del APK

## Migraciones pendientes (Supabase SQL Editor)
- supabase/migrations/20260829_nombre_manual_prioridad_telefono.sql
- supabase/migrations/20260830_enrutar_leads_por_numero.sql
- supabase/migrations/20260902_luna_etapas_expediente.sql  ← nueva (Luna por etapas)
- supabase/migrations/20260903_mensajes_id_chatwoot.sql   ← nueva (mensajes perdidos)
- supabase/migrations/20260904_eliminar_cliente_completo.sql (eliminación completa v1)
- supabase/migrations/20260905_eliminar_cliente_total.sql   ← nueva (eliminación total v2)
- supabase/migrations/20260907_llamadas_seguimiento_contactos.sql ← nueva (etapa En seguimiento + alerta diaria)
- supabase/migrations/20260915_sincronizacion_respuestas_rapidas_unica.sql (biblioteca compartida y elimina duplicados exactos)
- supabase/migrations/20260916_media_storage.sql ← nueva (bucket media-mensajes para adjuntos del chat)
- supabase/migrations/20260917_respuestas_rapidas_a_storage.sql ← nueva (audios/imágenes de respuestas rápidas a Storage + columna hash_bytes)

## Luna por etapas (nuevo)
- Workflow importable: `n8n/IMPORTAR-EN-N8N.json` (generado localmente; docs en `n8n/05-README-luna-etapas.md`)
- Luna solo responde en **Lead Nuevo** y **Datos**; en el resto se queda callada
- En Lead Nuevo saluda, se presenta, pregunta el motivo y pasa directamente a Datos
- En Datos identifica el trabajo y pide en un solo mensaje amable todos los datos completos:
  - personal: foto del rostro, nombre y apellido, y foto de la palma derecha;
  - pareja: nombre y apellido de ambos, y foto de cada uno o una sola foto juntos.
- Un nombre de pila se mantiene pendiente hasta recibir el nombre completo; un nombre parcial puede enriquecerse sin pisar datos completos
- La solicitud no usa `1.`, `2.` ni `3.`; en audio ya no dice «uno punto» y no pierde el último dato
- Solo después de que Chatwoot acepta ese mensaje, Luna pausa completamente el chat para que continúe un operador
- Verificación: `npm run check:luna` (70 pruebas sobre el código real de los nodos) — ✅ 0 fallos
- Regenerar: `npm run build:luna` → `IMPORTAR-EN-N8N.json` (importar en n8n, llaves dentro,
  sin versionar) y `05-luna-etapas.github.json` (versionado, sin secretos, usa $env)
- El n8n del Templo tiene N8N_BLOCK_ENV_ACCESS_IN_NODE: por eso el archivo importable
  lleva las llaves dentro y no usa $env

### Nuevas funciones de ese build
- Número de teléfono con prioridad sobre el nombre (formato +país, ej: +573054021111)
- Nombre manual editable (✏️) que es el único nombre que se muestra
- Pestaña "Por leer": chats de todas las categorías con mensajes sin leer
- Enrutado de leads por número: publicidad → Lead Nuevo del WhatsApp API Templo
- Mover de etapa sincroniza el grupo (Personal ↔ Templo)
- Eliminación completa del cliente y sus datos: al volver a escribir entra como lead nuevo
- 🗑️ Eliminar ahora también borra el chat de WhatsApp y las **fichas de Luna**
  (custom_attributes con motivo, nombres, fotos y etapa) vía `/api/clientes/eliminar`.
  Detalle en `ELIMINAR-CLIENTE-COMPLETO.md`
- Pruebas: `npm run test:eliminar` (endpoint + limpieza de Luna) y
  `npm run test:eliminar:sql` (función SQL contra PostgreSQL real) — ✅ 0 fallos
- Guardar el contacto directamente en la agenda Android con consecutivo automático si ya existe el nombre (o descargar vCard en web/PWA)
- Botón de llamada para WhatsApp Personal: valida que el contacto esté guardado e intenta abrir la voz nativa (con respaldo al chat Personal)
- Etapa y chip "En seguimiento" junto a "Por leer", con aviso diario local en la APK a las 9:00 a. m.
- Los mensajes con imagen ahora conservan y muestran su texto/pie de foto
