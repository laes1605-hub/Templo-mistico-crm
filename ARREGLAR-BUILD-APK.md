# Arreglar el check "Build APK" (rojo desde el 14/09/2026)

**No es culpa del CRM ni de ninguna rama.** El 14/09/2026 Google retiró de su
repositorio el paquete viejo `tools` del Android SDK, y la acción de CI
`android-actions/setup-android` lo pide por defecto, así que **toda** compilación de
Android en GitHub se rompe en el paso *Setup Android SDK*:

```
Warning: Failed to find package 'tools'
Error: The process '.../sdkmanager' failed with exit code 1
```

Es un problema de la acción, no del repositorio (issues: [android-actions/setup-android#537](https://github.com/android-actions/setup-android/issues/537)).
Mientras los mantenedores publican la solución, el arreglo son **2 líneas** en
`.github/workflows/build-apk.yml`.

> ⚠️ **Corrección importante:** subir solo el número de versión (`@v3` → `@v4`) **no
> alcanza**. La `v4` sigue trayendo `packages: 'tools platform-tools'` por defecto,
> así que seguiría pidiendo el paquete retirado y volvería a fallar. Lo que arregla
> el problema es **decirle qué paquetes instalar**, sin `tools`.

---

## El cambio exacto

**Antes** (lo que hay hoy, líneas 38-39 del archivo):

```yaml
      - name: Setup Android SDK
        uses: android-actions/setup-android@v3
```

**Después** (queda así, 4 líneas):

```yaml
      - name: Setup Android SDK
        uses: android-actions/setup-android@v4
        with:
          packages: 'platform-tools'
```

Notas:

- `@v4` es la última versión (v4.0.1) y usa Node 24; la `v3` además estaba avisando
  que Node 20 quedó obsoleto.
- `packages: 'platform-tools'` instala solo las herramientas de plataforma: deja de
  pedir el paquete `tools` retirado. El resto (Android 36, build-tools) lo sigue
  bajando Gradle solo, **igual que en el build verde del 03/09**.
- Nada más del workflow hay que tocar: el proyecto Android, `package.json` y el
  lockfile están idénticos a ese build verde, así que la compilación debería volver
  a pasar.

---

## Cómo aplicarlo (elige una)

### Opción A · Desde el navegador (la más rápida, ~30 segundos)

1. Abre este enlace (ya apunta a la rama de esta sesión):

   https://github.com/laes1605-hub/Templo-mistico-Crm/edit/arena/01a0a6cd-templo-mistico-crm/.github/workflows/build-apk.yml

2. Toca el lápiz / edita y reemplaza el bloque **Antes** por el bloque **Después**.
3. **Commit changes** → deja seleccionado *Commit directly to the
   `arena/01a0a6cd-templo-mistico-crm` branch* → **Commit**.
4. Ese commit dispara solo el workflow: **Actions → Build APK**. Debe quedar verde
   (deja también la APK en `apk/templo-mistico-crm-debug.apk` de la rama y como
   artefacto descargable).

Opcional, si quieres dejar `main` arreglado antes de mergear el PR #55: repite lo
mismo cambiando `/edit/arena/01a0a6cd-templo-mistico-crm/` por `/edit/main/`.
Al mergear el PR #55, `main` recibe el arreglo de todos modos.

### Opción B · Desde tu computador (si tienes el repo clonado)

```bash
cd Templo-mistico-crm
# edita .github/workflows/build-apk.yml (bloque de arriba)
git add .github/workflows/build-apk.yml
git commit -m "ci: arreglar Setup Android SDK (Google retiró el paquete tools)"
git pull --rebase origin arena/01a0a6cd-templo-mistico-crm
git push origin arena/01a0a6cd-templo-mistico-crm
```

Y para lanzar el build a mano cuando quieras (el workflow tiene `workflow_dispatch`):

```bash
gh workflow run build-apk.yml --ref arena/01a0a6cd-templo-mistico-crm
```

### Opción C · Que lo aplique yo

El agente de esta sesión **no puede** modificar archivos dentro de
`.github/workflows/`: el token con el que subo cambios no tiene el permiso
`workflows` de GitHub y el push se rechaza con
*"refusing to allow a GitHub App to create or update workflow"*. Si reconectas
GitHub en Arena con ese permiso habilitado, lo aplico yo en un minuto; mientras
tanto, la Opción A es la vía.

---

## Si después del arreglo algo más falla

Los pasos siguientes (`npm ci`, `npm run build`, `capacitor sync`, `gradlew`) son
los mismos del build verde del 03/09 y el proyecto Android no cambió desde
entonces, así que lo esperable es verde. Si apareciera otro error, revisa en este
orden:

1. **Falló `Setup Android SDK` otra vez** → revisa que quedó `packages: 'platform-tools'`
   (sin `tools`) y que no haya quedado la línea `@v3`.
2. **Falló `Build APK (debug)`** → abre el paso y mira el final del log: el workflow
   ya publica las últimas líneas de Gradle como anotación `::error::` del check, así
   que el mensaje se ve sin descargar logs.
3. **El build tarda o se queda sin memoria** → `android/gradle.properties` tiene
   `org.gradle.jvmargs=-Xmx1536m`; si hiciera falta, se puede subir a `-Xmx2048m`.

## Plan B (sin la acción de terceros)

Si prefieres no depender de esa acción, se puede **borrar el paso entero**: los
runners `ubuntu-latest` de GitHub ya vienen con el Android SDK preinstalado y con
`ANDROID_HOME` configurado, y este workflow nunca llama a `sdkmanager` directamente
(lo hace Gradle por dentro).

```yaml
      # Setup Android SDK: eliminado (el runner ya trae el SDK y Google retiró el
      # paquete 'tools' que pedía android-actions/setup-android).
```

Es igual de válido y también son 2 líneas de cambio.

---

## Apéndice · Archivo completo corregido

`...` marca las partes que quedan igual; el **único** cambio está en el bloque
*Setup Android SDK*.

```yaml
name: Build APK

on:
  workflow_dispatch:
  push:
    branches:
      - "arena/**"
      - main
    paths-ignore:
      - "apk/**"
      - "**.md"

permissions:
  contents: write

concurrency:
  group: build-apk-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build-apk:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: ${{ github.ref_name }}

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Setup Java 21
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 21

      # ✅ ARREGLADO: Google retiró el paquete 'tools' del SDK (14/09/2026) y la
      # acción lo pedía por defecto. Con 'packages: platform-tools' ya no lo pide.
      - name: Setup Android SDK
        uses: android-actions/setup-android@v4
        with:
          packages: 'platform-tools'

      - name: Install dependencies
        run: npm ci

      - name: Verificar build web
        run: npm run build

      # ... el resto del workflow queda exactamente igual
```

## Referencias

- Issue oficial del fallo y solución provisional:
  https://github.com/android-actions/setup-android/issues/537
- Releases de la acción (última: v4.0.1):
  https://github.com/android-actions/setup-android/releases
- Paquete `tools` retirado por Google: https://developer.android.com/tools#tools-sdk
