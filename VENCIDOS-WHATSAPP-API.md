# Etapa "Vencidos": del WhatsApp API al WhatsApp Personal

Cuando la **ventana de 24 h del WhatsApp API** se cierra, ese número ya no deja
responder con texto libre (WhatsApp solo acepta plantillas aprobadas). Para no
perder la conversación, el CRM mueve el chat a la etapa **Vencidos**, que se
responde desde el **WhatsApp Personal**, y ahí se puede continuar hablando con
normalidad.

## Reglas (las cuatro juntas)

| # | Situación | Qué hace el CRM |
| --- | --- | --- |
| 1 | Está en una etapa que responde el **🌐 WhatsApp API** y la ventana de 24 h **ya venció** | Pasa solo a la etapa **⏰ Vencidos** (👤 WhatsApp Personal) |
| 2 | Está en una etapa que ya responde el **👤 WhatsApp Personal** | **No se toca**: ahí no hay ventana que vencer |
| 3 | El cliente **vuelve a escribir por el WhatsApp API** (la ventana se reabre) | **Regresa solo** a la etapa donde estaba antes de vencer |
| 4 | No hay marca del API en el chat (nunca escribió por ese número) | No se mueve |

Notas de comportamiento:

- El reloj se cuenta desde el **último mensaje del cliente por el WhatsApp API**
  (`conversaciones.ultimo_entrante_api_en`). Un mensaje del WhatsApp Personal no
  reabre la ventana del API, así que no provoca el regreso (ni un ping-pong).
- El traspaso se ejecuta **al abrir el CRM** (por eso mueve también el historial
  que ya estaba vencido, aunque sea de hace semanas) y **cada minuto** mientras la
  app está abierta, así los que vencen en el momento se van solos.
- Los chats **spam** y **archivados** no se mueven.
- La etapa **Vencidos no se puede borrar** desde Pipeline → Configurar etapas: la
  usa el traspaso automático.
- El chip rojo del chat (`cerrada hace 3 h`) sigue visible después del traspaso,
  para saber desde cuándo la ventana está cerrada.

## Pausar o reactivar

**Ajustes → «Traspaso automático a Vencidos»** (interruptor). Se guarda en
`config_general.vencidos_auto` (`true` por defecto).

- **Activado**: los chats vencidos pasan solos a Vencidos.
- **En pausa**: nada se mueve automáticamente; el operador los mueve a mano
  (mover a mano también deja memoria de la etapa anterior, así el regreso
  automático sigue funcionando).

## Mover a mano y volver a la etapa anterior

- Al mover un chat a Vencidos (menú **Cambiar etapa**, ficha del cliente o el
  selector del Pipeline), el CRM guarda la etapa anterior en
  `clientes.estado_antes_vencido` y **la borra** cuando el operador lo mueve a
  otra etapa distinta.
- Si el cliente escribe otra vez por el API, el chat vuelve a esa etapa (si la
  etapa todavía existe; si fue eliminada, el chat se queda en Vencidos).

## Qué se aplica en Supabase

`supabase/migrations/20260918_ventana_24h_whatsapp_api.sql`
→ `ultimo_entrante_en`, `ultimo_entrante_api_en`, índice parcial, trigger y
`recalcular_ultimos_entrantes()`.

`supabase/migrations/20260919_vencidos_a_whatsapp_personal.sql`
→ crea/normaliza la etapa `vencidos` (cuenta `evolution`), añade
`clientes.estado_antes_vencido`, un índice y la vista previa
`clientes_vencidos_whatsapp_api()`.

Sin la migración 20260919 la app sigue funcionando: el traspaso funciona (con
`estado_antes_vencido` no se rompe nada, solo se pierde el regreso automático a la
etapa anterior). Sin la 20260918 el traspaso también funciona, pero el cálculo se
limita a los chats con mensajes de los últimos 8 días (respaldo del dashboard) y
**no hay regreso automático**: con la marca aproximada, una respuesta del WhatsApp
Personal también parecería «reabrir» la ventana y el chat saltaría de vuelta a una
etapa del API. Por eso el regreso solo se activa con la marca exacta
(`ultimo_entrante_api_en`) que crea la 20260918.

### Seguridad si falta la migración

El traspaso **solo** mueve a la etapa Vencidos cuando esa etapa existe de verdad en
`pipeline_etapas`. Si la migración 20260919 todavía no está aplicada:

- La etapa Vencidos no aparece en el Pipeline ni en los filtros de Chats (no se
  inventa una etapa fantasma).
- El motor no mueve nada y deja un aviso en la consola del navegador
  («falta la etapa en la base de datos»).
- Así ningún chat puede quedar con un estado que no tenga columna en el pipeline.

### Vista previa desde SQL (opcional)

```sql
-- Clientes que el CRM movería a Vencidos en este momento
SELECT * FROM public.clientes_vencidos_whatsapp_api();
```

## Verificación

- `npm run test:tiempo` → 60 pruebas, incluidas las 4 reglas, la detección de la
  etapa (nombre singular/plural, acentos) y el canal del chat (API, unificado,
  solo Personal).
- `npx tsc --noEmit` ✅ · `npm run build` ✅
- Prueba manual: abre un chat del WhatsApp API que esté vencido y verifica que
  aparece en la pestaña **Vencidos** y que la barra dice
  «Responde desde: 👤 WhatsApp Personal».

## Preguntas frecuentes

**¿Y si el chat ya se estaba respondiendo desde el WhatsApp Personal?**
No pasa nada: solo se mueven los chats cuya etapa responde el API.

**¿Se pierde el historial al mover?**
No. Es un cambio de etapa del cliente; el chat, los mensajes, las notas, los
pagos y las fichas de Luna quedan intactos.

**¿Qué ve el cliente en WhatsApp?**
Nada: el movimiento es interno del CRM. Lo único que cambia es desde qué cuenta
le responde el operador.

**¿Vuelve a mover el chat si el cliente escribe por el API y luego la ventana
vence otra vez?**
Sí: al reabrirse la ventana regresa a su etapa del API, y cuando esa ventana
vuelve a vencer se traspasa otra vez a Vencidos.
