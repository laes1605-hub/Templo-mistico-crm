package com.templomistico.crm;

import android.Manifest;
import android.content.ContentProviderOperation;
import android.content.ContentProviderResult;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import android.provider.ContactsContract.CommonDataKinds.Phone;
import android.provider.ContactsContract.CommonDataKinds.StructuredName;
import android.provider.ContactsContract.PhoneLookup;
import android.provider.ContactsContract.RawContacts;

import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;

/**
 * Guarda contactos en Android sin insertar filas vacías de organización,
 * cumpleaños y nota. La implementación comunitaria de Contacts crea esas
 * filas incluso cuando no hay datos para ellas; algunos proveedores Android
 * rechazan el lote completo y sólo devuelven "Something went wrong".
 */
@CapacitorPlugin(
    name = "ContactSaver",
    permissions = {
        @Permission(
            strings = { Manifest.permission.READ_CONTACTS, Manifest.permission.WRITE_CONTACTS },
            alias = "contacts"
        )
    }
)
public class ContactSaverPlugin extends Plugin {
    private static final String TAG = "ContactSaver";

    @PluginMethod
    public void createContact(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            requestPermissionForAlias("contacts", call, "contactsPermissionCallback");
            return;
        }
        saveContact(call);
    }

    /**
     * Busca un número en la agenda y dice qué contacto lo tiene.
     *
     * Usa PhoneLookup, que es la misma consulta con la que Android resuelve una
     * llamada entrante: encuentra el número aunque la agenda lo guarde sin el
     * +indicativo o con espacios. No pide permiso: si no está concedido,
     * contesta found=false sin abrir ningún diálogo.
     */
    @PluginMethod
    public void findByPhone(PluginCall call) {
        JSObject result = new JSObject();
        String phoneNumber = clean(call.getString("phoneNumber", ""));

        if (phoneNumber.isEmpty() || getPermissionState("contacts") != PermissionState.GRANTED) {
            result.put("found", false);
            result.put("permitted", getPermissionState("contacts") == PermissionState.GRANTED);
            call.resolve(result);
            return;
        }

        try {
            ContactoExistente existente = buscarPorNumero(phoneNumber);
            if (existente == null) {
                result.put("found", false);
                result.put("permitted", true);
                call.resolve(result);
                return;
            }

            result.put("found", true);
            result.put("permitted", true);
            result.put("contactId", existente.contactId);
            result.put("displayName", existente.displayName);
            String[] cuenta = cuentaDelContacto(existente.contactId);
            if (cuenta != null) {
                result.put("accountType", cuenta[0]);
                result.put("accountName", cuenta[1]);
            }
            call.resolve(result);
        } catch (SecurityException error) {
            Logger.error(TAG, "Android denegó la lectura de la agenda", error);
            result.put("found", false);
            result.put("permitted", false);
            call.resolve(result);
        } catch (Exception error) {
            Logger.error(TAG, "No se pudo buscar el número en la agenda", error);
            call.reject("Android no permitió buscar en la agenda: " + error.getMessage(), "CONTACT_LOOKUP_FAILED", error);
        }
    }

    @PermissionCallback
    private void contactsPermissionCallback(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            call.reject(
                "Activa el permiso de Contactos para guardar directamente en la agenda.",
                "CONTACT_PERMISSION_DENIED"
            );
            return;
        }
        saveContact(call);
    }

    private void saveContact(PluginCall call) {
        String givenName = clean(call.getString("givenName", ""));
        String familyName = clean(call.getString("familyName", ""));
        String phoneNumber = clean(call.getString("phoneNumber", ""));

        if (phoneNumber.isEmpty()) {
            call.reject("El cliente no tiene un número de teléfono válido.", "INVALID_PHONE");
            return;
        }

        try {
            String displayName = (givenName + " " + familyName).trim();
            if (displayName.isEmpty()) {
                displayName = phoneNumber;
            }

            // El número manda: si ya está en la agenda (con el nombre que sea) no
            // se inserta otra ficha. Android fusiona los contactos que comparten
            // número, así que la segunda ficha no llegaría a verse y la app
            // daría por guardado un nombre que la agenda nunca muestra.
            ContactoExistente previo = buscarPorNumero(phoneNumber);
            if (previo != null) {
                JSObject existente = new JSObject();
                existente.put("contactId", previo.contactId);
                existente.put("yaExistia", true);
                existente.put("nombreExistente", previo.displayName);
                existente.put("verificado", true);
                call.resolve(existente);
                return;
            }

            ContentProviderResult[] results = intentarLote(
                displayName,
                givenName,
                familyName,
                phoneNumber,
                null,
                null,
                true
            );

            if (!hasInsertedUri(results)) {
                results = intentarLote(
                    displayName,
                    givenName,
                    familyName,
                    phoneNumber,
                    null,
                    null,
                    false
                );
            }

            if (!hasInsertedUri(results)) {
                String[] existingAccount = findPreferredAccount();
                if (existingAccount != null) {
                    results = intentarLote(
                        displayName,
                        givenName,
                        familyName,
                        phoneNumber,
                        existingAccount[0],
                        existingAccount[1],
                        true
                    );
                }
            }

            long rawContactId;
            if (hasInsertedUri(results)) {
                rawContactId = ContentUris.parseId(results[0].uri);
            } else {
                // Algunas agendas (proveedores modificados por el fabricante)
                // rechazan applyBatch con NullPointerException
                // ("ContentValues.keySet() on a null object reference"). En ese
                // caso se inserta fila por fila, sin lote ni referencias
                // cruzadas: el camino incremental que documenta Android.
                rawContactId = insertarSecuencial(
                    displayName,
                    givenName,
                    familyName,
                    phoneNumber
                );
            }

            String contactId = findContactId(rawContactId);

            // Verificación real: el lote puede aceptar la inserción y que la fila
            // no quede consultable (cuenta local rechazada, proveedor saturado…).
            // Sólo se confirma el guardado si el número ya se resuelve en la
            // agenda; si no, se informa el fallo en vez de celebrar de más.
            ContactoExistente guardado = buscarPorNumero(phoneNumber);
            if (guardado == null) {
                Logger.error(TAG, "La agenda aceptó la inserción pero el número no quedó guardado: " + phoneNumber, null);
                call.reject(
                    "Android aceptó la inserción, pero el contacto no aparece en la agenda.",
                    "CONTACT_SAVE_FAILED"
                );
                return;
            }

            JSObject result = new JSObject();
            // Preferimos el ID agregado que devuelve la propia agenda; si todavía
            // no está disponible usamos el que se obtuvo al comprobar el número.
            result.put("contactId", contactId != null ? contactId : guardado.contactId);
            result.put("verificado", true);
            result.put("nombreExistente", guardado.displayName);
            call.resolve(result);
        } catch (SecurityException error) {
            Logger.error(TAG, "Android denegó el acceso a la agenda", error);
            call.reject(
                "No hay permiso para escribir en Contactos. Revisa Ajustes del teléfono.",
                "CONTACT_PERMISSION_DENIED",
                error
            );
        } catch (Exception error) {
            Logger.error(TAG, "No se pudo insertar el contacto en la agenda Android", error);
            call.reject(
                "Android no pudo escribir en la agenda: " + error.getMessage(),
                "CONTACT_SAVE_FAILED",
                error
            );
        }
    }

    private boolean hasInsertedUri(ContentProviderResult[] results) {
        return results != null && results.length > 0 && results[0] != null && results[0].uri != null;
    }

    private ContentProviderResult[] applyInsertBatch(
        String displayName,
        String givenName,
        String familyName,
        String phoneNumber,
        String accountType,
        String accountName,
        boolean explicitAccountColumns
    ) throws Exception {
        ArrayList<ContentProviderOperation> operations = new ArrayList<>();
        ContentProviderOperation.Builder rawContactOp =
            ContentProviderOperation.newInsert(RawContacts.CONTENT_URI);
        if (explicitAccountColumns) {
            rawContactOp
                .withValue(RawContacts.ACCOUNT_TYPE, accountType)
                .withValue(RawContacts.ACCOUNT_NAME, accountName);
        }
        operations.add(rawContactOp.build());

        ContentProviderOperation.Builder nameOperation =
            ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
                .withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, 0)
                .withValue(ContactsContract.Data.MIMETYPE, StructuredName.CONTENT_ITEM_TYPE)
                .withValue(StructuredName.DISPLAY_NAME, displayName);
        if (!givenName.isEmpty()) {
            nameOperation.withValue(StructuredName.GIVEN_NAME, givenName);
        }
        if (!familyName.isEmpty()) {
            nameOperation.withValue(StructuredName.FAMILY_NAME, familyName);
        }
        operations.add(nameOperation.build());

        operations.add(
            ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
                .withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, 0)
                .withValue(ContactsContract.Data.MIMETYPE, Phone.CONTENT_ITEM_TYPE)
                .withValue(Phone.TYPE, Phone.TYPE_MOBILE)
                .withValue(Phone.NUMBER, phoneNumber)
                .build()
        );

        try {
            return getContext()
                .getContentResolver()
                .applyBatch(ContactsContract.AUTHORITY, operations);
        } catch (SecurityException securityException) {
            throw securityException;
        } catch (Exception error) {
            if (explicitAccountColumns && accountType == null) {
                Logger.warn(TAG, "Reintentando inserción de contacto con estrategia alternativa: " + error.getMessage());
                return null;
            }
            throw error;
        }
    }

    /**
     * Ejecuta el lote de inserción y devuelve null (en vez de lanzar) cuando el
     * proveedor lo rechaza: así saveContact puede pasar a la siguiente
     * estrategia. Una SecurityException (permiso revocado) sí se propaga para
     * que el aviso hable de permisos y no de un fallo de escritura.
     */
    private ContentProviderResult[] intentarLote(
        String displayName,
        String givenName,
        String familyName,
        String phoneNumber,
        String accountType,
        String accountName,
        boolean explicitAccountColumns
    ) {
        try {
            return applyInsertBatch(
                displayName, givenName, familyName, phoneNumber,
                accountType, accountName, explicitAccountColumns
            );
        } catch (SecurityException securityException) {
            throw securityException;
        } catch (Exception error) {
            Logger.warn(TAG, "La agenda rechazó el lote de inserción: " + error.getMessage());
            return null;
        }
    }

    /**
     * Inserción fila por fila para agendas donde applyBatch falla. Hace las
     * mismas tres escrituras que el lote (ficha base, nombre y número) pero con
     * inserciones independientes y el RAW_CONTACT_ID explícito, sin
     * withValueBackReference: es el camino incremental que documenta Android y
     * evita el código del proveedor que lanza la NullPointerException.
     */
    private long insertarSecuencial(
        String displayName,
        String givenName,
        String familyName,
        String phoneNumber
    ) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();

        Uri rawUri = resolver.insert(RawContacts.CONTENT_URI, new ContentValues());
        if (rawUri == null) {
            throw new IllegalStateException(
                "Android no devolvió la ficha base del contacto al insertarla."
            );
        }
        long rawContactId = ContentUris.parseId(rawUri);

        ContentValues nombre = new ContentValues();
        nombre.put(ContactsContract.Data.RAW_CONTACT_ID, rawContactId);
        nombre.put(ContactsContract.Data.MIMETYPE, StructuredName.CONTENT_ITEM_TYPE);
        nombre.put(StructuredName.DISPLAY_NAME, displayName);
        if (!givenName.isEmpty()) {
            nombre.put(StructuredName.GIVEN_NAME, givenName);
        }
        if (!familyName.isEmpty()) {
            nombre.put(StructuredName.FAMILY_NAME, familyName);
        }
        if (resolver.insert(ContactsContract.Data.CONTENT_URI, nombre) == null) {
            Logger.warn(TAG, "La agenda no confirmó la fila de nombre; el contacto quedará con el número.");
        }

        ContentValues telefonoValores = new ContentValues();
        telefonoValores.put(ContactsContract.Data.RAW_CONTACT_ID, rawContactId);
        telefonoValores.put(ContactsContract.Data.MIMETYPE, Phone.CONTENT_ITEM_TYPE);
        telefonoValores.put(Phone.TYPE, Phone.TYPE_MOBILE);
        telefonoValores.put(Phone.NUMBER, phoneNumber);
        if (resolver.insert(ContactsContract.Data.CONTENT_URI, telefonoValores) == null) {
            throw new IllegalStateException(
                "Android no confirmó la inserción del número en la agenda."
            );
        }

        return rawContactId;
    }

    private String[] findPreferredAccount() {
        Cursor cursor = null;
        String[] fallback = null;
        try {
            cursor = getContext().getContentResolver().query(
                RawContacts.CONTENT_URI,
                new String[] { RawContacts.ACCOUNT_TYPE, RawContacts.ACCOUNT_NAME },
                RawContacts.DELETED + " = 0 AND " + RawContacts.ACCOUNT_TYPE + " IS NOT NULL AND " + RawContacts.ACCOUNT_NAME + " IS NOT NULL",
                null,
                null
            );
            while (cursor != null && cursor.moveToNext()) {
                String type = clean(cursor.getString(0));
                String name = clean(cursor.getString(1));
                if (type.isEmpty() || name.isEmpty()) continue;
                String lower = type.toLowerCase();
                if (lower.contains("whatsapp") || lower.contains("telegram") || lower.contains("signal") || lower.contains("facebook")) {
                    continue;
                }
                if ("com.google".equals(type)) {
                    return new String[] { type, name };
                }
                if (fallback == null) {
                    fallback = new String[] { type, name };
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return fallback;
    }

    /** Contacto de la agenda que ya tiene un número determinado. */
    private static final class ContactoExistente {

        final String contactId;
        final String displayName;

        ContactoExistente(String contactId, String displayName) {
            this.contactId = contactId;
            this.displayName = displayName;
        }
    }

    /**
     * Resuelve un número con PhoneLookup, la misma consulta con la que Android
     * identifica una llamada entrante: acepta el número con o sin +indicativo y
     * con los espacios o guiones que la agenda haya guardado.
     *
     * Devuelve null cuando ningún contacto tiene ese número.
     */
    private ContactoExistente buscarPorNumero(String phoneNumber) {
        String digitos = phoneNumber.replaceAll("\\D", "");
        ArrayList<String> candidatos = new ArrayList<>();
        if (!digitos.isEmpty()) {
            candidatos.add("+" + digitos);
            candidatos.add(digitos);
        }
        if (!phoneNumber.isEmpty() && !candidatos.contains(phoneNumber)) {
            candidatos.add(phoneNumber);
        }

        for (String candidato : candidatos) {
            Cursor cursor = null;
            try {
                cursor = getContext().getContentResolver().query(
                    Uri.withAppendedPath(PhoneLookup.CONTENT_FILTER_URI, Uri.encode(candidato)),
                    new String[] { PhoneLookup._ID, PhoneLookup.DISPLAY_NAME },
                    null,
                    null,
                    null
                );
                String primerId = null;
                while (cursor != null && cursor.moveToNext()) {
                    String id = clean(cursor.getString(0));
                    String nombre = clean(cursor.getString(1));
                    if (id.isEmpty()) {
                        continue;
                    }
                    // Se prefiere la ficha con nombre: un contacto sin nombre no
                    // explica nada al operador en el aviso del CRM.
                    if (!nombre.isEmpty()) {
                        return new ContactoExistente(id, nombre);
                    }
                    if (primerId == null) {
                        primerId = id;
                    }
                }
                if (primerId != null) {
                    return new ContactoExistente(primerId, "");
                }
            } catch (IllegalArgumentException error) {
                // PhoneLookup rechaza un filtro vacío o mal formado: se prueba el
                // siguiente formato del número.
                Logger.warn(TAG, "PhoneLookup rechazó el formato «" + candidato + "»: " + error.getMessage());
            } finally {
                if (cursor != null) {
                    cursor.close();
                }
            }
        }
        return null;
    }

    /** Cuenta (Google, teléfono, SIM…) donde vive el contacto. Sólo informativo. */
    private String[] cuentaDelContacto(String contactId) {
        if (contactId == null || contactId.isEmpty()) {
            return null;
        }
        Cursor cursor = null;
        String[] respaldo = null;
        try {
            cursor = getContext().getContentResolver().query(
                RawContacts.CONTENT_URI,
                new String[] { RawContacts.ACCOUNT_TYPE, RawContacts.ACCOUNT_NAME },
                RawContacts.CONTACT_ID + " = ? AND " + RawContacts.DELETED + " = 0",
                new String[] { contactId },
                null
            );
            while (cursor != null && cursor.moveToNext()) {
                String tipo = clean(cursor.getString(0));
                String nombre = clean(cursor.getString(1));
                if (tipo.isEmpty()) {
                    continue;
                }
                if ("com.google".equals(tipo)) {
                    return new String[] { tipo, nombre };
                }
                if (respaldo == null) {
                    respaldo = new String[] { tipo, nombre };
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return respaldo;
    }

    private String findContactId(long rawContactId) {
        Cursor cursor = null;
        try {
            cursor = getContext().getContentResolver().query(
                RawContacts.CONTENT_URI,
                new String[] { RawContacts.CONTACT_ID },
                RawContacts._ID + " = ?",
                new String[] { String.valueOf(rawContactId) },
                null
            );
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(RawContacts.CONTACT_ID);
                return column >= 0 ? cursor.getString(column) : null;
            }
        } catch (Exception error) {
            Logger.error(TAG, "El contacto se guardó, pero Android no devolvió su ID agregado", error);
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return null;
    }

    private String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
