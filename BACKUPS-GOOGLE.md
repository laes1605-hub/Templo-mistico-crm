# Respaldos en Google Drive: conservar solo los últimos 2 días

**Problema:** el servidor genera un respaldo en Google Drive cada día y con el
tiempo llena el espacio de tu cuenta de Google (los 15 GB gratuitos se acaban).

**Solución:** un script (`scripts/limpiar-backups-gdrive.mjs`) que corre cada
día en el servidor, lee la **fecha del nombre** de cada respaldo y **borra los
de más de 2 días**, dejando solo el de hoy y el de ayer. Así "cuando se crea
uno, se elimina el de antes".

- **No depende de cómo se crea el respaldo** (cron, n8n, panel, etc.): solo
  actúa sobre los archivos que ya están en Drive.
- **Cero dependencias**: solo necesita Node 18 o superior en el servidor
  (si el servidor ya corre n8n, ya lo tiene).
- **Muy seguro**:
  - Por defecto hace un **ENSAYO** (muestra qué borraría, sin borrar nada).
  - Un archivo cuya fecha no se pueda leer en el nombre **nunca** se borra.
  - Si al borrar quedaría solo 1 archivo (o menos) en la carpeta, **aborta**
    sin borrar nada (malla de seguridad).
  - Los borrados van a la papelera de Drive (se libera el espacio de inmediato
    y quedan 30 días para recuperarlos por si hubo un error).
- Reconoce fechas en el nombre: `2026-09-17`, `17-09-2026`, `17/09/2026`,
  `20260917`, `17-09-26` y sellos largos tipo `20260917120000`.

---

## Paso 0 (recomendado): saber DÓNDE se genera el respaldo

Tú no tienes claro dónde está configurado. Con esto lo localizas y puedes
verificar a qué hora sale (para programar la limpieza 15 min después):

```bash
# Cron del usuario actual y del root
crontab -l
sudo crontab -l
ls /etc/cron.d/ && cat /etc/cron.d/* 2>/dev/null
ls /etc/cron.daily /etc/cron.hourly 2>/dev/null

# Timers de systemd
systemctl list-timers --all

# Buscar referencias a "backup"/"drive" en los cron
grep -ril "backup\|respaldo\|drive" /etc/cron* /var/spool/cron 2>/dev/null
```

También puede estar en:

- **n8n**: abre el panel de n8n → *Workflows* → busca uno con un disparador
  "Schedule Trigger" (cada día a las X) que tenga un nodo de Google Drive o
  "Google Drive". Ahí verás la carpeta y la hora exacta.
- **Panel de hosting** (Hostinger, DigitalOcean, etc.): sección de "backups"
  o "respaldos" en el panel del servidor.

> No es obligatorio encontrarlo: el script de limpieza funciona igual aunque
> no sepas quién crea el respaldo.

## Paso 1: crear la cuenta de servicio de Google (una sola vez)

El script usa una "cuenta de servicio" (una identidad de máquina de Google).
No toca tu cuenta personal y no guarda contraseñas.

1. Entra a **https://console.cloud.google.com** con tu cuenta de Google
   (la misma donde están los respaldos no es requisito; puede ser otro
   proyecto tuyo).
2. Si no tienes proyecto: arriba a la izquierda → crear uno (ej. `templo-mistico`).
3. Menú **APIs y servicios → Biblioteca** → busca **Google Drive API** →
   botón **HABILITAR**. (Puedes aceptar la pantalla de facturación solo si
   te pide crear un proyecto nuevo; la API Drive es gratis para este uso.)
4. Menú **IAM y administración → Cuentas de servicio** → **Crear cuenta de servicio**:
   - Nombre: `backup-cleaner` (el correo quedará tipo
     `backup-clea…@templo-mistico.iam.gserviceaccount.com` — **apúntalo**).
   - Rol: no necesita ninguno.
   - Finalizar.
5. En la lista de cuentas de servicio, clic sobre `backup-cleaner` →
   pestaña **Claves** → **Agregar clave → Crear nueva clave → JSON**.
   Se descarga un archivo `.json`. **Ese archivo es la llave; no lo compartas.**

## Paso 2: compartir la carpeta de respaldos con la cuenta de servicio

> ⚠️ **Importante:** el script solo debe ver la carpeta con los respaldos.
> Si hoy los respaldos están sueltos en la raíz de Drive, **crea primero una
> carpeta llamada `Respaldos CRM` y mueve los respaldos dentro**. De esa
> forma el script jamás podría tocar otros archivos tuyos (fotos, documentos,
> etc.), aunque lleven fechas en el nombre.

1. En **drive.google.com** abre la carpeta de respaldos → clic derecho →
   **Compartir**.
2. En "Agregar personas y grupos" pega el correo de la cuenta de servicio
   (`backup-clea…@….iam.gserviceaccount.com`).
3. Permiso: **Editor** (necesita borrar) → Enviar.
4. Con la carpeta abierta, copia la **URL** del navegador. Lo que está después
   de `/folders/` es el **ID de la carpeta** (ej.
   `1AbC...xyz`). Lo usaremos en el Paso 4.

## Paso 3: subir el script al servidor

Copia estos 2 archivos a la misma carpeta del servidor (ej. `/opt/respaldos/`):

| Archivo de este repositorio         | Para qué                                  |
| ----------------------------------- | ----------------------------------------- |
| `scripts/limpiar-backups-gdrive.mjs`| El limpiador (ejecutable).                |
| el `.json` descargado en el Paso 1  | Guárdalo como `google-service-account.json` |

Por ejemplo, desde tu computadora:

```bash
scp scripts/limpiar-backups-gdrive.mjs USUARIO@TU-SERVIDOR:/opt/respaldos/
scp clave-descargada.json USUARIO@TU-SERVIDOR:/opt/respaldos/google-service-account.json
```

(En el servidor: `chmod 600 /opt/respaldos/google-service-account.json` para
que solo el usuario del cron pueda leerla.)

## Paso 4: probar (ENSAYO primero)

En el servidor:

```bash
cd /opt/respaldos

# 1) ENSAYO: muestra qué borraría SIN borrar nada
BACKUP_FOLDER_ID=1AbC...xyz node limpiar-backups-gdrive.mjs

# 2) Si el listado se ve correcto (hoy + ayer se conservan, los viejos
#    "SE BORRARÍAN"), ejecuta de verdad:
BACKUP_FOLDER_ID=1AbC...xyz node limpiar-backups-gdrive.mjs --apply
```

En la primera ejecución verás que borra **todo el rezago** acumulado (los
respaldos de hace semanas/meses) — exactamente lo que quieres para recuperar
el espacio.

> Tip: en vez de `BACKUP_FOLDER_ID=...` en cada comando, puedes dejarlo fijo
> editando la línea `FOLDER_ID` del script, o exportarlo en el cron.

## Paso 5: programarlo para que corra solo (cron)

```bash
crontab -e
```

Agrega una línea **15 minutos después** de la hora a la que sale el respaldo
(revisa la hora en el Paso 0; el ejemplo asume que sale a las 4:00 AM):

```cron
15 4 * * * cd /opt/respaldos && BACKUP_FOLDER_ID=1AbC...xyz node limpiar-backups-gdrive.mjs --apply >> /var/log/limpiar-backups-gdrive.log 2>&1
```

Con esto, cada día: se crea el respaldo nuevo → 15 min después el limpiador
deja solo los de hoy y ayer. Resultado: **máximo 2 respaldos en Drive**.

---

## Opciones (variables de entorno)

| Variable          | Por defecto                | Qué hace                                            |
| ----------------- | -------------------------- | --------------------------------------------------- |
| `KEEP_DAYS`       | `2`                        | Días a conservar (2 = hoy + ayer).                  |
| `MIN_FILES_AFTER` | `2`                        | Malla: nunca dejar menos archivos que este número.  |
| `GOOGLE_SA_KEY`   | `google-service-account.json` junto al script | Ruta a la clave `.json`. |
| `BACKUP_FOLDER_ID`| raíz de Drive              | ID de la carpeta de respaldos (recomendado).        |

## Si tu servidor YA tiene rclone configurado para Google Drive

Opción rápida alternativa (usa la fecha de modificación del archivo en vez de
la del nombre):

```bash
# Borra de la carpeta de Drive los archivos con más de 48 horas
rclone delete gdrive:"Respaldos CRM" --min-age 48h
```

Ponle el mismo cron del Paso 5. El script de Node es más fiable si los
nombres llevan fecha; rclone es útil si ya existe esa configuración.

## Si algo sale mal (errores frecuentes)

| Mensaje                                                        | Causa y arreglo                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `No se encontró la clave de la cuenta de servicio`            | El `.json` no está junto al script ni se definió `GOOGLE_SA_KEY`. Colócalo donde dice el mensaje. |
| `No se pudo obtener el token ... access not configured`       | Falta habilitar **Google Drive API** en el proyecto (Paso 1.3).                  |
| `Error al listar archivos ... 404` o `403`                    | La carpeta **no está compartida** con el correo de la cuenta de servicio (Paso 2). |
| `MALLA DE SEGURIDAD: ... No se borró NADA`                    | Al borrar quedaría 1 solo archivo. Es la malla haciendo su trabajo: revisa el ensayo. Si de verdad es el caso (p. ej. solo queda 1 respaldo válido), puedes pasar `MIN_FILES_AFTER=1`. |
| Muchos archivos `[OMITIR] no hay fecha legible en el nombre`  | Esos nombres no llevan una fecha reconocible. No se borran (seguro). Renómbralos con fecha o agréganos al parser. |

## Pruebas del script

El repositorio trae pruebas (no tocan Google de verdad):

```bash
npm run test:backups
```

## Qué NO hace este script

- No crea ni sube respaldos: **solo limpia** los que ya estén en Drive.
- No borra archivos fuera de la carpeta configurada.
- No toca archivos cuya fecha no se entienda (los deja y los lista).
