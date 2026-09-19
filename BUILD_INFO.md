# Build Info - Templo Místico CRM

**Fecha:** 2026-09-19 (rama `arena/01a0ba5c-templo-mistico-crm`)
**Commit:** (ver git log)
**Branch:** arena/01a0ba5c-templo-mistico-crm

## Build 2026-09-19: los recordatorios de WhatsApp API vuelven a salir (Supabase nuevo)

**Problema:** los recordatorios automáticos de WhatsApp API no llegaban.

### Diagnóstico (verificado contra el proyecto real, no supuesto)

- **La etiqueta `bot-pausado` vetaba a los clientes correctos**: el workflow no
  enviaba a los chats con esa etiqueta, pero Luna la pone justo cuando envía la
  lista de requisitos y pasa el chat a **Datos**. En el CRM había **102 chats
  abiertos** con `bot-pausado` frente a **129** en `etapa-datos`: casi todos los
  candidatos quedaban silenciados por la propia etiqueta del flujo. Ahora
  `bot-pausado` no veta (siguen vetando `recordatorios-pausados`, `perdido`,
  `lead-perdido` y `spam`) y el diagnóstico informa `etiquetasQueApagan` y el
  desglose `conteo.omitidas.porEtiqueta`.
- **Salía un solo recordatorio por pasada (la causa que quedaba)**: los nodos Code
  leían `$input.item` (un único ítem) en vez de `$input.all()` (la tanda completa),
  así que el envío se cortaba en el primer chat de la lista. Comprobado contra el
  Supabase real: el 19/09 a las 19:35 UTC se registró **un solo envío** cuando
  había **10 clientes** en Datos/No contesta con su tiempo cumplido (4 h, 6 h,
  18 h, 20 h, 22 h…). Ahora los tres nodos recorren la tanda completa y el
  workflow **ya no lleva «Procesar uno a uno» ni bucle**: la cadena es
  `Cada 15 minutos → Buscar → Enviar → Registrar`. El builder fuerza la cadena, el
  modo «Run Once for All Items» y **falla** si vuelve a aparecer un bucle.
- **La variante no correspondía al tiempo sin contestar**: antes se elegía por el
  número de avisos previos. Ahora la plantilla se elige por tiempo sin contestar
  (30 min → 1 · 3 h → 2 · 12 h → 3 · 23 h 30 → 4), no se repite la misma en 24 h y
  la pasada tiene un tope de 60 envíos.
- **El bucle estaba conectado al revés** (arreglo anterior, ya sin efecto porque el
  bucle se eliminó): el nodo «Procesar uno a uno» tiene las salidas 0 = `done` y
  1 = `loop`, los ítems viajan por `loop` y `done` entrega `[]` hasta terminar
  (comprobado en `SplitInBatchesV3.node.ts`). Con el envío conectado a `done` no se
  enviaba nada. Dejó de ser un riesgo al quitar el nodo del workflow.
- Las credenciales del código apuntan al proyecto `zcljlddtcoyfyvshlyfk` y
  responden: `recordatorios_whatsapp` existe y la service_role lee y escribe.
  El proyecto **no** era el problema.
- El último recordatorio registrado era del **10/09/2026**. Justo ahí dejó de
  salir el intento de la etapa *Datos*.
- Causa: el workflow pedía `pipeline_etapas?grupo=eq.templo` y después comparaba
  por nombre. El CRM crea y edita las etapas con `grupo = 'general'`
  (`agregarEtapaPipeline` en `src/app/page.tsx`), así que al unificar el pipeline
  **Datos** quedó en `general`: el workflow no la reconocía y no enviaba nada.
  También exigía `clientes.grupo = 'templo'`, lo que descartaba a los chats que
  el operador había movido a la cartera Personal.

### Arreglo (`n8n/03-recordatorios-whatsapp-por-etapa.json`)

- Las etapas se reconocen **solo por NOMBRE, en todo el pipeline** (sin filtrar
  por grupo), sin acentos ni mayúsculas y admitiendo sufijos («Datos (API)»).
- El canal lo decide la **conversación** (`fuente = 'meta_business'`), no
  `clientes.grupo`.
- **Los candidatos salen de Supabase**, no del listado de Chatwoot. Antes la
  búsqueda pedía `conversations?status=open` por páginas y luego una consulta por
  chat: con 271 chats abiertos la pasada se quedaba a medias y solo atendía al
  primero de la lista (el 19/09 salieron 2 mensajes en vez de 11). Ahora es **una
  sola consulta** a `conversaciones` con `clientes!inner`, el tiempo sin contestar
  sale de `ultimo_entrante_api_en` y Chatwoot solo se usa para enviar y para
  verificar alguna hora. El diagnóstico se abre con `version` y un `resumen` de una
  línea, más `omitidasPorChat` con el motivo de cada descarte.
- Si falta una etapa, el workflow **no revienta**: lo informa en un ítem final
  de diagnóstico (`_diagnostico: true`) con `etapasReconocidas`,
  `etapasDelPipeline`, `conteo.omitidas.*` y `avisos`: en una sola mirada se ve
  por qué no salió nada.
- **Ventana de 24 h**: fuera de ella Meta rechaza el texto libre, así que no se
  intenta el envío (antes fallaba en silencio).
- El nodo de envío guarda el motivo exacto devuelto por Chatwoot/Meta en el
  campo `error` (antes solo quedaba en los logs del servidor).
- Las **credenciales van escritas dentro de cada nodo** (esta instancia de n8n
  no permite variables de entorno). Cambiar de proyecto Supabase es editar solo
  `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en los tres nodos.
- `n8n/recordatorios/CODIGO-PARA-PEGAR.md` trae los tres nodos completos con las
  llaves dentro para copiar y pegar a mano en n8n.
- El código de los nodos ya no vive dentro del JSON: se edita en
  `n8n/recordatorios/code/*.js` y se regenera con `npm run build:recordatorios`.
- **Seguridad**: `/api/media/download` adjuntaba el token de Chatwoot a cualquier
  URL del mismo servidor, así que servía también `/api/v1/...` (se comprobó que
  devolvía las conversaciones con el token de administrador). Ahora de ese host
  solo se permiten rutas de `/rails/active_storage/`, que es de donde salen los
  archivos del chat.
- `npm run simular:recordatorios`: prueba en seco con datos reales (qué saldría, qué
  espera tiempo y qué queda fuera de la ventana de 24 h). Extrae las reglas del
  propio workflow, así que no puede desincronizarse.
- Verificación: `npm run test:recordatorios` — **104 pruebas OK** sobre el código
  real de los nodos (Chatwoot y Supabase simulados), incluidas las consultas
  exactas validadas contra el proyecto real. Detalle en
  `n8n/03-README-recordatorios.md`.

## Build 2026-09-16: las notas de voz del chat vuelven a sonar (reproductor robusto)

**Problema:** las notas de voz del chat no se reproducían y la burbuja se veía
"vacía" (onda sin sentido, duración `…` y el botón de play sin efecto ni
explicación).

### Diagnóstico (verificado contra el proyecto real, no supuesto)

- Los adjuntos están bien: en `mensajes` ya no queda ningún audio en `data:` ni
  ninguna URL `http://` (mezcla de contenido bloqueada por el navegador). Las
  notas apuntan o al bucket público `media-mensajes` o a Chatwoot
  (`crmesteban.duckdns.org/rails/active_storage/...`).
- Los objetos de Storage existen y son públicos: el objeto de una nota real
  responde en `/storage/v1/object/info/public/...` con `size: 84229` y
  `content_type: audio/ogg`.
- El remuxer WebM→OGG está sano: con un WebM/Opus REAL generado por ffmpeg, el
  `remuxWebmToOgg` del repo produce un OGG que ffmpeg/libopus decodifica entero
  (3,01 s de audio con señal, RMS 0,088), con y sin el preroll de 300 ms y tanto
  con tamaños conocidos como en versión "streaming" (Segment/Cluster sin
  tamaño, que es lo que escribe MediaRecorder).
- Conclusión: el fallo estaba en el reproductor del navegador, no en los
  archivos ni en la migración a Storage.

### Arreglo (`src/components/VoiceNotePlayer.tsx`)

- El audio se resuelve UNA vez con `resolveMediaBlob` (fetch directo y, si el
  navegador no puede, el proxy `/api/media/download`, que es el único que puede
  poner el `api_access_token` de Chatwoot/Evolution) y esos bytes se le dan al
  `<audio>` como `blob:` URL. Antes el elemento siempre recibía la URL remota
  cruda: si el host no permitía CORS o exigía cabeceras, la reproducción HTML5
  no arrancaba nunca y el único respaldo era el WebAudio.
- La duración ahora sale exacta (el archivo ya está en memoria): con OGG/Opus y
  `preload="metadata"` sobre URL remota el navegador a menudo no la calcula y la
  burbuja se quedaba en `…`, que es justo el aspecto de "nota vacía".
- El fallo ya no es silencioso: la burbuja muestra icono + mensaje + botón
  **Reintentar** (antes `hasError` se asignaba y nunca se pintaba; `AlertCircle`
  estaba importado sin usar y `onError` sólo podía ponerlo a `false`).
- Un chat con cientos de notas ya no abre cientos de descargas simultáneas:
  cola de 2 en paralelo (`pedirTurnoDeDescarga`), y se libera el `blob:` URL al
  cerrar la burbuja.

### Verificación

- `npm run test:audio` (nuevo, `scripts/prueba-reproductor-audio.mjs`) — ✅ 22
  comprobaciones: monta el componente real en jsdom y verifica que un audio que
  sólo se consigue por el proxy acaba con `src="blob:..."` y suena, que un audio
  imposible muestra el aviso y el botón Reintentar (y que reintentar vuelve a
  descargar), y que la cola limita a 2 descargas. **La misma prueba falla en 6
  puntos contra el reproductor anterior**, que dejaba `src` apuntando a la URL
  de Chatwoot y la burbuja en `0:00 …` sin ningún aviso.
- `npm run test:remux` ✅ · `npm run test:tiempo` ✅ (60) ·
  `npm run test:rr-storage` ✅ · `npm run check:luna` ✅ (80)
- `npx tsc --noEmit` ✅ · `npm run build` ✅
- Es sólo web: se activa con el deploy de Vercel, sin rebuild del APK.

## Build 2026-09-15: ventana de 24 h, fechas en el chat, guardado en Google y etapa Vencidos

Cuatro cosas pedidas: (1) ver cuánto queda de la ventana de 24 h en los chats del
WhatsApp API, (2) marcas horizontales de fecha dentro de TODOS los chats,
(3) guardar los contactos también en la cuenta de Google y (4) que los chats que
vencen en el WhatsApp API se vayan solos a la etapa «Vencidos», que se responde
desde el WhatsApp Personal.

### 1. Ventana de 24 h (WhatsApp API / Meta)

- El contador se calcula desde el **último mensaje del CLIENTE**, que es la regla real
  de Meta (no desde el último mensaje propio). Dentro de la ventana se puede responder
  con texto libre; fuera, WhatsApp API solo acepta plantillas aprobadas.
- Se muestra en tres sitios, solo en los chats del WhatsApp API (fuente `meta_business`):
  - **Lista de chats**: chip junto a la hora (`⏳ 21 h 32 min`).
  - **Cabecera del chat abierto**: pastilla con el tiempo restante.
  - **Barra "Responde desde ..."** sobre el compositor, siempre visible al escribir.
  - El tooltip de los tres explica a qué hora se cierra la ventana y cuándo escribió
    el cliente por última vez.
- Colores por urgencia: verde (más de 6 h) → ámbar (≤ 6 h) → naranja parpadeante
  (≤ 1 h) → rojo cuando ya cerró, con el tiempo transcurrido (`cerrada hace 3 h`).
- Los chats de WhatsApp Personal (Evolution, `👤`) no muestran ventana: esa regla es
  exclusiva del WhatsApp API.
- Datos: `conversaciones.ultimo_entrante_en`, mantenida por un trigger con cada
  mensaje (aunque la app esté cerrada). Si la migración todavía no está aplicada, el
  dashboard calcula la marca con una consulta corta (una vez por minuto, solo chats
  del API con mensajes de los últimos 8 días) y en cuanto exista la columna deja de
  consultar.
- Archivos: `src/lib/tiempo-chat.ts` (lógica pura), `src/components/VentanaWhatsApp.tsx`
  (chip/pastilla/barra), `src/app/page.tsx` (cálculo, respaldo y pintado).

### 2. Marcas de fecha en el historial

- Línea horizontal con la fecha centrada cada vez que cambia el día, en todos los
  chats (API y Personal), y el chat continúa debajo como siempre.
- Textos estilo WhatsApp: `Hoy` · `Ayer` · día de la semana (últimos 7 días, `Sábado`)
  · `17 de julio` · con año si es de otro año (`20 de diciembre de 2025`). El tooltip
  lleva la fecha larga (`sábado, 20 de diciembre de 2025`).
- La marca se dibuja solo cuando el mensaje cambia de día respecto al anterior (el
  primero del historial también la lleva), así que un chat con meses de historial no
  repite la fecha en cada mensaje.
- Archivos: `src/components/DivisorFecha.tsx` + `src/lib/tiempo-chat.ts`.

### 3. Contactos en la cuenta de Google

- Nuevo botón **"Guardar en cuenta Google"** en la ficha del cliente, junto al de
  "Guardar en teléfono".
- Flujo sin configuración: se genera la ficha `.vcf` y se abre el menú de compartir
  (Share de Capacitor en la APK, Web Share en el navegador; si no hay hoja de
  compartir, se descarga el `.vcf`). Al elegir **Contactos / Google Contacts** y la
  cuenta de Google, el contacto queda en la nube y también en el teléfono.
- El guardado nativo de la APK (`Contacts.createContact`) sigue igual y no cambia.
- Detalle y camino alternativo (escritura directa en la cuenta Google con plugin
  nativo) en `GUARDAR-CONTACTOS-GOOGLE.md`.
- Archivos: `src/lib/contacts.ts` (`construirVCard`, `descargarVCard`,
  `guardarContactoEnGoogle`) y `src/app/page.tsx` (botón y avisos).

### 4. Etapa «Vencidos» (WhatsApp API → WhatsApp Personal)

- Cuando la ventana de 24 h de un chat del WhatsApp API se cierra, ese número ya no
  permite responder con texto libre: el CRM lo pasa solo a la etapa **Vencidos**
  (cuenta `evolution` = WhatsApp Personal) para continuar la conversación ahí.
- Reglas:
  - Solo se mueven los chats cuya etapa responde el **WhatsApp API**
    (`cuenta_responsable = 'meta_business'`). Los que ya estaban en una etapa del
    **WhatsApp Personal** nunca se tocan.
  - Sin margen de cortesía: se mueven en cuanto la ventana vence.
  - Se ejecuta al abrir el CRM, así que también traspasa de una vez el historial que
    ya estaba vencido, y luego cada minuto (los que vencen en el momento se van solos).
  - Si el cliente vuelve a escribir **por el API** y la ventana se reabre, el chat
    **regresa solo** a la etapa donde estaba antes de vencer (memoria en
    `clientes.estado_antes_vencido`, que también se guarda al mover a mano).
  - Los chats spam y archivados no se mueven; la etapa Vencidos no se puede borrar.
  - Si una escritura falla (por ejemplo, migración pendiente), el CRM espera 5 minutos
    antes de reintentar, en vez de repetir el error cada 15 segundos.
  - Seguridad: la etapa Vencidos **no se inventa** si no está en la base. Sin la
    migración 20260919 el motor no mueve nada (y avisa en la consola): mover un chat a
    una etapa inexistente lo haría desaparecer del pipeline y del listado.
- Interruptor en **Ajustes → «Traspaso automático a Vencidos»** (`config_general.vencidos_auto`,
  `true` por defecto); avisa al dashboard al instante para no esperar la recarga.
- Archivos: `src/lib/tiempo-chat.ts` (reglas puras: `decidirTraspasoVencidos`,
  `tieneChatApi`, `ultimoEntranteApiDeConversacion`), `src/app/page.tsx` (motor de
  traspaso, chips con el canal del API), `src/components/AjustesPanel.tsx` (interruptor),
  `src/lib/sync-chatwoot.ts` (mantiene `ultimo_entrante_api_en`).
- Detalle completo en `VENCIDOS-WHATSAPP-API.md`.

### Verificación

- `npm run test:tiempo` (`scripts/prueba-tiempo-chat.mjs`) — ✅ 60 pruebas, 0 fallos:
  umbrales y textos de la ventana, duraciones, último entrante (ignora los enviados),
  etiquetas de fecha por día/semana/mes/año, coherencia entre la marca de la base de
  datos y los mensajes en pantalla, y las cuatro reglas de Vencidos (mover, no tocar
  etapas del Personal, volver a la etapa anterior, sin margen).
- `npx tsc --noEmit` ✅ · `npm run build` ✅
- Vista previa del diseño sin tocar datos: `preview-ventana-24h.html`.
- **Todo es web**: se publica con el deploy de Vercel y NO necesita APK nueva.

### Migración nueva

- `supabase/migrations/20260918_ventana_24h_whatsapp_api.sql` — columna
  `conversaciones.ultimo_entrante_en`, índice parcial de entrantes, relleno del
  historial, trigger por mensaje y RPC `recalcular_ultimos_entrantes()` para reparar
  todo de una vez. Sin ella la app funciona (respaldo), pero el contador es menos
  exacto en los chats viejos.
- `supabase/migrations/20260919_vencidos_a_whatsapp_personal.sql` — etapa `vencidos`
  (cuenta `evolution`), columna `clientes.estado_antes_vencido`, índice parcial y
  función de consulta `clientes_vencidos_whatsapp_api()`. Sin ella el traspaso
  funciona, pero se pierde el regreso automático a la etapa anterior.

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
- Workflow activo en `.github/workflows/build-apk.yml` (el token del agente no tiene
  permiso `workflows` en GitHub, así que no puede modificarlo: los cambios de CI se
  aplican desde el navegador, ver `ARREGLAR-BUILD-APK.md`)
- **Build APK en rojo desde el 14/09/2026 — arreglo pendiente de aplicar** (2 líneas):
  Google retiró el paquete `tools` del Android SDK y `android-actions/setup-android@v3`
  lo pide por defecto. Instrucciones exactas en `ARREGLAR-BUILD-APK.md`
  (ojo: solo subir a `@v4` NO basta, hay que añadir `packages: 'platform-tools'`)
- Una vez activo, en cada push a `arena/**` o `main`: compila el APK debug en la
  nube, lo sube como artefacto y lo commitea en `apk/templo-mistico-crm-debug.apk`
- App ID: com.templomistico.crm
- App Name: Templo Místico CRM
- Version: 1.3.2 (definida en `package.json` y usada por Android; `versionCode` 6)
- WebDir: out · La APK carga https://templo-mistico-crm.vercel.app (server.url)
  → los cambios web van live con el deploy de Vercel, sin rebuild del APK

## Migraciones pendientes (Supabase SQL Editor)
- supabase/migrations/20260918_ventana_24h_whatsapp_api.sql ← **nueva** (ventana de 24 h del WhatsApp API; si ya la aplicaste, vuelve a aplicarla: ahora también crea `ultimo_entrante_api_en`)
- supabase/migrations/20260919_vencidos_a_whatsapp_personal.sql ← **nueva** (etapa Vencidos + memoria de la etapa anterior)
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
