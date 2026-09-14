# 📱 Templo Místico CRM en iPad / iPhone (iOS)

Este proyecto ya está preparado para iPad con **Capacitor** (la misma
tecnología que la APK de Android): versión **1.3.2 (build 6)**, app
**universal** (iPad + iPhone), con iconos, pantalla de arranque, multitarea
(Split View), las 4 orientaciones y permisos en español.

> **Dato importante:** Apple no permite instalar apps fuera del App Store sin
> firmarlas con un Apple ID. Por eso hay varias opciones abajo, de más fácil
> a más completa. La **opción 1 (PWA)** la puedes usar **hoy mismo**, sin Mac
> ni cables ni cuentas de pago.

---

## Opción 1 — PWA inmediata (recomendada para empezar hoy) ⭐

La web ya es una PWA instalable. En tu iPad:

1. Abre Safari y entra a `https://templo-mistico-crm.vercel.app`.
2. Toca **Compartir** (el cuadro con flecha) → **Añadir a pantalla de inicio**.
3. Toca **Añadir**. Queda un icono morado como una app normal: abre a
   pantalla completa, gira en vertical/horizontal y guarda tu sesión.

Funciona todo: chats, notas de voz, adjuntos, contactos (vCard), pipeline,
pagos y ads. Solo faltan los avisos locales en segundo plano, que sí trae la
app nativa (opciones 2–4).

---

## Opción 2 — App nativa con Sideloadly (sin Mac, gratis)

El repositorio compila el IPA automáticamente (ver "Build automático"
abajo). Para instalarlo en el iPad sin Mac:

1. Descarga el IPA sin firmar: en GitHub → carpeta `ipa/` →
   `templo-mistico-crm-unsigned.ipa` (o desde **Actions → Build IPA →
   Artifacts**).
2. En un PC Windows o Mac instala **[Sideloadly](https://sideloadly.io)** y
   conecta el iPad por cable (acepta "Confiar en este equipo").
3. Arrastra el `.ipa` a Sideloadly, escribe tu **Apple ID normal** (el del
   iPad, cuenta gratuita) y pulsa **Start**. Sideloadly firma la app con tu
   cuenta y la instala.
4. En el iPad ve a **Ajustes → General → VPN y gestión de dispositivos**,
   toca tu Apple ID y pulsa **Confiar**.

⏰ **Con Apple ID gratuito la firma dura 7 días**: cada semana hay que
repetir el paso 3 (son 2 minutos; los datos del CRM no se pierden porque
viven en Supabase, no en el iPad). Con cuenta **Apple Developer de pago
($99 USD/año)** dura 1 año.

> Alternativa: **AltStore PAL** (solo Unión Europea) o TrollStore según el
> modelo/iOS. Sideloadly funciona en cualquier país.

---

## Opción 3 — Compilar en un Mac con Xcode (gratis)

Si tienes (o te prestan) un Mac:

1. Instala **Xcode** desde el App Store y ábrelo una vez para que instale sus
   componentes.
2. Clona el repo y en la raíz ejecuta:
   ```bash
   npm ci
   npm run build
   npx cap sync ios
   npx cap open ios
   ```
3. En Xcode selecciona el proyecto **App** → pestaña **Signing & Capabilities**
   → marca **Automatically manage signing** → en **Team** añade tu Apple ID
   (Xcode → Settings → Accounts). Cambia el **Bundle Identifier** solo si
   Xcode dice que `com.templomistico.crm` ya está en uso (p. ej. añade tu
   nombre al final).
4. Conecta el iPad por cable, selecciónalo arriba como destino y pulsa **Run ▶**.
5. Confía en el desarrollador (Ajustes → General → VPN y gestión de
   dispositivos) como en la opción 2.

Misma nota de los 7 días con cuenta gratuita.

---

## Opción 4 — Distribución con Apple Developer ($99 USD/año)

Para no reinstalar cada semana y/o repartirla a tu equipo:

1. Contrata el **Apple Developer Program** y registra el UDID de tu iPad en
   [developer.apple.com](https://developer.apple.com) → Certificates,
   Identifiers & Profiles → Devices.
2. Crea un certificado de **distribución**, un App ID `com.templomistico.crm`
   y un **perfil de aprovisionamiento ad-hoc** que incluya tu iPad.
3. Guarda en GitHub → Settings → Secrets and variables → Actions:
   - `APPLE_TEAM_ID` (tu Team ID, ej. `A1B2C3D4E5`)
   - `APPLE_CERTIFICATE_BASE64` (el `.p12` exportado, en base64:
     `base64 -i cert.p12 | pbcopy`)
   - `APPLE_CERTIFICATE_PASSWORD` (contraseña de ese `.p12`)
   - `APPLE_PROVISIONING_PROFILE_BASE64` (el `.mobileprovision` ad-hoc en
     base64)
4. Lanza **Actions → Build IPA → Run workflow**: genera
   `ipa/templo-mistico-crm-adhoc.ipa`, listo para instalar (arrastrándolo en
   Apple Configurator o con `xcrun devicectl`) sin límite de 7 días.

Para **TestFlight/App Store** se usa el mismo proyecto desde Xcode
(Product → Archive → Distribute App). Nota: Apple suele rechazar en el App
Store público las apps que solo muestran una web (la app carga
`templo-mistico-crm.vercel.app`, igual que la APK); para uso interno con
ad-hoc o sideload no hay ningún problema.

---

## 🤖 Build automático (activación en 1 minuto)

El workflow `Build IPA` (`ci/build-ipa.yml`) compila en cada push y deja el
IPA en `ipa/` + artefacto descargable. Como GitHub solo lee workflows desde
`.github/workflows/` y la credencial del agente no puede crear archivos ahí,
actívalo igual que se hizo con la APK:

1. En github.com → este repo → **Add file → Create new file**.
2. Nombre exacto: `.github/workflows/build-ipa.yml`.
3. Pega el contenido completo de `ci/build-ipa.yml` y haz commit.

Sin secrets genera el IPA **sin firmar**; con los 4 secrets genera además el
**ad-hoc firmado**.

---

## ✅ Qué incluye la versión iPad 1.3.2

- **Icono propio** (bola de cristal) en todos los tamaños de iPad/iPhone y
  pantalla de arranque oscura con la marca.
- **Multitarea**: funciona en Split View junto a WhatsApp/Safari.
- **Barra de estado uniforme**: la hora y la batería combinan con el tema
  claro/oscuro del CRM (igual que la APK 1.3.2).
- **Contactos nativos**: guardar clientes en la agenda del iPad con
  anti-duplicados (`Pedro y María 2`, `Pedro y María 3`…).
- **Avisos locales**: mensajes de clientes, recordatorios de tareas y aviso
  diario de En seguimiento a las 9:00 a. m.
- **Descargas**: imágenes, audios, videos y documentos con hoja de compartir.
- **Permisos en español**: contactos, micrófono (notas de voz), cámara y
  fotos (adjuntos).
- Requiere internet (carga la web de Vercel); verifica que Vercel haya
  desplegado el commit antes de probar un IPA nuevo.

## ⚠️ Limitaciones honestas en iPad

- **Llamada directa por WhatsApp Personal**: es exclusiva de la APK Android
  (usa la agenda de Android). En iPad, tocar el número abre el chat/enlace de
  WhatsApp para llamar desde ahí.
- **Atrás por gestos**: iOS no tiene botón atrás; la navegación es con los
  botones de la propia app.
- **Apple ID gratuito = re-firmar cada 7 días** (opciones 2 y 3). Tus datos
  están a salvo en la nube.

## 🔢 Cómo publicar una actualización

1. Sube la versión en `package.json` y en el proyecto iOS
   (`MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` en
   `ios/App/App.xcodeproj/project.pbxproj`, o desde Xcode).
2. Haz push: el workflow genera el IPA solo (igual que la APK se genera sola).
3. Instala el nuevo IPA encima: no borra nada.
