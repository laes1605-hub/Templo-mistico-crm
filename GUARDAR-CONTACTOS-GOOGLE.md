# Guardar contactos: teléfono y cuenta de Google

La ficha de cada cliente tiene ahora **dos botones**:

| Botón | Qué hace | Dónde queda el contacto |
| --- | --- | --- |
| 👤 **Guardar en teléfono** | La APK 1.3.4 crea el contacto con el plugin nativo del CRM (sólo nombre y teléfono). Si Android no permite la inserción, abre el menú de Contactos para importar un `.vcf`. En web/PWA descarga el archivo. | Agenda del teléfono (cuenta general o la que elija al importar). |
| 🌐 **Guardar en cuenta Google** | Genera la ficha `.vcf` y abre el **menú de compartir** del sistema con el archivo listo. | Al elegir **Contactos / Google Contacts** y la cuenta Google, el contacto se importa en la nube y baja al teléfono. |

## Reglas al guardar en el teléfono

La APK mira la agenda **antes** de crear el contacto, y **vuelve a mirarla
después**:

1. **¿Ese número ya está guardado?** Se busca por **número**, no por nombre (es
   lo que identifica a la persona y lo que usa Android para fusionar fichas).
   Cubre el número que ya llegó con WhatsApp o que otro operador guardó con otro
   nombre.
   - **Sí** → **no se crea nada**. Android une los contactos que comparten
     número, así que una segunda ficha no llegaría a verse. La app avisa con el
     nombre real de la agenda:
     «Este número ya está guardado en el teléfono como "Marta" (+56 9 …). No se
     creó ningún duplicado». Si el CRM lo llama de otra forma, el aviso lo dice
     y explica que el nombre se cambia en la app Contactos.
   - **No** → se crea el contacto y se comprueba el paso 2.
2. **¿Quedó guardado de verdad?** Después de escribir se vuelve a buscar el
   número en la agenda. Sólo si aparece se muestra «Contacto guardado»; si
   Android aceptó la inserción pero la ficha no está, la app **da error** en vez
   de celebrar un guardado que no existe.
3. **Nombre** (sólo cuando el número estaba libre):
   - **Nombre nuevo** → se guarda tal cual (`Marta López`).
   - **Nombre repetido con otro número** → consecutivo automático:
     `Marta López 2`, y si ya hay un 2 entonces `Marta López 3`, y así
     sucesivamente. Nunca reutiliza un consecutivo borrado (si hubo un 2, el
     siguiente es 3 aunque borren la «Marta López 2»).
   - Mayúsculas y tildes no engañan al consecutivo: `MARTA LOPEZ` y `Marta López`
     cuentan como el mismo nombre.

La búsqueda por número usa el `PhoneLookup` de Android (el mismo que identifica
una llamada entrante), así que encuentra el número aunque la agenda lo guarde
sin el `+` del país. Si la APK instalada es anterior a ese método, se recorre la
agenda completa como respaldo.

> Si el aviso de «se abrió el menú para guardar» aparece cada vez, casi siempre
> es el **permiso de Contactos denegado**: la app lo avisa y explica cómo
> activarlo (Ajustes › Aplicaciones › Templo Místico CRM › Permisos › Contactos).
> Con el permiso activo el guardado es directo, sin menús.

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

- `npm run test:contactos` cubre este flujo contra una agenda simulada: número ya
  guardado con otro nombre, guardado fantasma (Android dice que sí pero la agenda
  queda vacía), consecutivo por nombre, permiso denegado y APK antigua sin
  `findByPhone`.
- `npm run test:tiempo` cubre la lógica de tiempo (no toca contactos).
- `npx tsc --noEmit` ✅ · `npm run build` ✅
- Prueba manual: abre un chat, pulsa **Guardar en teléfono** y comprueba que el
  contacto aparece en la app Contactos del teléfono; vuelve a pulsarlo y debe
  avisar «ya está guardado» sin crear un duplicado.
