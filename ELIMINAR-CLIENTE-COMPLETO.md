# 🗑️ Eliminar cliente completo (CRM + Supabase + WhatsApp + fichas de Luna)

El botón **Eliminar** (🗑️) de cualquier conversación borra **todo** lo que el sistema
sabe de ese número, no sólo la tarjeta del chat. Cuando el cliente vuelva a
escribir, entra como **lead nuevo**: sin etapa, sin notas, sin pagos y con las
fichas de Luna reiniciadas.

## Qué se borra y en qué orden

**1. WhatsApp / Chatwoot** (la memoria de Luna vive aquí, no en Supabase)

| Dato | Cómo se borra |
| --- | --- |
| La conversación entera (historial, fotos, audios) | `DELETE /conversations/:id` |
| **Fichas de Luna** (notas privadas `🔎 Ficha de Luna`) | se van con la conversación; si no hay permiso, se borran una a una |
| `custom_attributes` = el archivo de Luna (motivo del caso, categoría, nombres, fotos, `fotos_pendientes`, `luna_etapa`) | se vacían todas las claves (texto → `""`, booleanos → `false`, listas → `[]`), incluidas claves que no conozcamos |
| Etiquetas de la conversación | `POST /labels` con lista vacía |

> ⚠️ Este paso es el importante: mientras los `custom_attributes` existan, Luna
> **sigue sabiendo** el motivo, los nombres y las fotos, y el workflow n8n
> `Sincronizar Supabase` los re-copia al cliente nuevo (`tipo_trabajo`,
> `nombre_otra_persona`, `foto_otra_persona`, `foto_mano`).

**2. Supabase** (función `public.eliminar_cliente_completo(uuid)`)

La función recorre **todas** las tablas del esquema `public` que tengan columna
`cliente_id` o `conversacion_id` y borra las filas de ese cliente. Hoy eso cubre:
`mensajes`, `pagos`, `tareas`, `recordatorios_whatsapp`, `cerebro_reglas`,
`notas_internas`… y cualquier tabla que agregues después (no hay que tocar la
función). Al final borra `conversaciones` y la fila de `clientes`.

Todo corre en una sola transacción: si algo falla, el cliente no queda borrado a
medias.

## Por qué el cliente vuelve a entrar como nuevo

El nodo **Sincronizar Supabase** del workflow de Luna busca el cliente por
teléfono (`clientes?telefono=eq.+57…`). Como la fila ya no existe, crea un cliente
nuevo, una conversación nueva y el lead arranca en **Lead Nuevo**. Con los
`custom_attributes` vacíos, Luna vuelve a preguntar el motivo desde cero.

## Instalación

1. **Supabase → SQL Editor → New query → Run**
   `supabase/migrations/20260905_eliminar_cliente_total.sql`
   (reemplaza la versión de `20260904_eliminar_cliente_completo.sql`).
   Si no la aplicas, el CRM igual borra tabla por tabla, pero no las tablas nuevas.

2. **Variables en Vercel** (opcional, pero recomendado):

   | Variable | Valor |
   | --- | --- |
   | `CHATWOOT_URL` | URL de tu Chatwoot (ej. `https://tu-chatwoot.duckdns.org`) |
   | `CHATWOOT_API_TOKEN` | Token de un usuario **administrador** de Chatwoot |
   | `CHATWOOT_ACCOUNT_ID` | `1` |
   | `SUPABASE_SERVICE_ROLE_KEY` | La service role key del proyecto |

   Ya NO hay token de respaldo en el código. Sin `CHATWOOT_API_TOKEN` el botón de borrado
   no autentica contra Chatwoot, así que configuralo en Vercel.
   `n8n/luna/code/*.js`. Si ese token no tiene rol administrador, Chatwoot no
   deja borrar la conversación: el CRM entonces **vacía la memoria de Luna**
   (atributos + fichas privadas + etiquetas) y deja el historial del chat, y te lo
   avisa en el modal.

## Comportamiento del modal

- **Confirmación** → explica que se borra el CRM, Supabase, el chat de WhatsApp y
  las fichas de Luna.
- **Resultado** → muestra qué se borró de cada lado (conversaciones, mensajes,
  pagos, tareas, recordatorios, reglas del Cerebro, chats de WhatsApp, fichas de
  Luna) y cualquier advertencia.
- **Bloqueo de Chatwoot** → si WhatsApp no se dejó limpiar, **no se borra nada**
  y se ofrece el botón **“Eliminar solo del CRM”** para continuar a conciencia.

## Pruebas

```bash
npm run test:eliminar       # endpoint /api/clientes/eliminar + limpieza de Luna
                            # (Chatwoot y Supabase simulados, sin dependencias extra)
npm run test:eliminar:sql   # la función SQL contra un PostgreSQL real
                            # (necesita: npm i -D embedded-postgres @embedded-postgres/linux-x64 pg)
```

## Archivos

| Archivo | Qué hace |
| --- | --- |
| `src/app/api/clientes/eliminar/route.ts` | Orquesta el borrado: primero Chatwoot, después Supabase |
| `src/lib/chatwoot.ts` | Borra la conversación / vacía la memoria de Luna |
| `supabase/migrations/20260905_eliminar_cliente_total.sql` | Función SQL de borrado total |
| `src/app/page.tsx` | Botón 🗑️, modal de confirmación, resumen del resultado |
