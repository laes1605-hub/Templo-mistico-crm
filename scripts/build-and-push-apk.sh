#!/usr/bash
# ============================================================
# Templo Místico CRM — Build APK + subirlo al repositorio
#
# Uso:
#   bash scripts/build-and-push-apk.sh
#
# Qué hace:
#   1. Verifica JDK y Android SDK
#   2. Sincroniza Capacitor (npx cap sync android)
#   3. Compila el APK debug (./gradlew assembleDebug)
#   4. Copia el APK a apk/templo-mistico-crm-debug.apk
#   5. Commitea y sube el APK a la rama actual
#
# Nota: la APK carga tu URL de Vercel (server.url), así que NO
# se necesita reconstruir la web (next build).
# ============================================================

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "🔮 Templo Místico CRM — Build APK + push"
echo "=========================================="

# ---------- 1. Verificar entorno ----------
if ! command -v java >/dev/null 2>&1; then
  echo "❌ No se encontró java. Instala JDK 17/21 o exporta JAVA_HOME."
  exit 1
fi
echo "☕ Java: $(java -version 2>&1 | head -1)"

SDK_DIR=""
if [ -f android/local.properties ]; then
  SDK_DIR=$(grep '^sdk.dir=' android/local.properties | cut -d= -f2-)
fi
if [ -z "$SDK_DIR" ] && [ -n "$ANDROID_HOME" ]; then
  SDK_DIR="$ANDROID_HOME"
fi
if [ -z "$SDK_DIR" ] && [ -n "$ANDROID_SDK_ROOT" ]; then
  SDK_DIR="$ANDROID_SDK_ROOT"
fi
if [ -z "$SDK_DIR" ] && [ -d "$HOME/Android/Sdk" ]; then
  SDK_DIR="$HOME/Android/Sdk"
fi
if [ -z "$SDK_DIR" ]; then
  echo "❌ No se encontró el Android SDK. Instala Android Studio o define ANDROID_HOME."
  exit 1
fi
echo "🤖 Android SDK: $SDK_DIR"

# ---------- 2. Dependencias + sync ----------
if [ ! -d node_modules ]; then
  echo "📦 npm install..."
  npm install
fi
[ -d out ] || mkdir -p out   # webDir requerido por Capacitor (la APK carga Vercel)
echo "🔄 npx cap sync android..."
npx cap sync android

# ---------- 3. Compilar ----------
echo "🔨 ./gradlew assembleDebug (puede tardar varios minutos)..."
cd android
chmod +x ./gradlew
./gradlew assembleDebug
cd "$ROOT_DIR"

APK_SRC="android/app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "$APK_SRC" ]; then
  echo "❌ No se generó el APK en $APK_SRC"
  exit 1
fi

# ---------- 4. Copiar al repo ----------
mkdir -p apk
cp "$APK_SRC" apk/templo-mistico-crm-debug.apk
echo "✅ APK: $(du -h apk/templo-mistico-crm-debug.apk | cut -f1)  →  apk/templo-mistico-crm-debug.apk"

# ---------- 5. Commit + push ----------
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git add -f apk/templo-mistico-crm-debug.apk
if git diff --cached --quiet; then
  echo "ℹ️  El APK no cambió, no hay nada que commitear."
  exit 0
fi
git commit -m "build: APK debug con permisos de micrófono, cámara, galería y memoria"
git push origin "HEAD:$BRANCH"
echo "🎉 APK subida a la rama $BRANCH (apk/templo-mistico-crm-debug.apk)"
