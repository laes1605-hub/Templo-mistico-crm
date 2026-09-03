# Recordatorios de WhatsApp API por etapa

El JSON es un **workflow completo e independiente**. En n8n impórtalo como un workflow nuevo y desactiva el workflow anterior para no duplicar envíos.

Archivos:

- `03-recordatorios-whatsapp-por-etapa.json`: workflow importable en n8n.
- `supabase/migrations/20260825_recordatorios_whatsapp_etapa.sql`: tabla de auditoría e idempotencia.

## Instalación

1. Ejecuta la migración en Supabase SQL Editor.
2. En **`n8n/03-recordatorios-whatsapp-por-etapa.json`** reemplaza los marcadores (Ctrl+H / "Reemplazar todo"):
   - `https://TU-CHATWOOT.duckdns.org` → URL de Chatwoot (`https://tu-chatwoot.duckdns.org`)
   - `AQUI_CHATWOOT_API_TOKEN` → token nuevo de Chatwoot
   - `https://TU-PROYECTO.supabase.co` → URL del Supabase nuevo (`https://tu-proyecto.supabase.co`)
   - `AQUI_SUPABASE_SERVICE_ROLE_KEY` → service role del Supabase nuevo
   - `AQUI_MASTER_NUMBER` / `AQUI_EVOLUTION_API_KEY` / `AQUI_EVOLUTION_URL` si aparecen, colocar los valores nuevos
3. Importa el JSON, prueba manualmente con un contacto de prueba y después actívalo.
4. Como el token y las claves del workflow anterior quedaron expuestos en el mensaje, revócalos y genera nuevos antes de producción.

## Comportamiento

- Consulta únicamente conversaciones abiertas de Chatwoot vinculadas en Supabase a `fuente=meta_business` y `grupo=templo`.
- **Lead nuevo queda excluido**: no recibe ningún recordatorio.
- Solo actúa sobre las etapas del grupo Templo cuyo **nombre visible** sea **Datos** o **Sin respuesta**. También acepta **No Contesta** como nombre alternativo. Ya no depende de una lista fija de claves: consulta `pipeline_etapas` y relaciona dinámicamente el estado del cliente con el nombre configurado.
- Busca la última respuesta entrante del cliente en los mensajes de Chatwoot. El cronómetro se calcula desde esa respuesta, aunque después haya respondido el agente.
- Envía como máximo cuatro mensajes por cliente y etapa, a los 30 minutos, 3 horas, 12 horas y 23 horas 30 minutos desde la última respuesta del cliente.
- No envía a spam, perdidos, `bot-pausado` ni `recordatorios-pausados`.
- Registra cada envío en `recordatorios_whatsapp`; la restricción única evita duplicados del mismo día, etapa e intento.
- No cierra ni marca como perdido automáticamente a ningún cliente.

Los nombres se comparan sin distinguir mayúsculas, minúsculas ni acentos. Si usas otro nombre visible para una etapa, agrégalo a `NOMBRES_ETAPA` del nodo **Buscar clientes y preparar recordatorio**; no agregues la clave interna.
