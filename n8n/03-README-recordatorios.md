# Recordatorios de WhatsApp API por etapa

Archivos:

- `03-recordatorios-whatsapp-por-etapa.json`: workflow importable en n8n.
- `supabase/migrations/20260825_recordatorios_whatsapp_etapa.sql`: tabla de auditoría e idempotencia.

## Instalación

1. Ejecuta la migración en Supabase SQL Editor.
2. En n8n configura estas variables de entorno (no las pegues dentro del JSON):

```text
CHATWOOT_URL=https://crmesteban.duckdns.org
CHATWOOT_API_TOKEN=tu_token_nuevo
CHATWOOT_ACCOUNT_ID=1
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
```

3. Importa el JSON, prueba manualmente con un contacto de prueba y después actívalo.
4. Como el token y las claves del workflow anterior quedaron expuestos en el mensaje, revócalos y genera nuevos antes de producción.

## Comportamiento

- Consulta únicamente conversaciones abiertas de Chatwoot vinculadas en Supabase a `fuente=meta_business` y `grupo=templo`.
- Solo actúa sobre estas tres etapas:
  - **Lead nuevo**: `nuevo_lead`, `nuevo_lead_templo`, `lead_nuevo`.
  - **Datos**: `datos`, `datos_templo`, `solicitar_datos`, `solicitud_datos`, `en_datos`.
  - **No contesta**: `no_contesta`, `no_contesta_templo`, `nocontesta`.
- Solo envía si el último mensaje es entrante. Así no responde encima de un mensaje del asesor.
- Envía como máximo tres mensajes por etapa, aproximadamente después de 1, 8 y 24 horas del último mensaje entrante.
- No envía a spam, perdidos, `bot-pausado` ni `recordatorios-pausados`.
- Registra cada envío en `recordatorios_whatsapp`; la restricción única evita duplicados del mismo día, etapa e intento.
- No cierra ni marca como perdido automáticamente a ningún cliente.

Si tus claves reales de etapa son distintas, agrégalas al objeto `ETAPAS` del nodo **Buscar clientes y preparar recordatorio**.
