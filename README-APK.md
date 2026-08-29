# 📱 Convertir Templo Místico CRM en APK (Android)

Este proyecto ya está preparado para convertirse en APK usando **Capacitor**.

## ✅ Actualización APK 1.3.1 — Android Studio

La versión está configurada como:

- `versionName`: **1.3.1**
- `versionCode`: **5**
- `appId`: `com.templomistico.crm`
- `compileSdk` / `targetSdk`: **36**
- Java requerido: **JDK 21**

Para compilar esta actualización desde cero:

> **Importante:** `capacitor.config.json` hace que la APK cargue `https://templo-mistico-crm.vercel.app`. Primero verifica que Vercel haya desplegado este commit; de lo contrario la APK podría abrir la versión web anterior aunque el proyecto Android esté en 1.3.1.

### Novedades de la APK 1.3.1

- **Atrás en Android:** el primer gesto o pulsación vuelve siempre a **Chats**. Pulsa o desliza Atrás una segunda vez, dentro de dos segundos, para salir de la app.

- **Llamar por WhatsApp Personal:** desde un chat Personal, la APK comprueba que el número exista en Contactos e intenta abrir la llamada de voz en `com.whatsapp` (nunca WhatsApp Business). Si la agenda/versión de WhatsApp no expone la acción directa, abre el chat Personal como respaldo para tocar el ícono de teléfono.
- **En seguimiento:** ejecuta `supabase/migrations/20260907_llamadas_seguimiento_contactos.sql`. El chip aparece junto a **Por leer** en Personal y genera un aviso local diario a las **9:00 a. m.** mientras haya clientes en esa etapa y los avisos estén activados.
- **Nombres duplicados:** al guardar un contacto desde la APK se revisa la agenda real; si ya existe `Pedro y María`, se guarda como `Pedro y María 2`, luego `Pedro y María 3`, etc.

1. Instala Android Studio y, desde **SDK Manager**, instala Android SDK 36, Android SDK Build-Tools y Android SDK Platform-Tools.
2. Abre Android Studio y selecciona la carpeta `android/` del proyecto, no la carpeta raíz.
3. En Android Studio configura **Gradle JDK = Embedded JDK 21** en `Settings > Build, Execution, Deployment > Build Tools > Gradle`.
4. Desde una terminal ubicada en la raíz del repositorio ejecuta:

   ```bash
   npm ci
   npm run build
   npx cap sync android
   ```

5. Abre el proyecto Android:

   ```bash
   npx cap open android
   ```

6. Espera a que termine **Gradle Sync**. Si aparece el aviso de actualizar Gradle o el Android Gradle Plugin, no lo actualices: el proyecto ya está configurado y probado con sus versiones actuales.
7. Conecta un teléfono con **Depuración USB** activada o crea un emulador Android API 36. Selecciónalo en la barra superior y pulsa **Run ▶** para probar.
8. Para generar el APK instalable, usa **Build > Build Bundle(s) / APK(s) > Build APK(s)**. El archivo queda en:

   ```text
   android/app/build/outputs/apk/debug/app-debug.apk
   ```

9. Para distribuir una versión firmada, usa **Build > Generate Signed Bundle / APK > APK**, crea o selecciona un keystore y conserva la misma clave para futuras actualizaciones. Selecciona la variante `release`.
10. Instala la actualización sobre la APK anterior. Como el `versionCode` pasó de 4 a 5, Android la reconocerá como una actualización; no desinstales la versión anterior si quieres conservar sus permisos y datos locales.

Cada vez que cambies el código web, repite `npm run build` y `npx cap sync android` antes de volver a compilar. No ejecutes `npx cap add android` para esta actualización: la carpeta Android ya existe.

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
- Instala JDK 21 (o usa el Embedded JDK 21 de Android Studio): https://adoptium.net/
- Configura `JAVA_HOME` apuntando al JDK 21 si compilas desde terminal.

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
- Este repo ya declara: `READ/WRITE_CONTACTS`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `CAMERA`,
  `READ_MEDIA_IMAGES/VIDEO/AUDIO` (Android 13+), `READ/WRITE_EXTERNAL_STORAGE` (Android 12-/9-),
  `POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM`, `USE_EXACT_ALARM` y `VIBRATE`.
- Tras cambiar el manifest **hay que recompilar el APK** y reinstalarlo; los permisos no se
  actualizan en el APK ya instalado.
- Con el APK nuevo: la app pide cada permiso en el momento de usarlo (guardar contacto → contactos,
  nota de voz → micrófono, foto/cámara, notificaciones en Ajustes). También puedes concederlos a mano en
  *Ajustes > Apps > Templo Místico CRM > Permisos*.
- Nota: reproducir sonidos no requiere permiso en Android; solo grabar audio (`RECORD_AUDIO`) y
  notificaciones en Android 13+ (`POST_NOTIFICATIONS`).

**Archivados no aparecen**
- Ejecuta la migración SQL en Supabase: `supabase/migrations/20260824_archivado_eliminado.sql`
- Ve a Supabase > SQL Editor > Pega el contenido > Run

**Eliminar un cliente completamente**
- El botón **Eliminar** borra el cliente físico y toda la información que el CRM tenga guardada: conversaciones, mensajes, archivos asociados, notas, tareas, pagos, recordatorios y reglas de Cerebro vinculadas.
- Ejecuta también `supabase/migrations/20260904_eliminar_cliente_completo.sql` en Supabase > SQL Editor > Run.
- No se archiva ni se marca como perdido: al volver a escribir desde ese número, el webhook creará un cliente nuevo en **Nuevo Lead**.

**Guardar clientes y llamar por WhatsApp Personal**
- En la APK, el botón **Guardar en teléfono** crea directamente el contacto en la agenda usando el nombre y el número que aparecen en la ficha. Antes revisa los nombres existentes y agrega un consecutivo si hace falta (`Pedro y María 2`, `Pedro y María 3`...).
- En chats de **WhatsApp Personal** aparece **Llamar por WhatsApp**. Solo se habilita cuando el número está guardado en la agenda. Intenta abrir directamente la voz de WhatsApp Personal; si Android no expone esa acción para el contacto, abre su chat para iniciar la llamada con el icono de teléfono.
- La primera vez Android solicitará los permisos de contactos. Después de modificar esta función hay que recompilar la APK con `npm run cap:build:android`.
- En la versión web/PWA se descarga un archivo `.vcf`; ábrelo en el teléfono para importarlo a Contactos. El navegador no puede leer la agenda real, así que la verificación completa ocurre en la APK.

---

## 📋 Checklist migración Supabase

Para habilitar la bandeja y el aviso diario de **En seguimiento**, ejecuta primero el archivo completo:

```text
supabase/migrations/20260907_llamadas_seguimiento_contactos.sql
```

Después ejecuta los SQL históricos que todavía falten en Supabase Dashboard:

```sql
alter table public.conversaciones
  add column if not exists archivada boolean not null default false,
  add column if not exists fecha_archivado timestamptz,
  add column if not exists motivo_archivado text;

create index if not exists conversaciones_archivada_idx on public.conversaciones (archivada);
```

---

¡Listo! Ya tienes tu CRM como APK 📱🔮
