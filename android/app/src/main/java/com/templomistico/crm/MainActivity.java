package com.templomistico.crm;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;

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
    private static final String CHANNEL_GENERAL = "crm_general";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createNotificationChannels();
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
