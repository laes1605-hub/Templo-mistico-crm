# Recordatorios de WhatsApp API por etapa

El JSON es un **workflow completo e independiente**. En n8n se importa como workflow
nuevo y se desactiva el anterior para no duplicar envíos.

Archivos:

- `03-recordatorios-whatsapp-por-etapa.json`: workflow importable en n8n (se genera con `npm run build:recordatorios`).
- `recordatorios/CODIGO-PARA-PEGAR.md`: **los tres nodos completos con las llaves dentro**, para copiar y pegar a mano en n8n.
- `recordatorios/code/*.js`: código real de los tres nodos Code (aquí se edita, no dentro del JSON).
- `scripts/simular-recordatorios.mjs`: prueba en seco con los datos reales (`npm run simular:recordatorios`).
- `scripts/prueba-recordatorios.mjs`: 88 pruebas sobre el código de los nodos (`npm run test:recordatorios`).
- `supabase/migrations/20260825000002_recordatorios_whatsapp_etapa.sql`: tabla de auditoría e idempotencia (ya viene incluida en `MIGRAR-A-NUEVO-SUPABASE.sql`, bloque `[04/26]`).

---

## ⚠️ Arreglo del 19/09/2026: por qué no llegaban los recordatorios

**Causa 1 (la que dejaba el workflow mudo): las conexiones del bucle estaban al revés.**

El nodo **Procesar uno a uno** («Loop Over Items / Split in Batches») tiene dos
salidas y en este orden: **0 = done**, **1 = loop**. En el código fuente de n8n
(`SplitInBatchesV3`) los ítems salen por `loop` y `done` entrega un **arreglo
vacío** hasta que el bucle termina:

```ts
outputNames: ['done', 'loop'],
...
return [[], returnItems];   // done = [] · loop = los ítems
```

El workflow tenía el envío conectado a **done** (vacío) y **loop** apuntando al
propio nodo, así que n8n nunca ejecutaba el envío: **no salía ningún mensaje**.

Correcto:

```
Procesar uno a uno · loop (abajo)  →  Enviar por WhatsApp API  →  Registrar envío  →  vuelve al bucle
Procesar uno a uno · done (arriba) →  (sin conectar)
```

Desde ahora `npm run build:recordatorios` **fuerza esas conexiones y falla** si
alguien las vuelve a invertir, y las pruebas simulan el bucle completo.

**Causa 2: las etapas se buscaban con un filtro que ya no aplicaba.**

Los recordatorios dejaron de registrarse el **10/09/2026**. El workflow buscaba la etapa así:

```text
pipeline_etapas?grupo=eq.templo     ← y luego comparaba por nombre
```

…y el CRM **crea y edita las etapas con `grupo = 'general'`**
(`src/app/page.tsx`, `agregarEtapaPipeline`). Al unificar el pipeline, la etapa
**Datos** quedó en `general`, el workflow no la reconocía y no enviaba nada.
Además exigía `clientes.grupo = 'templo'`, lo que dejaba fuera a la mitad de los
candidatos cuando el operador cambiaba el chat de cartera.

Ahora:

1. Las etapas se reconocen **solo por su NOMBRE, en todo el pipeline** (sin filtrar por grupo).
2. El canal lo decide la **conversación** (`fuente = 'meta_business'`), no `clientes.grupo`.
3. Si falta una etapa, el workflow **no revienta**: lo dice en el ítem de diagnóstico.
4. Las credenciales van **escritas dentro del nodo** (esta instancia de n8n no permite variables de entorno).
5. Si la **ventana de 24 h** del WhatsApp API ya venció, no se intenta el envío (Meta rechaza el texto libre): ese chat se atiende por el WhatsApp Personal.

---

## Instalación (proyecto Supabase nuevo)

1. En Supabase → SQL Editor, ejecuta `MIGRAR-A-NUEVO-SUPABASE.sql` (idempotente) o, si solo faltara la tabla:
   `supabase/migrations/20260825000002_recordatorios_whatsapp_etapa.sql`.
2. Importa `03-recordatorios-whatsapp-por-etapa.json` **o** pega el código de los tres nodos
   desde `recordatorios/CODIGO-PARA-PEGAR.md`.
   Las **llaves van escritas dentro de cada nodo**: esta instancia de n8n no permite
   variables de entorno, así que no hay nada que configurar fuera del código.
   Cambiar de proyecto Supabase = editar en los tres nodos solo estas dos líneas:

   ```js
   const SUPABASE_URL = 'https://zcljlddtcoyfyvshlyfk.supabase.co';
   const SUPABASE_SERVICE_ROLE_KEY = 'eyJ...';
   ```

3. Ejecútalo a mano una vez (botón **Execute Workflow**) y revisa la salida del primer nodo.
4. Actívalo. **Desactiva el workflow anterior** de recordatorios para no duplicar envíos.
5. Revoca y regenera los tokens que quedaron escritos en el repositorio.

### Requisitos que debe cumplir el proyecto

| Pieza | Qué se necesita |
| --- | --- |
| `pipeline_etapas` | Una etapa llamada **Datos** y otra llamada **Sin respuesta** o **No contesta** (el nombre visible; la clave da igual) |
| `conversaciones` | La fila de Chatwoot con `chatwoot_conversation_id` y `fuente = 'meta_business'`, enlazada a su cliente |
| `clientes` | `estado` con la etapa, `es_spam = false` |
| `recordatorios_whatsapp` | Tabla de auditoría (la crea la migración) |

---

## Prueba en seco (ver qué va a enviar, sin enviar nada)

```bash
npm run simular:recordatorios
```

Consulta Supabase y muestra tres listas: **lo que saldría ahora** (cliente, etapa,
horas sin responder, qué plantilla y cuántos envíos lleva), **lo que espera tiempo**
(con cuánto falta) y **lo que no se toca** (fuera de la ventana de 24 h del WhatsApp
API → se atienden por el WhatsApp Personal). Las reglas no están escritas en el
simulador: se extraen del propio workflow, así que no pueden desincronizarse.

## Comportamiento

- Revisa solo **conversaciones abiertas** de Chatwoot (máx. 500) vinculadas en Supabase con `fuente = 'meta_business'`.
- **Lead nuevo queda excluido**: no recibe ningún recordatorio.
- Solo actúa en las etapas cuyo **nombre visible** sea **Datos** o **Sin respuesta / No contesta**: en cualquier otra etapa (incluido **Nuevo Lead**) no envía nada. El nombre se compara sin acentos ni mayúsculas y acepta sufijos («Datos (API)»).
- Busca la última respuesta entrante del cliente en los mensajes de Chatwoot. El cronómetro corre desde esa respuesta, aunque después haya respondido el agente.
- Envía como máximo **cuatro mensajes por cliente y etapa**: 30 min, 3 h, 12 h y 23 h 30 min.
- No envía si el chat tiene las etiquetas `recordatorios-pausados`, `lead-perdido`, `perdido` o `spam` (las etiquetas se comparan sin acentos y con cualquier separador: `recordatorios-pausados` = `Recordatorios Pausados`).
- **`bot-pausado` NO silencia el recordatorio** (a propósito): Luna deja esa etiqueta justo cuando envía la lista de requisitos y pasa el chat a **Datos**, es decir, marca exactamente a los clientes que deben recibir el recordatorio de datos. Vetarla dejaba fuera 102 chats abiertos del CRM. Si lo quieres al revés, agrega `bot_pausado` a `ETIQUETAS_SILENCIO` en el nodo 1.
- El diagnóstico final informa `etiquetasQueApagan` y el desglose `conteo.omitidas.porEtiqueta` para ver qué etiqueta está frenando envíos.
- No envía si la **ventana de 24 h** del WhatsApp API ya se cerró.
- Registra cada envío en `recordatorios_whatsapp`; la restricción única evita duplicados del mismo día, etapa, tipo e intento. Los envíos antiguos guardados como `sinRespuesta`, `noContesta` o `no_contesta` cuentan igual para no repetir.
- No cierra ni marca como perdido automáticamente a ningún cliente.

### El ítem de diagnóstico

Cada ejecución termina con un ítem con `_diagnostico: true` que **no se envía a nadie**.
Es la forma rápida de ver por qué no salió nada:
`etapasReconocidas`, `etapasDelPipeline`, `conteo.recordatoriosPreparados`,
`conteo.omitidas.*` (etiquetaSilencio, sinVinculoApi, archivada, spam,
etapaSinRecordatorio, sinMensajesEntrantes, yaCompletos, esperandoTiempo,
ventanaCerrada, sinTelefono, error) y `avisos`.

---

## Verificación cuando «no llegan»

1. **n8n → workflow → pestaña Executions**: debe haber una ejecución cada 15 minutos.
   Si no hay ninguna, el workflow está desactivado o el n8n no está corriendo.
2. Abre la última ejecución y mira la salida de **Buscar clientes y preparar recordatorio**:
   - `avisos` vacío y `conteo.recordatoriosPreparados > 0` → salió (revisa el nodo de envío).
   - `avisos` menciona una etapa → revisa Pipeline → Configurar etapas (nombre visible).
   - `errores` menciona `CHATWOOT` → token vencido o Chatwoot caído.
   - `conteo.omitidas.ventanaCerrada` alto → esos chats deben atenderse por WhatsApp Personal (etapa Vencidos).
3. En Supabase, confirma que hay envíos nuevos:

   ```sql
   select enviado_en, tipo, plantilla, etapa
     from public.recordatorios_whatsapp
    order by enviado_en desc
    limit 10;
   ```

4. Si el nodo de envío devuelve error, el motivo exacto de Chatwoot/Meta viaja en
   `error` (antes se perdía en los logs del servidor).

---

## Mantenimiento

```bash
npm run test:recordatorios   # 71 pruebas sobre el código real de los nodos
npm run build:recordatorios  # regenera el JSON importable desde recordatorios/code/*.js
```

Para usar otro nombre visible de etapa, agrégalo a `ETAPAS_RECORDATORIO` en
`n8n/recordatorios/code/buscar-y-preparar.js` (nunca la clave interna) y regenera el JSON.
