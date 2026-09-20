# Recordatorios de WhatsApp API por etapa

El JSON es un **workflow completo e independiente**. En n8n se importa como workflow
nuevo y se desactiva el anterior para no duplicar envíos.

Archivos:

- `03-recordatorios-whatsapp-por-etapa.json`: workflow importable en n8n (se genera con `npm run build:recordatorios`).
- `recordatorios/CODIGO-PARA-PEGAR.md`: **los tres nodos completos con las llaves dentro**, para copiar y pegar a mano en n8n.
- `recordatorios/code/*.js`: código real de los tres nodos Code (aquí se edita, no dentro del JSON).
- `scripts/simular-recordatorios.mjs`: prueba en seco con los datos reales (`npm run simular:recordatorios`).
- `scripts/prueba-recordatorios.mjs`: 116 pruebas sobre el código de los nodos (`npm run test:recordatorios`).
- `supabase/migrations/20260825000002_recordatorios_whatsapp_etapa.sql`: tabla de auditoría e idempotencia (ya viene incluida en `MIGRAR-A-NUEVO-SUPABASE.sql`, bloque `[04/26]`).

---

## ⚠️ Arreglo del 19/09/2026: por qué no llegaban los recordatorios

**Causa 1 (la última, la que dejaba pasar uno o dos mensajes): la lista de chats salía de Chatwoot.**

El primer nodo pedía la lista de chats a Chatwoot
(`/api/v1/accounts/1/conversations?status=open`, por páginas) y después hacía **una
consulta por chat**. Con **271 chats abiertos** eso son cientos de llamadas seguidas
en cada pasada y varias maneras de quedarse a medias: si Chatwoot devuelve menos
chats de los pedidos la lectura se corta, y si una llamada falla a mitad los chats
que faltaban no se revisan. La pasada terminaba atendiendo **al primer chat de la
lista** (Chatwoot ordena por actividad reciente) y dejaba fuera a todos los demás.

Comprobado contra el Supabase real el 19/09/2026: a las **19:35 UTC** se registró un
único envío (Esteban Rojas, plantilla 1, 31 min sin contestar) y a las **20:06** otro
(vicenta y gustavo, plantilla 1, 33 min) — en los dos casos el chat más reciente de
la lista. Mientras tanto había **9 clientes** en Datos/No contesta que ya cumplían su
tiempo (4,9 h · 5,1 h · 7,1 h · 7,3 h · 12,6 h · 19,3 h · 19,6 h · 21,1 h · 23,0 h) y
no recibieron nada.

Ahora **los candidatos salen de la propia base del CRM**, que es la que se actualiza
con cada mensaje del cliente:

- **una sola consulta** a `conversaciones` (`fuente = meta_business`) con su cliente
  (`clientes!inner`), sin listado de Chatwoot y sin una llamada por chat;
- el tiempo sin contestar se lee de `conversaciones.ultimo_entrante_api_en`;
- el teléfono y el nombre salen de la misma fila (`numero_whatsapp`, `clientes.nombre`).

Chatwoot se usa solo para **enviar** y para **verificar** la hora del último mensaje
cuando el CRM registró actividad posterior a ese entrante (son unas pocas llamadas,
no una por chat). Los nodos de envío y registro, además, recorrían un único ítem:
leían `$input.item` en vez de `$input.all()`; ahora procesan la tanda completa y el
workflow **no lleva el nodo «Procesar uno a uno» ni el bucle**, la cadena es
`Cada 15 minutos → Buscar → Enviar → Registrar`. El builder
`npm run build:recordatorios` **fuerza la cadena en línea, el modo «Run Once for All
Items» de los tres nodos Code y falla** si vuelve a aparecer un bucle.

**Causa 2: la variante no correspondía al tiempo sin contestar.**

Antes la plantilla se elegía por el número de recordatorios ya enviados: a quien
llevaba 14 h sin contestar y no había recibido ninguno le llegaba el texto del
primero. Ahora se elige por **tiempo sin contestar** (desde el último mensaje del
cliente):

| Tiempo sin contestar | Plantilla |
| --- | --- |
| 30 min – 3 h | 1 |
| 3 h – 12 h | 2 |
| 12 h – 23 h 30 | 3 |
| 23 h 30 – 24 h | 4 |

La misma plantilla **no se repite dentro de las 24 h** siguientes (el ciclo corre
cada 15 minutos) y la pasada tiene un tope de seguridad de **60 envíos**: lo que
sobra sale en la siguiente pasada.

**Qué reloj usa cada etapa (v5).**

| Etapa | Reloj | Canal |
| --- | --- | --- |
| Datos | desde el **último mensaje del cliente** | WhatsApp API (ventana de 24 h de Meta) |
| No contesta | desde que el chat **entró a la etapa** (`clientes.estado_desde`) | **WhatsApp Personal** (sin ventana) |

Para «No contesta» el CRM guarda la fecha de entrada con el trigger de
`supabase/migrations/20260921000002_estado_desde_recordatorios.sql`. Si esa
migración todavía no está corrida, el workflow funciona igual, cuenta desde el
último mensaje y lo avisa en `avisos` (`estadoDesdeDisponible = false`).
Los clientes de «No contesta» que ya existían toman como fecha de entrada su
último mensaje por el WhatsApp API, así nadie recibe un recordatorio de golpe.

**Causa 3: las etapas se buscaban con un filtro que ya no aplicaba.**

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
   En la página del puerto **4173** hay un botón **Copiar SQL** con lo que falte de los
   últimos arreglos: `20260922000001_restaurar_triggers_perdidos.sql` (repone los triggers
   que la migración de «duplicados» borraba — entre ellos el que calcula
   `respuestas_rapidas.huella`, cuyo error bloquea el botón «Sincronizar» del CRM) y
   `20260921000002_estado_desde_recordatorios.sql` (fecha de entrada a la etapa).
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
| `conversaciones` | La fila de Chatwoot con `chatwoot_conversation_id` y `fuente = 'meta_business'`, enlazada a su cliente, con `ultimo_entrante_api_en` (hora del último mensaje del cliente), `numero_whatsapp`, `archivada` y `silenciado` |
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

- Revisa **una sola vez** (sin listado de Chatwoot ni paginación) las filas de `conversaciones` con `fuente = 'meta_business'`. El diagnóstico avisa si esa lectura falla; no se depende del endpoint de Chatwoot para saber qué chats existen.
- **Lead nuevo queda excluido**: no recibe ningún recordatorio.
- Procesa **toda la tanda** de cada pasada (una sola ejecución por ciclo), sin bucle ni nodo «Procesar uno a uno».
- Solo actúa en las etapas cuyo **nombre visible** sea **Datos** o **Sin respuesta / No contesta**: en cualquier otra etapa (incluido **Nuevo Lead**) no envía nada. El nombre se compara sin acentos ni mayúsculas y acepta sufijos («Datos (API)»).
- El cronómetro corre desde `conversaciones.ultimo_entrante_api_en` (último mensaje **del cliente**), aunque después haya respondido el agente. Si el CRM registró actividad posterior a esa marca, se confirma la hora real contra los mensajes de Chatwoot.
- Elige la plantilla por el **tiempo sin contestar**: 30 min → 1 · 3 h → 2 · 12 h → 3 · 23 h 30 → 4. A quien lleva 14 h sin responder le llega la 3.ª, no la 1.ª.
- No repite la misma plantilla dentro de las 24 h siguientes y no pasa de **60 envíos por pasada** (el resto sale en la siguiente).
- **Ya no se leen etiquetas de Chatwoot.** El silencio lo decide el CRM: `conversaciones.silenciado = true`, el cliente marcado como `es_spam`, la conversación archivada o una etapa que no es de recordatorio.
- **`bot-pausado` no silencia** (a propósito, y ya no aplica): Luna deja esa etiqueta justo cuando envía la lista de requisitos y pasa el chat a **Datos**, es decir, marca exactamente a los clientes que deben recibir el recordatorio de datos. Vetarla dejaba fuera 102 chats abiertos del CRM. Para pausar los recordatorios de un chat, silencia la conversación en el CRM.
- No envía si la **ventana de 24 h** del WhatsApp API ya se cerró (en «No contesta» eso no aplica: va por el WhatsApp Personal).
- Registra cada envío en `recordatorios_whatsapp`; la restricción única evita duplicados del mismo día, etapa, tipo e intento. Los envíos antiguos guardados como `sinRespuesta`, `noContesta` o `no_contesta` cuentan igual para no repetir.
- No cierra ni marca como perdido automáticamente a ningún cliente.

### El ítem de diagnóstico

Cada ejecución termina con un ítem con `_diagnostico: true` que **no se envía a nadie**.
Es la forma rápida de ver por qué no salió nada:
`version` (confirma qué código está corriendo), `resumen` (una línea legible:
cuántos chats revisó, cuántos van a salir y por qué quedaron fuera los demás),
`fuenteDeDatos`, `pausasQueApagan`, `etapasReconocidas`, `etapasDelPipeline`,
`conteo.recordatoriosPreparados`, `conteo.omitidas.*` (sinVinculoApi, archivada,
silenciado, spam, etapaSinRecordatorio, sinConversacionChatwoot,
sinMensajesEntrantes, varianteYaEnviada, porLimite, esperandoTiempo, ventanaCerrada,
sinTelefono, verificacionFallida, error), `omitidasPorChat` (los primeros 25 chats
descartados con su motivo y sus horas) y `avisos`.

---

## Verificación cuando «no llegan»

1. **n8n → workflow → pestaña Executions**: debe haber una ejecución cada 15 minutos.
   Si no hay ninguna, el workflow está desactivado o el n8n no está corriendo.
2. Abre la última ejecución y mira el último ítem de **Buscar clientes y preparar recordatorio**
   (el del diagnóstico). Empieza por **`resumen`**: dice en una línea cuántos chats revisó,
   cuántos recordatorios van a salir y cuántos quedaron fuera por cada motivo. Después:
   - `version` debe contener `2026-09-19 · v5`: si no, ese nodo todavía tiene el código viejo.
   - `conteo.recordatoriosPreparados > 0` y `avisos` sin nada grave → salió (revisa el nodo de envío).
   - `avisos` menciona una etapa → revisa Pipeline → Configurar etapas (nombre visible).
   - `conteo.omitidas.ventanaCerrada` alto → esos chats deben atenderse por WhatsApp Personal (etapa Vencidos).
   - `conteo.omitidas.sinChatPersonal` alto → clientes de «No contesta» sin chat de WhatsApp Personal: no tienen por dónde recibir el aviso.
   - `estadoDesdeDisponible: false` → falta correr `20260921000002_estado_desde_recordatorios.sql`; «No contesta» está contando desde el último mensaje.
   - `conteo.enviadosPorPersonal` → cuántos de esta pasada salen por el WhatsApp Personal.
   - `omitidasPorChat` dice, chat por chat, por qué no salió (ventana vencida, ya enviado, en espera, silenciado…).
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
npm run test:recordatorios   # 116 pruebas sobre el código real de los nodos
npm run build:recordatorios  # regenera el JSON importable desde recordatorios/code/*.js
npm run test:sql-triggers    # 22 pruebas: ningún .sql deja un trigger borrado sin recrear
```

Para usar otro nombre visible de etapa, agrégalo a `ETAPAS_RECORDATORIO` en
`n8n/recordatorios/code/buscar-y-preparar.js` (nunca la clave interna) y regenera el JSON.
