package com.templomistico.crm;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

/**
 * Registra los canales nativos al arrancar la APK. Así Android los muestra en
 * Ajustes > Notificaciones aunque todavía no haya llegado un mensaje ni se haya
 * programado un recordatorio desde la interfaz web.
 */
public class MainActivity extends BridgeActivity {
    private static final String CHANNEL_DEFAULT = "default";
    private static final String CHANNEL_MESSAGES = "crm_messages";
    private static final String CHANNEL_TASK_REMINDERS = "crm_task_reminders";
    private static final String CHANNEL_FOLLOW_UPS = "crm_follow_ups";
    private static final String CHANNEL_GENERAL = "crm_general";

    // Tiempo máximo entre las dos pulsaciones para salir de la aplicación.
    private static final long EXIT_CONFIRMATION_WINDOW_MS = 2_000L;
    private long lastBackPressedAt = 0L;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Debe registrarse antes de super.onCreate(): BridgeActivity construye
        // el bridge de Capacitor dentro de esa llamada.
        registerPlugin(WhatsAppPersonalPlugin.class);
        super.onCreate(savedInstanceState);
        createNotificationChannels();

        // OnBackPressedDispatcher cubre tanto el botón físico/virtual como el
        // gesto de volver de Android, incluido el gesto predictivo reciente.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                handleSystemBack();
            }
        });
    }

    /**
     * Primer "atrás": la interfaz web vuelve a Chats. Sólo una segunda
     * pulsación dentro de dos segundos cierra esta Activity.
     */
    private void handleSystemBack() {
        final long now = SystemClock.elapsedRealtime();
        if (now - lastBackPressedAt <= EXIT_CONFIRMATION_WINDOW_MS) {
            finishAffinity();
            return;
        }

        lastBackPressedAt = now;
        if (getBridge() != null) {
            // El listener de page.tsx restablece la vista de Chats. Usamos un
            // evento Capacitor en vez del historial del WebView para que el
            // comportamiento sea igual con el botón y con el gesto Android.
            getBridge().triggerWindowJSEvent("temploBackButton");
        }
        Toast.makeText(this, "Pulsa atrás otra vez para salir", Toast.LENGTH_SHORT).show();
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }

        // El plugin de Capacitor usa "default" como respaldo. Se registra con
        // un nombre útil en vez de dejar una categoría genérica sin contexto.
        createChannel(
            manager,
            CHANNEL_DEFAULT,
            "Avisos generales",
            "Canal de respaldo para avisos generales de Templo Místico CRM.",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        createChannel(
            manager,
            CHANNEL_MESSAGES,
            "Mensajes de clientes",
            "Avisos cuando recibes un mensaje nuevo de un cliente.",
            NotificationManager.IMPORTANCE_HIGH
        );
        createChannel(
            manager,
            CHANNEL_TASK_REMINDERS,
            "Recordatorios de tareas",
            "Recordatorios de tareas pendientes y fechas de vencimiento.",
            NotificationManager.IMPORTANCE_HIGH
        );
        createChannel(
            manager,
            CHANNEL_FOLLOW_UPS,
            "Seguimientos de clientes",
            "Aviso diario para revisar los clientes en la etapa En seguimiento.",
            NotificationManager.IMPORTANCE_HIGH
        );
        createChannel(
            manager,
            CHANNEL_GENERAL,
            "Avisos del CRM",
            "Confirmaciones, pruebas y avisos generales de Templo Místico CRM.",
            NotificationManager.IMPORTANCE_DEFAULT
        );
    }

    private void createChannel(
        NotificationManager manager,
        String id,
        String name,
        String description,
        int importance
    ) {
        NotificationChannel channel = new NotificationChannel(id, name, importance);
        channel.setDescription(description);
        channel.enableVibration(true);
        channel.enableLights(true);
        manager.createNotificationChannel(channel);
    }
}
