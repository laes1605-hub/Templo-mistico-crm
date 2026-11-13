package com.templomistico.crm;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.ContactsContract;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Puente nativo para las llamadas desde la bandeja Personal.
 *
 * Android expone, cuando WhatsApp sincronizó una agenda, una fila de contacto
 * con el MIME de llamada VoIP. Primero intentamos esa acción directa; si no
 * existe, se abre el chat de WhatsApp como respaldo para que el operador toque
 * su botón de llamada.
 *
 * SEGUNDO WHATSAPP PERSONAL: el CRM puede trabajar con dos cuentas personales
 * (el número principal y un número de respaldo para cuando WhatsApp bloquea
 * temporalmente al principal). `openChat` acepta `package` para abrir la app
 * correcta: el WhatsApp normal (com.whatsapp), WhatsApp Business
 * (com.whatsapp.w4b) o el paquete que use la app dual del teléfono. La lista de
 * apps disponibles se obtiene con `listarApps`.
 */
@CapacitorPlugin(
    name = "WhatsAppPersonal",
    permissions = {
        @Permission(
            strings = { Manifest.permission.READ_CONTACTS, Manifest.permission.WRITE_CONTACTS },
            alias = "contacts"
        )
    }
)
public class WhatsAppPersonalPlugin extends Plugin {
    private static final String WHATSAPP_PERSONAL_PACKAGE = "com.whatsapp";
    private static final String WHATSAPP_VOICE_CALL_MIME = "vnd.android.cursor.item/vnd.com.whatsapp.voip.call";
    /** Paquetes conocidos de WhatsApp (normal, Business y variantes de app dual). */
    private static final String[] PAQUETES_CONOCIDOS = {
        "com.whatsapp",
        "com.whatsapp.w4b",
        "com.gbwhatsapp",
        "com.whatsapp.clone",
        "com.whatsapp.dual",
        "com.whatsapp2"
    };

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

        String paquete = sanitizarPaquete(call.getString("package", WHATSAPP_PERSONAL_PACKAGE));
        if (!estaInstalada(paquete)) {
            call.reject(
                "La app de WhatsApp elegida para el segundo número no está instalada en este teléfono (" +
                    paquete + "). Revísala en Ajustes → WhatsApp Personal.",
                "WHATSAPP_PACKAGE_NOT_INSTALLED"
            );
            return;
        }

        getActivity().runOnUiThread(() -> abrirLlamadaOChat(call, phone, contactId, paquete));
    }

    private void abrirLlamadaOChat(PluginCall call, String phone, String contactId, String paquete) {
        try {
            // Si WhatsApp sincronizó este contacto, Android permite llegar
            // directamente a su acción de llamada de voz nativa.
            String voiceDataId = findWhatsAppVoiceCallDataId(contactId);
            if (voiceDataId != null) {
                Intent voiceCall = new Intent(Intent.ACTION_VIEW);
                voiceCall.setDataAndType(
                    Uri.parse("content://com.android.contacts/data/" + voiceDataId),
                    WHATSAPP_VOICE_CALL_MIME
                );
                voiceCall.setPackage(paquete);
                if (voiceCall.resolveActivity(getContext().getPackageManager()) != null) {
                    getActivity().startActivity(voiceCall);
                    resolver(call, true, paquete);
                    return;
                }
            }

            // Respaldo estable: abre el chat en la aplicación elegida. Desde ese
            // chat el icono de teléfono queda a un toque y se conserva la cuenta.
            Intent openWhatsApp = new Intent(
                Intent.ACTION_VIEW,
                Uri.parse("https://wa.me/" + phone)
            );
            openWhatsApp.setPackage(paquete);
            if (openWhatsApp.resolveActivity(getContext().getPackageManager()) == null) {
                call.reject(
                    "No se pudo abrir " + paquete + " para el chat. Si usas una app dual (Dual Messenger, " +
                        "Segundo espacio, etc.), ábrela manualmente: Android no permite lanzarla desde otra app.",
                    "WHATSAPP_OPEN_FAILED"
                );
                return;
            }
            getActivity().startActivity(openWhatsApp);
            resolver(call, false, paquete);
        } catch (Exception error) {
            call.reject(
                "No se pudo abrir WhatsApp para la llamada.",
                "WHATSAPP_OPEN_FAILED",
                error
            );
        }
    }

    private void resolver(PluginCall call, boolean directCall, String paquete) {
        JSObject result = new JSObject();
        result.put("opened", true);
        result.put("directCall", directCall);
        result.put("package", paquete);
        call.resolve(result);
    }

    /**
     * Apps instaladas que pueden abrir enlaces de WhatsApp. Se usa para que el
     * operador elija cuál corresponde al segundo número (app dual o Business).
     * Android 11+ limita la visibilidad: la app declara en el manifiesto que
     * consulta las apps que abren enlaces https.
     */
    @PluginMethod
    public void listarApps(PluginCall call) {
        try {
            PackageManager pm = getContext().getPackageManager();
            Map<String, String> encontradas = new LinkedHashMap<>();

            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/"));
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            List<ResolveInfo> actividades = pm.queryIntentActivities(intent, 0);
            for (ResolveInfo info : actividades) {
                if (info == null || info.activityInfo == null) continue;
                String paquete = info.activityInfo.packageName;
                if (paquete == null || !paquete.toLowerCase().contains("whatsapp")) continue;
                CharSequence etiqueta = info.loadLabel(pm);
                encontradas.put(paquete, etiqueta != null ? etiqueta.toString() : paquete);
            }

            for (String paquete : PAQUETES_CONOCIDOS) {
                if (encontradas.containsKey(paquete) || !estaInstalada(paquete)) continue;
                String etiqueta = paquete;
                try {
                    etiqueta = String(pm.getApplicationLabel(pm.getApplicationInfo(paquete, 0)));
                } catch (Exception ignored) {
                    /* se queda el nombre del paquete */
                }
                encontradas.put(paquete, etiqueta);
            }

            List<Map.Entry<String, String>> lista = new ArrayList<>(encontradas.entrySet());
            lista.sort((a, b) -> {
                if (WHATSAPP_PERSONAL_PACKAGE.equals(a.getKey())) return -1;
                if (WHATSAPP_PERSONAL_PACKAGE.equals(b.getKey())) return 1;
                return a.getValue().compareToIgnoreCase(b.getValue());
            });

            JSArray apps = new JSArray();
            for (Map.Entry<String, String> fila : lista) {
                JSObject app = new JSObject();
                app.put("package", fila.getKey());
                app.put("label", fila.getValue());
                apps.put(app);
            }

            JSObject result = new JSObject();
            result.put("apps", apps);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("No se pudieron leer las apps de WhatsApp instaladas.", "LIST_FAILED", error);
        }
    }

    private boolean estaInstalada(String paquete) {
        if (paquete == null || paquete.trim().isEmpty()) return false;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                getContext().getPackageManager().getPackageInfo(paquete, PackageManager.PackageInfoFlags.of(0));
            } else {
                getContext().getPackageManager().getPackageInfo(paquete, 0);
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private String sanitizarPaquete(String paquete) {
        String limpio = paquete == null ? "" : paquete.trim();
        if (limpio.isEmpty()) return WHATSAPP_PERSONAL_PACKAGE;
        // Sólo nombres de paquete válidos; nunca URLs ni intents externos.
        if (!limpio.matches("[A-Za-z0-9_.]+")) return WHATSAPP_PERSONAL_PACKAGE;
        return limpio;
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

    /** Devuelve la fila específica que WhatsApp registró para llamar. */
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
