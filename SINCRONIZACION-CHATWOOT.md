# 🛠 MENSAJES QUE NO LLEGABAN AL DASHBOARD — ARREGLO DEFINITIVO

**Fecha:** 2026-09-06 · **Problema reportado:** los mensajes de los clientes
sí llegaban al chat de Chatwoot, pero nunca cargaban en el dashboard del CRM.

---

## 🔍 Causa raíz

El dashboard **no lee Chatwoot**: lee las tablas `conversaciones` y `mensajes`
de Supabase. Y hasta ahora, la única cosa que escribía esas tablas era el nodo
**"Sincronizar Supabase"** del workflow de n8n (Luna). Ese nodo tiene un solo
`try/catch` global: si **cualquier** paso falla, se pierde **todo** el evento.

Los `BUILD_INFO.md` anteriores advertían que había **migraciones pendientes**
en Supabase. Con una columna pendiente (ej: `telefono_display`,
`foto_otra_persona`, `chatwoot_message_id`), el `PATCH`/`POST` de `clientes`
devolvía 400 → el nodo abortaba → **el mensaje nunca se guardaba**, aunque
Chatwoot lo mostraba perfecto. Lo mismo pasa si n8n se cae, se desactiva o se
queda sin créditos: el dashboard se queda ciego.

## ✅ La solución: el dashboard ya no depende de n8n para ver los mensajes

### 1. Sincronización directa Chatwoot → Supabase (nueva)
- **`src/lib/sync-chatwoot.ts`**: biblioteca servidor que pregunta a Chatwoot
  (la fuente de la verdad) y repara Supabase.
  - **A prueba de migraciones pendientes:** antes de escribir consulta las
    columnas reales de cada tabla (OpenAPI de PostgREST) y descarta las que no
    existan. Nada vuelve a abortar.
  - **Anti-duplicados:** deduplica por `chatwoot_message_id` y por huella
    (tipo + contenido + ventana de tiempo). Puede coexistir con n8n sin crear
    mensajes repetidos.
  - **Respeta al CRM:** no toca `archivada`, `no_leidos`, `ultimo_leido_en`,
    `agente_activo`, `grupo`, `estado`, `nombre_manual`, notas, etc.
- **`GET/POST /api/chatwoot/sync`**: ejecuta la sincronización.
  - `?conversacionId=<id de Chatwoot>` → sincroniza un solo chat.
  - `?completa=1` → baja historial de todas las conversaciones (reparación).
- **`POST /api/chatwoot/webhook`**: webhook directo de Chatwoot a Vercel.

### 2. El dashboard se sincroniza solo (v2: objetivo 1–2 segundos)
- Al **abrir la app** sincroniza con Chatwoot (pasada completa, silenciosa).
- **Chat abierto: cada 2,5 s** (sólo ese chat; si no hay novedades, el servidor
  lo resuelve en 1 llamada a Chatwoot + 1 lectura a Supabase).
- **Bandeja: cada 5 s** en modo delta (`?rapido=1`): lista Chatwoot de 100 por
  página + un mapa único de Supabase; los chats sin cambios cuestan 0 consultas.
- Pasada **completa de reparación** al volver a la app y cada 3 minutos.
- El **webhook directo** (`/api/chatwoot/webhook`) es ahora el camino principal:
  inserta el mensaje y actualiza el resumen **en paralelo**, con dedupe por
  ventana ±150 s + id exacto (antes descargaba 400 mensajes por uno). Con el
  webhook puesto, el mensaje está en el dashboard en **<1 s**; sin él, el
  sondeo rápido lo trae en 2–3 s.
- Los sondeos ya no escriben en Supabase cuando nada cambió: cero eventos
  realtime vacíos, la lista del teléfono deja de recargarse cada 20 s.
- Botón **🔄 Chatwoot** junto al buscador para sincronizar a mano (completa).
- El realtime de Supabase sigue igual (notificaciones, contadores rojos):
  la sincronización inserta en las mismas tablas, así que las notificaciones
  y el "Por leer" funcionan como siempre.

### 3. n8n blindado (por si sigue usándose)
El nodo "Sincronizar Supabase" del workflow ahora **degrada en vez de
abortar**: si un update falla por una columna pendiente, lo omite y guarda el
mensaje igual; reintenta con payload mínimo en clientes/conversaciones; trata
el 409-duplicado como "ya guardado por otra vía". Regenerado con
`npm run build:luna` y validado: **184 pruebas, 0 fallos**.

#### 📥 Importar el workflow actualizado en n8n (sin editar nada dentro de n8n)
El repo no se conecta a tu n8n y tu n8n no puede usar `$env`, así que el
archivo importable lleva **toda la configuración por dentro**:

1. Descarga **`n8n/IMPORTAR-EN-N8N.RELLENAR.json`** (está en el repo).
2. Ábrelo con un editor de texto (Bloc de notas / VS Code) y reemplaza
   (**Ctrl+H**, "Reemplazar todo"):
   - `AQUI_OPENAI_API_KEY` → tu llave de OpenAI (`sk-...`). Es la misma que
     tiene hoy tu nodo "OpenAI Respuesta" del workflow viejo (ábrelo, copia el
     valor del header `Authorization` sin la palabra "Bearer ", o consíguela en
     platform.openai.com).
   - `AQUI_GROQ_API_KEY` → tu llave de Groq (la del nodo "Transcribir Audio";
     consíguela en console.groq.com).
   - Guarda. (La llave del audio de Luna, `sk-fish-...`, ya va embebida.)
3. En n8n: **Workflows → ⋯ (o "..." del menú) → Import from File** → elige el
   archivo. Se crea como workflow nuevo con los 61 nodos ya conectados.
4. **Desactiva el workflow viejo de Luna** (toggle Off). Importante: los dos
   usan el mismo webhook `chatwoot-mensaje` y n8n no permite dos activos con la
   misma ruta — desactiva el viejo ANTES de activar el nuevo.
5. **Activa el nuevo** (toggle On). La URL del webhook de Chatwoot **no cambia**
   (misma ruta), así que no tocas nada en Chatwoot.
6. Borra el workflow viejo cuando compruebes que el nuevo responde.

Si prefieres que el archivo se genere ya con tus llaves (para el futuro):
crea `n8n/luna/secrets.local.json` con
`{"OPENAI_API_KEY": "sk-...", "GROQ_API_KEY": "gsk_..."}` y corre
`npm run build:luna` → genera `n8n/IMPORTAR-EN-N8N.json` listo para importar
(ese archivo no se versiona: el `.gitignore` lo excluye).

> Nota: con el arreglo del dashboard (puntos 1 y 2) este paso de n8n es
> **opcional** — el CRM ya recibe los mensajes aunque n8n siga con el nodo
> viejo o caído. Importarlo hace que n8n también deje de perder mensajes.

### 4. Migración de respaldo
`supabase/migrations/20260906_sincronizacion_directa_chatwoot.sql`
(idempotente): garantiza `chatwoot_message_id`, la RPC `sincronizar_no_leidos`
y la publicación realtime de `mensajes`/`conversaciones`/`clientes`.
**El código funciona aunque no se aplique**, pero conviene aplicarla.

---

## 👤 Qué hacer después del merge (2 minutos, opcional pero recomendado)

1. **Webhook instantáneo (imprescindible para clavar los 1–2 s):** en
   Chatwoot → Ajustes → Integraciones → Webhooks → añadir
   `https://templo-mistico-crm.vercel.app/api/chatwoot/webhook`
   con el evento **message_created** (y si puedes elegir más:
   `message_updated` y `conversation_created`; este endpoint los procesa de
   forma segura e idempotente). Con esto los mensajes aparecen en el dashboard
   al instante. Puede convivir con el webhook de n8n: no se duplican.
   🔐 *Recomendado:* define en Vercel la variable `CHATWOOT_WEBHOOK_SECRET`
   con un valor aleatorio y añade `?key=ESE_VALOR` a la URL del webhook; así
   sólo Chatwoot puede escribir en el CRM (cualquier intento sin la llave
   recibe 401). Si no defines la variable, el endpoint sigue abierto como
   antes.
2. **Aplicar la migración** `20260906_sincronizacion_directa_chatwoot.sql` en
   Supabase → SQL Editor (más las pendientes anteriores si aún no están).
3. **(Opcional) Importar el workflow blindado de n8n**: pasos en el punto
   "📥 Importar el workflow actualizado en n8n" de arriba.
4. Nada más. Vercel despliega solo con el merge a `main` y la APK carga la web
   (`server.url`), así que **no hay que reinstalar la APK**.

## 🧪 Prueba local del servidor de sincronización (sin desplegar)
```
node scripts/prueba-sincronizacion-rapida.mjs
```
Simula Chatwoot y PostgREST y verifica: pasada idle = 1 consulta a Chatwoot +
1 a Supabase (0 escrituras), webhook = ≤6 round-trips, reintentos idempotentes,
`message_updated` no inserta filas nuevas y la actividad nueva del cliente
invalida la caché anti-rebombe sola.

## 🧪 Cómo probar
1. Merge → esperar el deploy de Vercel (~1 min).
2. Abrir el CRM. En 20s o menos deben aparecer los chats con sus últimos
   mensajes y los pendientes en "Por leer".
3. Abrir un chat que estuviera vacío: el historial se llena desde Chatwoot.
4. Pedirle a alguien que escriba (o escribir desde otro WhatsApp): debe
   aparecer en 2–3 s con el sondeo rápido, y en <1 s si configuraste el
   webhook del punto 1. Con un chat abierto, el sondeo puntual (2,5 s) pinta
   además el historial completo aunque n8n esté caído.
