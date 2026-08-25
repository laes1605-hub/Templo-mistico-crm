package com.templomistico.crm;

import android.Manifest;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/**
 * Puente nativo para las llamadas desde la bandeja Personal.
 *
 * Android expone, cuando WhatsApp sincronizó una agenda, una fila de contacto
 * con el MIME de llamada VoIP. Primero intentamos esa acción directa y siempre
 * forzamos com.whatsapp (WhatsApp Personal, nunca Business). No todas las
 * versiones/agenda exponen dicha fila; en ese caso se abre el chat de WhatsApp
 * Personal como respaldo para que el operador toque su botón de llamada.
 */
@CapacitorPlugin(
    name = "WhatsAppPersonal",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_CONTACTS }, alias = "contacts")
    }
)
public class WhatsAppPersonalPlugin extends Plugin {
    private static final String WHATSAPP_PERSONAL_PACKAGE = "com.whatsapp";
    private static final String WHATSAPP_VOICE_CALL_MIME = "vnd.android.cursor.item/vnd.com.whatsapp.voip.call";

    @PluginMethod
    public void openChat(PluginCall call) {
        String rawPhone = call.getString("phone", "");
        String phone = rawPhone.replaceAll("\\D", "");
        if (phone.length() < 8) {
            call.reject("El número no es válido para WhatsApp.", "INVALID_PHONE");
            return;
        }

        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            call.reject(
                "Debes permitir el acceso a Contactos y guardar primero este cliente para llamar.",
                "CONTACT_PERMISSION_REQUIRED"
            );
            return;
        }

        String contactId = findSavedContactId(phone);
        if (contactId == null) {
            call.reject(
                "Por seguridad solo puedes llamar a contactos guardados en este teléfono.",
                "CONTACT_NOT_SAVED"
            );
            return;
        }

        getActivity().runOnUiThread(() -> abrirLlamadaOChat(call, phone, contactId));
    }

    private void abrirLlamadaOChat(PluginCall call, String phone, String contactId) {
        try {
            // Si WhatsApp Personal sincronizó este contacto, Android permite
            // llegar directamente a su acción de llamada de voz nativa.
            String voiceDataId = findWhatsAppVoiceCallDataId(contactId);
            if (voiceDataId != null) {
                Intent voiceCall = new Intent(Intent.ACTION_VIEW);
                voiceCall.setDataAndType(
                    Uri.parse("content://com.android.contacts/data/" + voiceDataId),
                    WHATSAPP_VOICE_CALL_MIME
                );
                voiceCall.setPackage(WHATSAPP_PERSONAL_PACKAGE);
                if (voiceCall.resolveActivity(getContext().getPackageManager()) != null) {
                    getActivity().startActivity(voiceCall);
                    resolve(call, true);
                    return;
                }
            }

            // Respaldo estable: abre el chat en la aplicación oficial Personal.
            // WhatsApp no garantiza el MIME de llamada en todas las versiones o
            // agendas, pero desde ese chat el icono de teléfono siempre queda a
            // un toque y se conserva la cuenta madre de WhatsApp Personal.
            Intent openWhatsApp = new Intent(
                Intent.ACTION_VIEW,
                Uri.parse("https://wa.me/" + phone)
            );
            openWhatsApp.setPackage(WHATSAPP_PERSONAL_PACKAGE);
            if (openWhatsApp.resolveActivity(getContext().getPackageManager()) == null) {
                call.reject(
                    "No se encontró WhatsApp Personal en este teléfono. Instala o actualiza la app oficial.",
                    "WHATSAPP_PERSONAL_NOT_INSTALLED"
                );
                return;
            }
            getActivity().startActivity(openWhatsApp);
            resolve(call, false);
        } catch (Exception error) {
            call.reject(
                "No se pudo abrir WhatsApp Personal para la llamada.",
                "WHATSAPP_OPEN_FAILED",
                error
            );
        }
    }

    private void resolve(PluginCall call, boolean directCall) {
        JSObject result = new JSObject();
        result.put("opened", true);
        result.put("directCall", directCall);
        call.resolve(result);
    }

    /** Consulta PhoneLookup con y sin el + para aceptar agendas normalizadas. */
    private String findSavedContactId(String phone) {
        String withCountryPrefix = findContactId("+" + phone);
        return withCountryPrefix != null ? withCountryPrefix : findContactId(phone);
    }

    private String findContactId(String phone) {
        Uri lookup = Uri.withAppendedPath(
            ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
            Uri.encode(phone)
        );
        Cursor cursor = null;
        try {
            cursor = getContext().getContentResolver().query(
                lookup,
                new String[] { ContactsContract.PhoneLookup._ID },
                null,
                null,
                null
            );
            return cursor != null && cursor.moveToFirst() ? cursor.getString(0) : null;
        } catch (SecurityException ignored) {
            return null;
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    /** Devuelve la fila específica que WhatsApp Personal registró para llamar. */
    private String findWhatsAppVoiceCallDataId(String contactId) {
        Cursor cursor = null;
        try {
            cursor = getContext().getContentResolver().query(
                ContactsContract.Data.CONTENT_URI,
                new String[] { ContactsContract.Data._ID },
                ContactsContract.Data.CONTACT_ID + " = ? AND " + ContactsContract.Data.MIMETYPE + " = ?",
                new String[] { contactId, WHATSAPP_VOICE_CALL_MIME },
                null
            );
            return cursor != null && cursor.moveToFirst() ? cursor.getString(0) : null;
        } catch (SecurityException ignored) {
            return null;
        } finally {
            if (cursor != null) cursor.close();
        }
    }
}
