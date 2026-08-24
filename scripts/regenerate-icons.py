#!/usr/bin/env python3
"""
Regenera TODOS los iconos y splashes de la app para que el emblema místico
ocupe todo el espacio, SIN espacios en blanco.

Qué hace:
 1. Carga el emblema maestro (scripts/icon-source-emblem.png, fondo transparente)
    y lo reutiliza para todos los tamaños.
 2. Iconos PWA (public/icons/ y out/icons/): fondo oscuro del tema (#090d16)
    + emblema inscrito tocando los 4 bordes (llena el 100% del lienzo).
 3. Iconos launcher de Android legacy (mipmap-*/ic_launcher*.png): mismo
    tratamiento que los PWA (fondo oscuro + emblema que llena).
 4. Foreground de icono adaptativo Android (mipmap-*/ic_launcher_foreground.png):
    emblema sobre fondo TRANSPARENTE al ~66% (zona segura adaptativa).
 5. Splashes de Android (drawable*/splash.png): fondo oscuro del tema + emblema
    centrado, eliminando la pantalla blanca de arranque.

Resultado: cero espacios blancos en navegador, PWA instalada y APK.
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Emblema maestro (ya con fondo transparente, cuadrado, círculo inscrito).
# Generado una sola vez desde el icono original quitando el fondo claro.
EMBLEM_SRC = os.path.join(ROOT, "scripts", "icon-source-emblem.png")

DARK = (9, 13, 22, 255)  # #090d16  (background_color del manifest / tema)

EMBLEM = Image.open(EMBLEM_SRC).convert("RGBA")


def filled_icon(size):
    """Icono cuadrado: fondo oscuro + emblema que llena tocando los bordes."""
    canvas = Image.new("RGBA", (size, size), DARK)
    emb = EMBLEM.resize((size, size), Image.LANCZOS)
    canvas.alpha_composite(emb)
    return canvas.convert("RGB")


def transparent_foreground(size, frac=0.66):
    """Foreground adaptativo: emblema centrado sobre transparente (zona segura)."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    es = int(size * frac)
    emb = EMBLEM.resize((es, es), Image.LANCZOS)
    canvas.alpha_composite(emb, ((size - es) // 2, (size - es) // 2))
    return canvas


def splash(w, h, frac=0.42):
    """Splash: fondo oscuro + emblema centrado."""
    canvas = Image.new("RGBA", (w, h), DARK)
    es = int(min(w, h) * frac)
    emb = EMBLEM.resize((es, es), Image.LANCZOS)
    canvas.alpha_composite(emb, ((w - es) // 2, (h - es) // 2))
    return canvas.convert("RGB")


def save(img, path, fmt="PNG"):
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    img.save(full, fmt)
    print("  wrote", path, img.size)


# ----------------------------------------------------------------------------
# 2) Iconos PWA  (public/icons + out/icons)
# ----------------------------------------------------------------------------
PWA_SIZES = [72, 96, 128, 144, 152, 192, 384, 512]
print("PWA icons:")
for s in PWA_SIZES:
    name = f"icon-{s}x{s}.png"
    ico = filled_icon(s)
    save(ico, f"public/icons/{name}")
    save(ico, f"out/icons/{name}")

# ----------------------------------------------------------------------------
# 3) Launcher Android legacy (cuadrado y redondo)
# ----------------------------------------------------------------------------
MIPMAP = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}
print("Android launcher (legacy):")
for folder, size in MIPMAP.items():
    ico = filled_icon(size)
    save(ico, f"android/app/src/main/res/{folder}/ic_launcher.png")
    save(ico, f"android/app/src/main/res/{folder}/ic_launcher_round.png")

# ----------------------------------------------------------------------------
# 4) Foreground adaptativo Android (transparente, zona segura ~66%)
# ----------------------------------------------------------------------------
FG_SIZES = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}
print("Android adaptive foreground:")
for folder, size in FG_SIZES.items():
    fg = transparent_foreground(size, frac=0.66)
    save(fg, f"android/app/src/main/res/{folder}/ic_launcher_foreground.png")

# ----------------------------------------------------------------------------
# 5) Splashes Android (fondo oscuro + emblema)
# ----------------------------------------------------------------------------
SPLASHES = {
    "drawable/splash.png": (480, 320),
    "drawable-land-mdpi/splash.png": (480, 320),
    "drawable-land-hdpi/splash.png": (800, 480),
    "drawable-land-xhdpi/splash.png": (1280, 720),
    "drawable-land-xxhdpi/splash.png": (1600, 960),
    "drawable-land-xxxhdpi/splash.png": (1920, 1280),
    "drawable-port-mdpi/splash.png": (320, 480),
    "drawable-port-hdpi/splash.png": (480, 800),
    "drawable-port-xhdpi/splash.png": (720, 1280),
    "drawable-port-xxhdpi/splash.png": (960, 1600),
    "drawable-port-xxxhdpi/splash.png": (1280, 1920),
}
print("Android splashes:")
base = "android/app/src/main/res/"
for rel, (w, h) in SPLASHES.items():
    save(splash(w, h), base + rel)

print("\nListo. Sin espacios en blanco en ningún lado.")
