# Build Info - Templo Místico CRM

**Fecha:** Mon Aug 24 04:23:55 UTC 2026
**Commit:** 8a31e6f764fe3686f5eec790ed5d21e946b0243d
**Branch:** arena/01a031df-templo-mistico-crm

## Build Next.js
- Comando: npm run build
- Output: .next/ (server) y out/ (static para APK)
- Tamaño .next: 130M
- Tamaño out: 1.9M

## APK
- App ID: com.templomistico.crm
- App Name: Templo Místico CRM
- WebDir: out
- Android project: android/
- Para generar APK debug:
  ```bash
  npx cap open android
  # Build > Build APK en Android Studio
  # o
  cd android && ./gradlew assembleDebug
  ```
- APK output: android/app/build/outputs/apk/debug/app-debug.apk

## Migraciones
- Ejecutar en Supabase SQL Editor: supabase/migrations/20260825_fix_all.sql

## Nuevas funciones
- Notas personales en clientes
- Multi-divisa con comisión editable
- Total mes convertido a COP
