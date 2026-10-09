package com.templomistico.crm;

import android.Manifest;
import android.content.ContentProviderOperation;
import android.content.ContentProviderResult;
import android.content.ContentUris;
import android.database.Cursor;
import android.provider.ContactsContract;
import android.provider.ContactsContract.CommonDataKinds.Phone;
import android.provider.ContactsContract.CommonDataKinds.StructuredName;
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

            ContentProviderResult[] results = applyInsertBatch(
                displayName,
                givenName,
                familyName,
                phoneNumber,
                null,
                null,
                true
            );

            if (!hasInsertedUri(results)) {
                results = applyInsertBatch(
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
                    results = applyInsertBatch(
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

            if (!hasInsertedUri(results)) {
                call.reject("Android no confirmó que el contacto se guardara.", "CONTACT_SAVE_FAILED");
                return;
            }

            long rawContactId = ContentUris.parseId(results[0].uri);
            String contactId = findContactId(rawContactId);

            JSObject result = new JSObject();
            // El ID agregado puede tardar en estar disponible en algunas agendas.
            // En ese caso devolvemos el ID raw; la UI sólo necesita confirmar el guardado.
            result.put("contactId", contactId != null ? contactId : String.valueOf(rawContactId));
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
