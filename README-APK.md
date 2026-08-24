# 📱 Convertir Templo Místico CRM en APK (Android)

Este proyecto ya está preparado para convertirse en APK usando **Capacitor**.

## 🚀 Opción 1: APK que carga tu web (Recomendada - Más fácil)

Esta opción crea una APK que abre directamente tu URL de Vercel/producción. Es la más estable porque no necesitas export estático.

### Pasos:

1. **Configura tu URL en `capacitor.config.json`**:
```json
{
  "appId": "com.templomistico.crm",
  "appName": "Templo Místico CRM",
  "webDir": "out",
  "server": {
    "url": "https://tu-dominio.vercel.app",
    "cleartext": true
  }
}
```
Reemplaza `https://tu-dominio.vercel.app` por tu URL real de Vercel.

2. **Instala Android Studio** (necesario para compilar APK):
   - Descarga: https://developer.android.com/studio
   - Instala SDK Android + Platform Tools

3. **Genera el proyecto Android**:
```bash
npm run cap:add:android
# o
npx cap add android
```

4. **Sincroniza**:
```bash
npm run cap:sync
# o
npx cap copy android
npx cap sync android
```

5. **Abre en Android Studio y compila**:
```bash
npm run cap:open:android
# Luego en Android Studio: Build > Build APK > Debug
# O por terminal:
cd android && ./gradlew assembleDebug
```

El APK quedará en: `android/app/build/outputs/apk/debug/app-debug.apk`

---

## 📦 Opción 2: APK 100% offline (Export estático)

Si quieres que la APK funcione sin internet (solo UI, sin API).

1. **Activa export en `next.config.js`**:
```js
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true }
}
```

2. **Build estático**:
```bash
npm run build:static
# Genera carpeta /out
```

3. **Configura Capacitor sin server.url**:
```json
{
  "appId": "com.templomistico.crm",
  "appName": "Templo Místico CRM",
  "webDir": "out"
}
```

4. **Compila APK igual que opción 1**

> ⚠️ Nota: Con export estático, las API routes `/api/*` no funcionarán offline. Necesitarías apuntar a un backend externo.

---

## 🎨 Iconos y Splash

Ya tienes:
- `public/manifest.json` configurado
- `public/icons/icon-512x512.png` (y demás tamaños)
- `capacitor.config.json` con colores del tema

Para cambiar el icono de la APK:
1. Reemplaza `public/icons/icon-512x512.png`
2. Copia a Android:
```bash
npx cap copy android
```
3. O usa: https://capacitorjs.com/docs/guides/splash-screens-and-icons

Generar recursos:
```bash
npm install @capacitor/assets --save-dev
npx capacitor-assets generate --android
```

---

## 🔧 Comandos útiles

```bash
# Desarrollo web normal
npm run dev

# Build web
npm run build

# Build + sync a Android
npm run build:apk

# Solo sincronizar cambios web a Android
npm run cap:copy

# Abrir Android Studio
npm run cap:open:android

# Compilar APK debug directo (requiere Java/Gradle)
npm run cap:build:android
```

---

## 📲 Instalar APK en celular

1. Activa "Orígenes desconocidos" en tu Android: Ajustes > Seguridad > Instalar apps desconocidas
2. Transfiere `app-debug.apk` a tu celular
3. Abre el archivo y instala
4. O via ADB:
```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 🌐 PWA (Alternativa sin APK)

Si no quieres compilar APK, la app ya es PWA instalable:

1. Despliega en Vercel
2. Abre en Chrome Android
3. Menú > "Agregar a pantalla principal" o "Instalar app"
4. Se instalará como app nativa sin necesidad de APK

La PWA ya está configurada con `manifest.json`.

---

## 🆘 Solución de problemas

**Error: `android` folder not found**
```bash
npx cap add android
```

**Error Gradle / Java**
- Instala JDK 17: https://adoptium.net/
- Configura `JAVA_HOME`

**La APK muestra pantalla blanca**
- Verifica `server.url` en `capacitor.config.json`
- Asegúrate que tu web permite iframe/WebView (headers)
- Revisa `android/app/src/main/AndroidManifest.xml` tiene permiso INTERNET:
```xml
<uses-permission android:name="android.permission.INTERNET" />
```

**No aparece el permiso de micrófono / cámara / galería / memoria**
- Los permisos se declaran en `android/app/src/main/AndroidManifest.xml`. Si un permiso no está
  declarado ahí, Android no lo muestra en *Ajustes > Apps > Templo Místico CRM > Permisos* y la
  app no puede pedirlo (las notas de voz con `getUserMedia` no funcionan sin `RECORD_AUDIO`).
- Este repo ya declara: `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `CAMERA`,
  `READ_MEDIA_IMAGES/VIDEO/AUDIO` (Android 13+), `READ/WRITE_EXTERNAL_STORAGE` (Android 12-/9-),
  `POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM`, `USE_EXACT_ALARM` y `VIBRATE`.
- Tras cambiar el manifest **hay que recompilar el APK** y reinstalarlo; los permisos no se
  actualizan en el APK ya instalado.
- Con el APK nuevo: la app pide cada permiso en el momento de usarlo (notas de voz → micrófono,
  foto/cámara, notificaciones en Ajustes). También puedes concederlos a mano en
  *Ajustes > Apps > Templo Místico CRM > Permisos*.
- Nota: reproducir sonidos no requiere permiso en Android; solo grabar audio (`RECORD_AUDIO`) y
  notificaciones en Android 13+ (`POST_NOTIFICATIONS`).

**Archivados no aparecen**
- Ejecuta la migración SQL en Supabase: `supabase/migrations/20260824_archivado_eliminado.sql`
- Ve a Supabase > SQL Editor > Pega el contenido > Run

---

## 📋 Checklist migración Supabase

Ejecuta este SQL en Supabase Dashboard:

```sql
alter table public.conversaciones
  add column if not exists archivada boolean not null default false,
  add column if not exists fecha_archivado timestamptz,
  add column if not exists motivo_archivado text;

create index if not exists conversaciones_archivada_idx on public.conversaciones (archivada);
```

---

¡Listo! Ya tienes tu CRM como APK 📱🔮
