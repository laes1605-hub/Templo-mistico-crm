# 🧠 FASE 3 — CEREBRO IA (Auto-Aprendizaje de Ventas)

Luna deja de depender de un prompt estático. Ahora **analiza las conversaciones reales donde el cliente pagó o agendó**, extrae las técnicas que cerraron la venta, y te las muestra en el CRM para que las **apruebes con 1 clic**. Al aprobarlas, entran inmediatamente en su memoria.

---

## 📦 Lo que ya quedó hecho en el repositorio

| Archivo | Qué es |
|---|---|
| `supabase/migrations/20260824_fase3_cerebro_ia.sql` | Tablas `cerebro_reglas` + `cerebro_ejecuciones`, vista, RPCs, RLS y realtime |
| `src/lib/cerebro.ts` | Tipos, normalización, hash anti-duplicados, constructor del prompt |
| `src/lib/supabase-admin.ts` | Cliente Supabase de servidor (service role) |
| `src/lib/cerebro-auth.ts` | Auth por secreto compartido para n8n |
| `src/app/api/cerebro/route.ts` | GET / POST / PATCH / DELETE de reglas |
| `src/app/api/cerebro/memoria/route.ts` | **La inyección**: memoria aprobada lista para el prompt |
| `src/app/api/cerebro/extraer/route.ts` | **El extractor**: analiza ventas cerradas con OpenAI |
| `src/components/CerebroPanel.tsx` | Pestaña "Cerebro" con tarjetas interactivas |
| `n8n/01-cerebro-extractor-semanal.json` | Workflow semanal listo para importar |
| `n8n/02-cerebro-inyeccion-luna.json` | Fragmento para pegar en tu flujo de Luna |

---

# ✅ PASO A PASO (lo que tenés que hacer vos)

---

## PASO 1 · Supabase — Crear las tablas

1. Entrá a **Supabase → tu proyecto → SQL Editor → New query**.
2. Abrí el archivo `supabase/migrations/20260824_fase3_cerebro_ia.sql` del repositorio.
3. **Copiá TODO el contenido**, pegalo en el editor y tocá **Run**.
4. Deberías ver `Success. No rows returned`.

**Verificación** — Ejecutá esto en el mismo SQL Editor:

```sql
select count(*) from public.cerebro_reglas;   -- debe devolver 1 (la regla de ejemplo)
select public.cerebro_prompt_luna();          -- devuelve '' porque todavía no aprobaste nada
```

> El script es **idempotente**: podés volver a correrlo sin romper nada.

### 1.b — Copiar la Service Role Key

En **Supabase → Project Settings → API**, copiá:
- **Project URL**
- **`service_role` secret** (la clave larga que dice *service_role*, NO la anon)

⚠️ Esa clave es privada. Nunca la pongas en el frontend ni la subas al repo.

---

## PASO 2 · Vercel — Variables de entorno

En **Vercel → tu proyecto → Settings → Environment Variables**, agregá:

| Variable | Valor | Para qué |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | La `service_role` del paso 1.b | Que el CRM pueda aprobar/guardar reglas |
| `CEREBRO_API_SECRET` | Inventate una clave larga, ej: `templo_cerebro_2026_x9K2p` | Proteger los endpoints que usa n8n |
| `OPENAI_API_KEY` | *(ya la tenés)* | El extractor la usa para analizar |

Después tocá **Redeploy** para que tomen efecto.

> **¿No querés usar la service role?** En el SQL del Paso 1, descomentá el bloque
> "OPCIONAL" del punto 7 (políticas de escritura anónima) y volvé a correrlo.
> Es menos seguro, pero funciona igual.

---

## PASO 3 · Probar el CRM

1. Abrí tu CRM → pestaña **🧠 Cerebro**.
2. Vas a ver la tarjeta de ejemplo *"Nombrar el dolor antes del precio"* en **Por aprobar**.
3. Tocá **✅ Aprobar y enseñar a Luna** → la tarjeta pasa a **EN MEMORIA** (verde).
4. Tocá **Ver memoria** → ahí está el bloque de texto exacto que se le inyecta a Luna.

Si ves un aviso amarillo de *"Falta crear la tabla"*, volvé al Paso 1.

### Botón "Entrenar ahora"
Analiza tus ventas cerradas de los **últimos 30 días** y propone lecciones nuevas.
Si dice *"No se encontraron ventas cerradas"*, es normal: necesitás pagos marcados
como `pagado` o clientes en estado `pago_recibido` / `trabajo_proceso` / `agendado`.

---

## PASO 4 · n8n — Workflow del Extractor Semanal

### 4.a — Variables de entorno de n8n

En n8n → **Settings → Variables** (o en el `.env` de tu instancia), agregá:

```
CRM_URL=https://tu-crm.vercel.app
CEREBRO_API_SECRET=el_mismo_valor_que_pusiste_en_vercel
```

> Si tu n8n no soporta variables (`$env`), simplemente escribí la URL y la clave
> a mano dentro de cada nodo.

### 4.b — Importar el workflow

1. n8n → **Workflows → Import from File**.
2. Subí `n8n/01-cerebro-extractor-semanal.json`.
3. Abrí el workflow. Tiene 5 nodos:
   - `Cada lunes 4:00 AM` (Schedule Trigger)
   - `Probar manualmente`
   - `CRM · Extraer lecciones de ventas cerradas` ← llama a tu CRM
   - `¿Aprendió algo nuevo?`
   - `Armar reporte` / `Sin novedades`
4. Tocá **Probar manualmente → Execute Workflow**.
5. Revisá la salida del nodo HTTP. Deberías ver algo como:

```json
{ "ok": true, "analizadas": 4, "mensajes": 137, "nuevas": 5, "duplicadas": 1 }
```

6. **Activá el workflow** (toggle arriba a la derecha).

### 4.c — (Opcional) Notificación

Conectá un nodo de WhatsApp/Telegram/Email después de `Armar reporte`, usando
`{{ $json.resumen }}` como mensaje. Te avisa cada lunes cuántas lecciones nuevas
tenés esperando aprobación.

---

## PASO 5 · n8n — Inyección en el flujo de Luna ⭐

**Este es el paso que hace que Luna realmente aprenda.**

1. Importá `n8n/02-cerebro-inyeccion-luna.json` (es un **fragmento**, no un flujo completo).
2. Copiá los 2 nodos: **`Cerebro · Leer memoria`** y **`Construir System Prompt`**.
3. Pegalos dentro de tu **workflow actual de Luna**, justo **ANTES** del nodo de OpenAI / AI Agent.

El orden debe quedar así:

```
Webhook WhatsApp → (tu lógica actual) → Cerebro · Leer memoria → Construir System Prompt → OpenAI → Responder
```

4. Abrí el nodo **`Construir System Prompt`** y reemplazá la constante `PROMPT_BASE`
   por **el prompt de Luna que ya tenés funcionando hoy**:

```js
const PROMPT_BASE = `Eres Luna, la asesora espiritual del Templo Místico.
... acá va todo tu prompt actual, tal cual ...`;
```

5. En tu nodo de **OpenAI / AI Agent**, cambiá el *System Message* por:

```
={{ $json.systemPrompt }}
```

6. Guardá y mandá un mensaje de prueba por WhatsApp.
   En el nodo `Construir System Prompt` vas a ver `reglasActivas: 1` y el prompt
   final con el bloque `=== MEMORIA DE VENTAS APRENDIDA ===` ya incluido.

> 🛡️ **A prueba de fallos**: el nodo HTTP tiene `onError: continueRegularOutput`
> y timeout de 8s. Si el CRM está caído o la memoria está vacía, Luna responde
> igual con su prompt base. Nunca se rompe la atención al cliente.

---

# 🔌 Referencia de la API

### `GET /api/cerebro`
Lista reglas + estadísticas. Usado por el CRM.
```
?estado=pendiente|aprobada|rechazada|archivada|todos
?categoria=cierre&q=precio&limit=200
```

### `POST /api/cerebro` 🔒
Alta de reglas. Acepta `{ regla: {...} }` o `{ reglas: [...] }`.
```bash
curl -X POST https://tu-crm.vercel.app/api/cerebro \
  -H "x-cerebro-secret: TU_CLAVE" -H "Content-Type: application/json" \
  -d '{"reglas":[{"titulo":"Cerrar con fecha","regla":"Proponé siempre una fecha concreta para el ritual.","categoria":"cierre","confianza":0.9}]}'
```

### `PATCH /api/cerebro`
El "1 clic". `{ "id": "...", "accion": "aprobar" }`
Acciones: `aprobar` · `rechazar` · `reabrir` · `archivar`. También acepta `ids: []` para lotes.

### `DELETE /api/cerebro?id=...`
Borrado definitivo.

### `GET /api/cerebro/memoria` 🔒 — **la inyección**
```bash
curl "https://tu-crm.vercel.app/api/cerebro/memoria?format=text&track=1" \
  -H "x-cerebro-secret: TU_CLAVE"
```
| Parámetro | Default | Qué hace |
|---|---|---|
| `format` | `json` | `text` devuelve el bloque pelado |
| `limit` | `40` | Máximo de reglas |
| `track` | `0` | `1` incrementa `veces_usada` |
| `min_confianza` | `0` | Filtra por confianza mínima |
| `categoria` | — | Sólo una categoría |

### `POST /api/cerebro/extraer` 🔒 — **el extractor**
```json
{ "dias": 7, "maxConversaciones": 12, "maxReglas": 6, "dryRun": false }
```
`dryRun: true` analiza y te muestra las lecciones **sin guardarlas**.

🔒 = requiere header `x-cerebro-secret` (si configuraste `CEREBRO_API_SECRET`).

---

# 🧬 Cómo funciona el ciclo completo

```
1. Cliente paga  →  pagos.estado = 'pagado'
                     (o clientes.estado = 'pago_recibido' / 'agendado')
                              ↓
2. LUNES 4 AM · n8n dispara POST /api/cerebro/extraer
                              ↓
3. El CRM lee esas conversaciones ganadas de Supabase
   y se las manda a OpenAI: "¿qué técnica cerró esta venta?"
                              ↓
4. Las lecciones se guardan en cerebro_reglas (estado: pendiente)
                              ↓
5. VOS abrís la pestaña Cerebro y tocás ✅ Aprobar  ← 1 CLIC
                              ↓
6. La regla pasa a estado 'aprobada'
                              ↓
7. En el PRÓXIMO mensaje, n8n hace GET /api/cerebro/memoria
   y la regla ya viaja dentro del System Prompt de Luna
                              ↓
8. Luna cierra mejor  →  más pagos  →  vuelve al paso 1  ♻️
```

**Protecciones incluidas:**
- **Anti-duplicados**: hash SHA-256 del texto normalizado (sin tildes, sin mayúsculas, sin espacios de más). El extractor puede correr todas las semanas sin llenarte de repetidos.
- **Nada llega solo a Luna**: toda regla nace en `pendiente`. Sólo lo que vos aprobás entra a la memoria.
- **Trazabilidad**: cada regla guarda de cuántas conversaciones salió, con qué modelo, en qué ventana de días, y cuántas veces se inyectó.
- **Reversible**: podés archivar una regla aprobada y sale de la memoria al instante.

---

# 🧾 Estados y categorías

**Estados:** `pendiente` (esperando tu visto bueno) · `aprobada` (activa en Luna) · `rechazada` · `archivada` (fue aprobada y la sacaste).

**Categorías:** `cierre` · `objecion` · `precio` · `urgencia` · `empatia` · `agendamiento` · `seguimiento` · `confianza` · `descubrimiento` · `otro`.

---

# 🩺 Problemas comunes

| Síntoma | Solución |
|---|---|
| Aviso amarillo *"Falta crear la tabla"* | Ejecutá el SQL del Paso 1 |
| Apruebo y la tarjeta vuelve a pendiente | Falta `SUPABASE_SERVICE_ROLE_KEY` en Vercel (o habilitá la política anónima del SQL) |
| *"No se encontraron ventas cerradas"* | Marcá pagos como `pagado` o subí clientes a `pago_recibido`/`agendado`. Podés ampliar con `"dias": 90` |
| n8n devuelve `401` | El `CEREBRO_API_SECRET` de n8n no coincide con el de Vercel |
| Luna no cambia su forma de vender | Verificá que el System Message del nodo OpenAI sea `={{ $json.systemPrompt }}` y que tengas reglas **aprobadas** |
| *"Falta OPENAI_API_KEY"* | Agregala en Vercel y hacé Redeploy |
