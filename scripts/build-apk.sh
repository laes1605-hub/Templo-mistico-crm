#!/bin/bash
# Script para generar APK debug de Templo Místico CRM
# Uso: bash scripts/build-apk.sh [url]
# Ejemplo: bash scripts/build-apk.sh https://tu-app.vercel.app

set -e

URL=${1:-""}
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "🔮 Templo Místico CRM - Generador APK"
echo "====================================="

if [ -n "$URL" ]; then
  echo "🌐 Configurando server.url a: $URL"
  # Actualizar capacitor.config.json con URL
  cat > capacitor.config.json <<EOF
{
  "appId": "com.templomistico.crm",
  "appName": "Templo Místico CRM",
  "webDir": "out",
  "bundledWebRuntime": false,
  "server": {
    "url": "$URL",
    "cleartext": true,
    "androidScheme": "https",
    "iosScheme": "https"
  },
  "plugins": {
    "SplashScreen": {
      "launchShowDuration": 2000,
      "backgroundColor": "#090d16"
    },
    "StatusBar": {
      "style": "DARK",
      "backgroundColor": "#090d16"
    }
  },
  "android": {
    "allowMixedContent": true,
    "captureInput": true
  }
}
EOF
else
  echo "📦 Modo estático (sin URL) - Se usará carpeta out"
  echo "⚠️  Recuerda que las API no funcionarán offline sin server.url"
fi

echo ""
echo "📦 Instalando dependencias..."
npm install

echo ""
echo "🏗️  Building Next.js..."
npm run build

# Si hay carpeta out (export estático), copiar
if [ -d "out" ]; then
  echo "✅ Carpeta out encontrada"
else
  echo "ℹ️  No hay carpeta out (modo server). Creando carpeta vacía para Capacitor..."
  mkdir -p out
  echo "<html><body><h1>Templo Místico CRM</h1><p>Cargando...</p></body></html>" > out/index.html
fi

echo ""
echo "🔄 Sincronizando con Android..."
npx cap copy android
npx cap sync android

echo ""
echo "🔨 Compilando APK debug..."
cd android
if [ -f "./gradlew" ]; then
  chmod +x ./gradlew
  ./gradlew assembleDebug
  echo ""
  echo "✅ APK generado en:"
  echo "   android/app/build/outputs/apk/debug/app-debug.apk"
  ls -lh app/build/outputs/apk/debug/app-debug.apk
else
  echo "❌ No se encontró gradlew. Abre Android Studio manualmente:"
  echo "   npx cap open android"
  echo "   Luego Build > Build APK"
fi

cd "$ROOT_DIR"
echo ""
echo "🎉 ¡Listo! Instala el APK en tu celular"
echo "   adb install android/app/build/outputs/apk/debug/app-debug.apk"
