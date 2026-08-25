# Luna por etapas · Lead Nuevo → Sin respuesta → Datos → Por consulta

Workflow importable: **`n8n/05-luna-etapas.json`** (generado por `n8n/build-luna-workflow.mjs`).

Luna ahora **solo habla en cuatro etapas** y en cada una hace una sola cosa. La etapa la
define el CRM (`clientes.estado`); Luna la lee, obedece y la mueve cuando corresponde.

| Etapa | Qué hace Luna | Qué tiene prohibido | Cuándo avanza |
|---|---|---|---|
| **Lead Nuevo** | Saluda, se presenta y abre el caso con una pregunta. | Pedir nombres, fotos o la palma. Hablar de agendar. | Siempre: al responder el saludo pasa a **Sin respuesta**. |
| **Sin respuesta** | Averigua **por qué viene** y si el trabajo es **personal** o **de pareja**. | Volver a saludar. Pedir datos antes de clasificar. | Cuando sabe motivo + tipo de trabajo → **Datos** (y en ese mismo mensaje ya pide el primer dato). |
| **Datos** | Pide **solo lo que falta** para agendar (nombres y fotos según el tipo). | **Volver a preguntar el motivo.** Repetir un dato ya guardado. Pedir la palma en pareja o datos de otra persona en personal. | Cuando el archivo dice que no falta nada → **Por consulta** (y avisa al Maestro). |
| **Por consulta** | Confirma que los datos ya están con el Maestro y **retiene** al cliente hasta la llamada. | Pedir cualquier dato, nombre, foto o motivo. Inventar horas de llamada o precios. | No avanza. Si llega algo nuevo, actualiza el expediente del Maestro. |

En cualquier otra etapa (Consulta Hecha, Pago Recibido, Trabajo en Proceso, Perdido, Spam…)
**Luna se queda callada**: el nodo `Luna Actua en esta Etapa?` corta el flujo.

---

## Cómo Luna deja de repetir lo que ya le dieron

Tres capas, de la más blanda a la más dura:

1. **Archivo persistente** (Chatwoot `custom_attributes` + espejo en Supabase `clientes`):
   `tipo_trabajo`, `motivo_categoria`, `motivo_resumen`, `motivo_conocido`, `nombre_cliente`,
   `nombre_otra_persona`, `foto_cliente`, `foto_otra_persona`, `foto_mano` y las URLs de cada foto.
   Lo guardado **nunca se sobreescribe**: si la IA devuelve otro nombre, gana el que ya estaba.
2. **Memoria inyectada en cada turno**: el prompt recibe la lista con ✅ RECIBIDO /
   ❌ PENDIENTE y la prohibición explícita de volver a preguntar el motivo.
3. **Auditor determinista** (`Pulir y Auditar Respuesta`): revisa la respuesta frase por frase.
   Si Luna pide algo que ya tiene, o algo prohibido en la etapa, **descarta esa respuesta y la
   reconstruye desde el archivo**. Es decir: aunque el modelo se equivoque, el mensaje que sale
   por WhatsApp es correcto.

El motivo se extrae con una llamada dedicada (`Analizar Caso con IA`, JSON estricto) en lugar de
las expresiones regulares antiguas, que eran las que perdían los nombres.

## Fotos: una sola fuente de verdad

`Preparar Imagen` → `Analizar Imagen` (GPT-4o-mini vision) → `Inyectar Analisis` clasifican la foto
en **rostro / pareja / palma / otro**, con conteo de personas, calidad y URL. `Fusionar Memoria`
la asigna sola según el tipo de trabajo:

- **Personal**: rostro → `foto_cliente`; palma → `foto_mano`. Nunca cuenta una tercera persona.
- **Pareja**: foto con dos personas → cubre `foto_cliente` **y** `foto_otra_persona` de una vez;
  rostro suelto → llena el primer hueco libre (cliente primero, luego la persona a consultar).
- Si la foto llega **antes** de saber el tipo de trabajo, queda en una cola (`fotos_pendientes`)
  y se asigna sola en cuanto se define el tipo. No se pierde.
- Cada foto guarda su URL: el expediente que recibe el Maestro incluye los enlaces.

Además Luna deja una **nota privada** en la conversación con la ficha del caso cada vez que
aprende algo nuevo, para que el Maestro la vea en el CRM.

---

## Instalación

1. Ejecuta `supabase/migrations/20260902_luna_etapas_expediente.sql` en el SQL Editor de Supabase.
   Agrega `motivo_consulta`, `motivo_categoria` y `luna_etapa` a `clientes`, y crea las etapas
   **Sin respuesta / Datos / Por consulta** solo si tu pipeline no las tiene ya con ese nombre.
2. **Importa `n8n/IMPORTAR-EN-N8N.json`** ← llaves dentro, no usa `$env`, cero configuración.

   | Archivo | Para qué |
   |---|---|
   | `n8n/IMPORTAR-EN-N8N.json` | **Importar en n8n.** Lleva las llaves dentro y no usa `$env`. No se sube a GitHub (contiene secretos). |
   | `n8n/05-luna-etapas.github.json` | Copia versionada en GitHub, sin secretos: lee `$env.OPENAI_API_KEY`. **No la importes**: tu n8n tiene `N8N_BLOCK_ENV_ACCESS_IN_NODE` y falla con `access to env vars denied`. |

   `npm run build:luna` regenera los dos. El importable se construye a partir de
   `n8n/luna/secrets.local.json` (ignorado por git):
   `{"OPENAI_API_KEY":"<tu llave de OpenAI>","GROQ_API_KEY":"<tu llave de Groq>"}`.
   El builder **falla** si el archivo importable llegara a quedar con `$env` o sin llaves.
3. **Desactiva el workflow anterior** y activa este.
4. Revisa los números y tokens en el nodo `Aplicar Transicion de Etapa`
   (`NUMERO_MAESTRO`, `INSTANCIA_MAESTRO`).
5. Prueba con un contacto tuyo: escríbele "hola" y verifica que salude y caiga en **Sin respuesta**.

> Las llaves de Chatwoot, Supabase, Evolution y Fish Audio siguen dentro del JSON (como en
> `03-recordatorios-whatsapp-por-etapa.json`). Quedaron expuestas al compartirse por chat:
> rótalas cuando puedas.


### Las etapas se reconocen por NOMBRE, no por clave

Tu CRM crea las etapas con `clave: etapa_<grupo>_<timestamp>` (`src/app/page.tsx`, función
`agregarEtapaPipeline`), así que la clave es un número que no dice nada. Por eso el workflow
lee `pipeline_etapas` en cada turno y reconoce la etapa **por su nombre**:

| Nombre de la etapa en el CRM | Etapa de Luna |
|---|---|
| Nuevo Lead / Lead Nuevo / Nuevo / Primer Contacto | Lead Nuevo |
| Sin respuesta / No contesta / Sin responder | Sin respuesta |
| Datos / Solicitar datos / Pedir datos | Datos |
| Por consulta / En consulta / Espera consulta / Por llamar | Por consulta |

No tienes que renombrar ni tocar claves. Si tu etapa se llama distinto, agrega **el nombre**
en `ETAPAS_EXTRA` del nodo `Leer Estado del Lead`:

```js
const ETAPAS_EXTRA = { "clientes_interesados": "datos" };
```

Al mover el lead, Luna escribe la clave real que corresponde a ese nombre dentro del grupo del
cliente (por eso un lead del Templo cae en `etapa_templo_...` y uno del personal en la suya).
Si la etapa destino no existe en el pipeline, **no inventa una clave**: deja el aviso en
`_debug.errorEstado`.

## Si Luna no responde y la ejecución se detiene en `Luna Actua en esta Etapa?`

No es un error: esa es la rama que **calla a Luna a propósito**. La ejecución sale
"successfully" porque la rama falsa termina ahí (ahora pasa por `Registrar Silencio de Luna`,
que deja el motivo en el log y, si la etapa no se reconoce, una nota privada en el chat).

Significa que **la etapa del lead en el CRM no es ninguna de las cuatro**. Para verlo:

1. Abre la ejecución en n8n y haz clic en el nodo **`Leer Estado del Lead`** (pestaña **Output**,
   no Input).
2. Mira `_debug.etapaLeidaDelCrm` (la clave guardada en el cliente),
   `_debug.nombreEtapaEnCrm` (el nombre de esa etapa) y `_debug.etapasDelGrupo`
   (todas las etapas que existen en tu CRM).

Dos soluciones, según el caso:

- **El lead está en una etapa posterior** (Consulta Hecha, Pago Recibido, Trabajo en Proceso,
  Perdido, Spam…): es correcto que Luna no hable. Muévelo a Lead Nuevo / Sin respuesta / Datos /
  Por consulta si quieres que lo atienda.
- **Tu etapa se llama distinto**: abre el nodo **`Leer Estado del Lead`** y agrega **el nombre**
  (no la clave) en `ETAPAS_EXTRA`:

  ```js
  const ETAPAS_EXTRA = {
    "clientes_nuevos": "lead_nuevo",   // Luna saluda y la pasa a Sin respuesta
    "interesados": "datos"             // Luna pide solo los datos que falten
  };
  ```

  Y si prefieres que Luna nunca se quede callada ante una etapa desconocida, cambia
  `ACTUAR_EN_ETAPA_NO_RECONOCIDA` a `true`: responde en modo retención (confirma y retiene,
  no pide datos).

> El audio, la foto o el texto no influyen en esa decisión: el corte es solo por etapa.

## Verificación

```bash
npm run check:luna      # node scripts/validar-workflow-luna.mjs
```

Ejecuta el **código real de los nodos** (no una copia) con un mock de n8n y revisa:
estructura y conexiones del JSON, normalización de etapas, clasificación de fotos,
asignación de huecos, auditor anti-repetidos, transiciones y un recorrido completo de un
lead de pareja turno a turno. `npm run build:luna` regenera el JSON desde
`n8n/luna/base-workflow.json` + `n8n/luna/code/*.js`.

---

## Fallas del workflow anterior que se corrigieron

1. **Doble respuesta con leads calientes**: `Detectar Cierre` enviaba el mensaje y además la rama
   de clasificación volvía a entrar a `Verificar si Enviar Audio`. El cliente recibía el mensaje
   dos veces. Ahora la clasificación es una rama lateral que termina.
2. **La visión no servía**: `Preparar Imagen` pedía un JSON (`{tipo, personas_visibles}`) pero
   `Inyectar Analisis` buscaba etiquetas `[PALMA_MANO]`/`[DOS_PERSONAS]`. Nunca coincidían:
   toda foto quedaba como "OTRO" y Luna volvía a pedirla.
3. **El análisis de la foto no llegaba al turno**: `Consolidar Lista` leía
   `$('Inyectar Analisis').json.body.content`, y ese `body` no existía en la respuesta de OpenAI.
4. **Las fotos del historial se adivinaban** leyendo texto `[IMAGEN ...]` que nadie escribía, así
   que `foto_cliente`/`foto_mano` casi nunca se marcaban como recibidas.
5. **Tokens de relleno**: `Detectar Cierre` usaba `TU_TOKEN_CHATWOOT` y `TU_APIKEY_EVOLUTION`,
   por lo que el aviso al Maestro y la etiqueta `consulta-pendiente` nunca se ejecutaban.
6. **El Cerebro IA se consultaba y se tiraba**: el nodo leía `/api/cerebro/memoria` pero el prompt
   no usaba esa respuesta. Ahora se inyecta en el system prompt.
7. **Prompt duplicado** (`code` y `Construir System Prompt` con el mismo texto): quedó uno solo.
8. **`pinData` en el nodo de envío**: en ejecuciones manuales devolvía datos falsos en vez de
   enviar. Se eliminó.
9. **Sin control de etapas**: nada leía ni movía `clientes.estado`.

## Ajustes rápidos

- **Mensaje de expediente al Maestro**: función `dossier()` en `n8n/luna/code/aplicar-transicion.js`.
- **Textos de respaldo de Luna** (los que se usan si el modelo se equivoca):
  `mensajeDeterminista()` en `n8n/luna/code/pulir-y-auditar.js`.
- **Personalidad y catálogo de interpretaciones** (amarres, dominio, entierros, limpiezas,
  prosperidad…): constante `CATALOGO` en `n8n/luna/code/construir-prompt.js`.
- **Anti-atasco**: si un lead llega a 5 mensajes sin que se sepa el tipo de trabajo, se asume
  `personal` y avanza a Datos (constante en `aplicar-transicion.js`).
