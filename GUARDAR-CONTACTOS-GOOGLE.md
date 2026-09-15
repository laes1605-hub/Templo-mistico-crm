# Guardar contactos: teléfono y cuenta de Google

La ficha de cada cliente tiene ahora **dos botones**:

| Botón | Qué hace | Dónde queda el contacto |
| --- | --- | --- |
| 👤 **Guardar en teléfono** | La APK crea el contacto directamente con el plugin nativo de contactos (`Contacts.createContact`). En web/PWA descarga un `.vcf`. | Agenda del teléfono (cuenta general del dispositivo). |
| 🌐 **Guardar en cuenta Google** | Genera la ficha `.vcf` y abre el **menú de compartir** del sistema con el archivo listo. | Al elegir **Contactos / Google Contacts** y la cuenta Google, el contacto se importa en la nube y baja al teléfono. |

## Cómo se usa el botón de Google (paso a paso)

1. Abre un chat y toca la ficha del cliente (o el ícono ℹ️ en el teléfono).
2. Pulsa **Guardar en cuenta Google**.
3. Se abre el menú de compartir de Android con el archivo `Nombre_Cliente.vcf`.
4. Elige **Contactos** (o **Google Contacts**).
5. Si el teléfono tiene varias cuentas, elige la de **Google**. El contacto se guarda
   en esa cuenta y Google lo sincroniza (queda visible en el teléfono y en
   contacts.google.com).

En navegador de escritorio, si el navegador no tiene hoja de compartir con archivos,
el `.vcf` se **descarga**: al abrirlo desde el teléfono, Contactos te deja elegir la
cuenta de Google.

> El nombre en este flujo va **sin consecutivo** (`Marta Gómez`, no `Marta Gómez 2`):
> Google Contacts se encarga de los repetidos y así no se crean copias raras en la nube.
> El botón de teléfono sí conserva el consecutivo automático de siempre.

## Qué NO hace (y por qué)

- **No escribe directamente en la cuenta Google sin preguntar.** El plugin de
  contactos que usa la APK crea los contactos en la agenda general del dispositivo
  (`ACCOUNT_TYPE = null`), no permite elegir cuenta. El camino elegido evita pedir
  permisos extra y configuración: se entrega la ficha al sistema y tú eliges la cuenta.
- **No requiere Google Cloud, ni OAuth, ni tokens.** No hay que autorizar nada.

## Si algún día quieres el guardado directo en la cuenta Google

Escribir el contacto en la cuenta `com.google` sin pasar por el menú requiere un
plugin nativo propio (o migrar a un plugin de contactos que soporte cuentas) y
**recompilar la APK**. Sería:

1. Listar las cuentas del teléfono (`AccountManager.getAccountsByType("com.google")`) y
   elegir una si hay varias.
2. Insertar el contacto con `ContentProviderOperation.newInsert(RawContacts.CONTENT_URI)`
   usando `ACCOUNT_TYPE = "com.google"` y `ACCOUNT_NAME = <correo>`.

El resto de la app no cambia: bastaría llamar a esa función desde el mismo botón.
La alternativa 100 % nativa de Google (People API con OAuth) también es posible, pero
implica crear un proyecto en Google Cloud, configurar la pantalla de consentimiento y
guardar tokens; no es necesaria para el uso diario.

## Verificación

- `npm run test:tiempo` cubre la lógica de tiempo (no toca contactos).
- `npx tsc --noEmit` ✅ · `npm run build` ✅
- Prueba manual: abre un chat, pulsa **Guardar en cuenta Google** y comprueba que el
  contacto aparece en Google Contacts (contacts.google.com) tras la sincronización.
