# Build Info - Templo Místico CRM

**Fecha:** Sun Aug 24 23:31 UTC 2026
**Commit:** (ver git log — build desde rama `arena/01a035ee-templo-mistico-crm`)
**Branch:** arena/01a035ee-templo-mistico-crm

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
- Version: 1.1.0 (definida en `package.json` y usada por Android)
- WebDir: out · La APK carga https://templo-mistico-crm.vercel.app (server.url)
  → los cambios web van live con el deploy de Vercel, sin rebuild del APK

## Migraciones pendientes (Supabase SQL Editor)
- supabase/migrations/20260829_nombre_manual_prioridad_telefono.sql
- supabase/migrations/20260830_enrutar_leads_por_numero.sql

## Nuevas funciones de este build
- Número de teléfono con prioridad sobre el nombre (formato +país, ej: +573054021111)
- Nombre manual editable (✏️) que es el único nombre que se muestra
- Pestaña "Por leer": chats de todas las categorías con mensajes sin leer
- Enrutado de leads por número: publicidad → Lead Nuevo del WhatsApp API Templo
- Mover de etapa sincroniza el grupo (Personal ↔ Templo)
