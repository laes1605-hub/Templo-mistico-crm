# Build Info - Templo Místico CRM

**Fecha:** Mon Aug 25 (rama `arena/01a036a2-templo-mistico-crm`)
**Commit:** (ver git log)
**Branch:** arena/01a036a2-templo-mistico-crm

## Build Next.js
- Comando: npm run build
- Output: .next/ (server) y out/ (static para APK)
- Tamaño .next: 86M
- Tamaño out: 736K
- Estado: ✅ compilación verificada (sin errores)

## APK (automática en GitHub Actions)
- Workflow listo: `ci/build-apk.yml` (hay que copiarlo a `.github/workflows/build-apk.yml`
  para activarlo — el token del agente no tiene permiso `workflows` en GitHub)
- Una vez activo, en cada push a `arena/**` o `main`: compila el APK debug en la
  nube, lo sube como artefacto y lo commitea en `apk/templo-mistico-crm-debug.apk`
- App ID: com.templomistico.crm
- App Name: Templo Místico CRM
- Version: 1.2.0 (definida en `package.json` y usada por Android; `versionCode` 3)
- WebDir: out · La APK carga https://templo-mistico-crm.vercel.app (server.url)
  → los cambios web van live con el deploy de Vercel, sin rebuild del APK

## Migraciones pendientes (Supabase SQL Editor)
- supabase/migrations/20260829_nombre_manual_prioridad_telefono.sql
- supabase/migrations/20260830_enrutar_leads_por_numero.sql
- supabase/migrations/20260902_luna_etapas_expediente.sql  ← nueva (Luna por etapas)
- supabase/migrations/20260903_mensajes_id_chatwoot.sql   ← nueva (mensajes perdidos)
- supabase/migrations/20260904_eliminar_cliente_completo.sql (eliminación completa v1)
- supabase/migrations/20260905_eliminar_cliente_total.sql   ← nueva (eliminación total v2)

## Luna por etapas (nuevo)
- Workflow importable: `n8n/05-luna-etapas.json` (docs en `n8n/05-README-luna-etapas.md`)
- Luna solo responde en Lead Nuevo, Sin respuesta, Datos y Por consulta; en el resto se calla
- Motor de etapas + archivo persistente (motivo, tipo de trabajo, nombres y fotos) para que
  Luna no vuelva a pedir lo que ya le entregaron
- Verificación: `npm run check:luna` (184 pruebas sobre el código real de los nodos) — ✅ 0 fallos
- Regenerar: `npm run build:luna` → `IMPORTAR-EN-N8N.json` (importar en n8n, llaves dentro,
  sin versionar) y `05-luna-etapas.github.json` (versionado, sin secretos, usa $env)
- El n8n del Templo tiene N8N_BLOCK_ENV_ACCESS_IN_NODE: por eso el archivo importable
  lleva las llaves dentro y no usa $env

## Nuevas funciones de este build
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
- Guardar el contacto directamente en la agenda Android (o descargar vCard en web/PWA)
