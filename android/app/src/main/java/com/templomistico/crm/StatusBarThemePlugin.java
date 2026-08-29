package com.templomistico.crm;

import android.graphics.Color;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Mimetiza la parte superior del teléfono (barra de estado: hora, batería y
 * notificaciones) con la interfaz del CRM.
 *
 * La web llama a este plugin cada vez que cambia el tema (oscuro/claro) desde
 * src/lib/theme.ts. Hace dos cosas:
 *
 *  1. Android 14 y anteriores: pinta la barra de estado y la barra de
 *     navegación con el color de fondo exacto de la app, de modo que no se
 *     vea una franja de otro color arriba de la pantalla.
 *  2. Todas las versiones: elige iconos claros (blancos, para fondos
 *     oscuros) u oscuros (para fondos claros) para que la hora y la batería
 *     siempre se lean bien.
 *
 * En Android 15+ el sistema obliga al modo edge-to-edge y setStatusBarColor
 * se ignora: ahí la propia web se dibuja por debajo de la barra (gracias a
 * viewport-fit=cover) y la franja ya muestra el fondo del CRM por sí sola.
 */
@CapacitorPlugin(name = "StatusBarTheme")
public class StatusBarThemePlugin extends Plugin {

    @PluginMethod
    public void apply(final PluginCall call) {
        final String color = call.getString("color", "");
        final boolean lightIcons = call.getBoolean("lightIcons", true);

        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();

            // Sólo aceptamos hex de 6 dígitos (#RRGGBB); ante cualquier otra
            // cosa se conservan los colores actuales.
            if (color != null && color.matches("(?i)^#[0-9a-f]{6}$")) {
                int parsed = Color.parseColor(color);
                // Ignorados por el sistema en Android 15+; son los que dan el
                // color uniforme en Android 14 y anteriores.
                window.setStatusBarColor(parsed);
                window.setNavigationBarColor(parsed);
            }

            WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, window.getDecorView());
            // "Appearance light status bars" = iconos oscuros. Se activa sólo
            // cuando el fondo es claro (lightIcons=false). Con fondo oscuro
            // (lightIcons=true) los iconos van en blanco.
            controller.setAppearanceLightStatusBars(!lightIcons);
            controller.setAppearanceLightNavigationBars(!lightIcons);

            call.resolve();
        });
    }
}
