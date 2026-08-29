# Build Info - Templo Místico CRM

**Fecha:** Fri Aug 28 (rama `arena/01a045dd-templo-mistico-crm`)
**Commit:** (ver git log)
**Branch:** arena/01a045dd-templo-mistico-crm

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
