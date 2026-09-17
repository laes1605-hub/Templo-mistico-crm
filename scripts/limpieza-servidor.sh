#!/usr/bin/env bash
# =====================================================================
# limpieza-servidor.sh — Limpieza diaria del servidor Ubuntu
# Templo Místico · stack Docker (n8n + Chatwoot + Evolution API)
#
# Qué hace (todo con retención de 2 días):
#   1. Diario del sistema (journalctl): deja solo los últimos 2 días.
#   2. /var/log: borra rotados/comprimidos (.gz, .1, .old…) de +2 días
#      y recorta logs activos gigantes (válvula de seguridad).
#   3. /tmp y /var/tmp: borra archivos sin usar hace +2 días.
#   4. APT: limpia caché y paquetes huérfanos (incluye kernels viejos).
#   5. Snap: borra versiones viejas desactivadas.
#   6. Docker: purga contenedores/redes/imágenes SIN USO de +48 h,
#      vacía los logs de contenedores (*-json.log) e informa
#      volúmenes huérfanos (sin tocarlos).
#   7. Backups locales (/root/backups): borra los de +2 días,
#      conservando SIEMPRE los 2 más recientes.
#   8. Logs del monitor (/root/monitor*.log): tope de 10 MB.
#   9. PM2: vacía sus logs (solo si PM2 está corriendo).
#
# Qué NUNCA toca: volúmenes de Docker (bases de datos, chats, adjuntos,
# n8n, Evolution), contenedores en ejecución ni imágenes en uso.
#
# Uso:
#   sudo /usr/local/bin/limpieza-servidor.sh            # limpieza real
#   sudo /usr/local/bin/limpieza-servidor.sh --dry-run  # simulacro
# Cron (diario 3:00 am, hora del servidor):
#   0 3 * * * root /usr/local/bin/limpieza-servidor.sh >> /var/log/limpieza-servidor.log 2>&1
# =====================================================================

set -u

RETENCION_DIAS="${RETENCION_DIAS:-2}"
BACKUP_DIRS="${BACKUP_DIRS:-/root/backups}"
MANTENER_ULTIMOS="${MANTENER_ULTIMOS:-2}"
DRY_RUN="${DRY_RUN:-0}"
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1
LOG_PROPIO="/var/log/limpieza-servidor.log"

ahora() { date '+%Y-%m-%d %H:%M:%S'; }
msg()   { echo "[$(ahora)] $*"; }

run() { # ejecuta un comando (o lo simula con DRY_RUN=1), sin frenar el resto
  if [ "$DRY_RUN" = "1" ]; then
    msg "[SIMULACRO] $*"
  else
    "$@" || msg "AVISO: falló: $*"
  fi
}

truncar() { # vacía un archivo sin borrarlo (es lo que esperan los demonios)
  if [ "$DRY_RUN" = "1" ]; then
    msg "[SIMULACRO] vaciar $1"
  else
    : > "$1" 2>/dev/null || msg "AVISO: no se pudo vaciar $1"
  fi
}

recortar_final() { # deja solo las últimas N líneas (válvula de seguridad)
  local f="$1" lineas="$2" tmp="$1.recorte.$$"
  if [ "$DRY_RUN" = "1" ]; then
    msg "[SIMULACRO] recortar $f a las últimas $lineas líneas"
    return 0
  fi
  tail -n "$lineas" "$f" > "$tmp" 2>/dev/null && cat "$tmp" > "$f" 2>/dev/null
  rm -f "$tmp"
}

msg "===== Limpieza diaria: inicio (retención ${RETENCION_DIAS} días) ====="
[ "$DRY_RUN" = "1" ] && msg "MODO SIMULACRO: no se borra nada."
[ "$(id -u)" -ne 0 ] && msg "AVISO: no eres root; varias secciones fallarán."
df -h / 2>/dev/null || true

# --- El propio log de limpieza: si pasa de 20 MB, deja las últimas 2000 líneas
if [ -f "$LOG_PROPIO" ] && [ "$DRY_RUN" != "1" ]; then
  if [ "$(du -k "$LOG_PROPIO" 2>/dev/null | cut -f1)" -gt 20480 ]; then
    recortar_final "$LOG_PROPIO" 2000
  fi
fi

# --- 1. Diario del sistema: solo últimos 2 días (y tope de 500 MB) ---
if command -v journalctl >/dev/null 2>&1; then
  msg "journal: antes: $(journalctl --disk-usage 2>/dev/null || echo '?')"
  run journalctl --vacuum-time="${RETENCION_DIAS}d" 2>/dev/null
  run journalctl --vacuum-size=500M 2>/dev/null
  [ "$DRY_RUN" != "1" ] && msg "journal: ahora: $(journalctl --disk-usage 2>/dev/null || echo '?')"
else
  msg "journal: journalctl no existe, se omite."
fi

# --- 2. /var/log: rotados de +2 días + recorte de activos gigantes ---
if [ -d /var/log ]; then
  if [ "$DRY_RUN" = "1" ]; then
    N=$(find /var/log -type f \( -name '*.gz' -o -name '*.xz' -o -name '*.zst' -o -name '*.1' -o -name '*.old' -o -regex '.*\.[0-9]+' \) -mtime +"$RETENCION_DIAS" 2>/dev/null | wc -l)
    msg "[SIMULACRO] se borrarían $N rotados de /var/log con +${RETENCION_DIAS} días."
  else
    N=$(find /var/log -type f \( -name '*.gz' -o -name '*.xz' -o -name '*.zst' -o -name '*.1' -o -name '*.old' -o -regex '.*\.[0-9]+' \) -mtime +"$RETENCION_DIAS" -delete -print 2>/dev/null | wc -l)
    msg "/var/log: $N rotados borrados (+${RETENCION_DIAS} días)."
  fi
  # Válvula: ningún .log activo pasando de 500 MB (deja últimas 20000 líneas)
  find /var/log -type f -name '*.log' -size +500M 2>/dev/null | while read -r f; do
    [ -n "$f" ] && msg "/var/log: $f pesa $(du -sh "$f" | cut -f1), recortando…" && recortar_final "$f" 20000
  done
else
  msg "/var/log no existe, se omite."
fi

# --- 3. Temporales sin usar hace +2 días (solo archivos, sin salir del disco) ---
for d in /tmp /var/tmp; do
  [ -d "$d" ] || continue
  if [ "$DRY_RUN" = "1" ]; then
    N=$(find "$d" -xdev -type f -atime +"$RETENCION_DIAS" 2>/dev/null | wc -l)
    msg "[SIMULACRO] se borrarían $N archivos de $d sin usar hace +${RETENCION_DIAS} días."
  else
    N=$(find "$d" -xdev -type f -atime +"$RETENCION_DIAS" -delete -print 2>/dev/null | wc -l)
    msg "$d: $N archivos temporales borrados."
  fi
done

# --- 4. APT: caché + huérfanos ---
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  run apt-get clean
  run apt-get autoclean
  run apt-get autoremove -y
else
  msg "APT no existe, se omite."
fi

# --- 5. Snap: versiones viejas desactivadas ---
if command -v snap >/dev/null 2>&1; then
  snap list --all 2>/dev/null | awk '/disabled/{print $1, $3}' | while read -r nombre rev; do
    [ -n "${nombre:-}" ] && [ -n "${rev:-}" ] && run snap remove "$nombre" --revision="$rev"
  done
  msg "snap: versiones desactivadas revisadas."
else
  msg "snap no existe, se omite."
fi

# --- 6. Docker: sin uso (+48 h) + vaciado de logs de contenedores ---
if command -v docker >/dev/null 2>&1; then
  HASTA="$((RETENCION_DIAS * 24))h"
  msg "docker: uso antes:"; docker system df 2>/dev/null || true
  run docker container prune -f --filter "until=$HASTA"
  run docker network prune -f --filter "until=$HASTA"
  run docker image prune -af --filter "until=$HASTA"
  run docker builder prune -af --filter "until=$HASTA"
  # NUNCA «docker volume prune»: ahí viven las BD, chats y adjuntos.
  # Solo se informa cuántos huérfanos hay (solo lectura, no borra).
  HUERFANOS=$(docker volume ls -qf dangling=true 2>/dev/null | wc -l)
  msg "docker: $HUERFANOS volumen(es) sin usar (no se tocan)."
  DOCKER_DIR="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
  if [ -d "$DOCKER_DIR/containers" ]; then
    total=0; n=0
    for f in "$DOCKER_DIR"/containers/*/*-json.log; do
      [ -f "$f" ] || continue
      n=$((n + 1))
      bytes=$(stat -c%s "$f" 2>/dev/null || echo 0)
      total=$((total + bytes))
      truncar "$f"
    done
    msg "docker: $n logs de contenedores vaciados (~$((total / 1024 / 1024)) MB liberados)."
  else
    msg "docker: sin carpeta de logs ($DOCKER_DIR/containers)."
  fi
  if [ "$DRY_RUN" != "1" ]; then msg "docker: uso ahora:"; docker system df 2>/dev/null || true; fi
else
  msg "docker no existe, se omite."
fi

# --- 7. Backups locales: borra los de +2 días, conserva los 2 más recientes ---
for dir in $BACKUP_DIRS; do
  [ -d "$dir" ] || { msg "backups: $dir no existe, se omite."; continue; }
  mapfile -t TODOS < <(find "$dir" -maxdepth 1 -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | cut -d' ' -f2-)
  if [ "${#TODOS[@]}" -le "$MANTENER_ULTIMOS" ]; then
    msg "backups: $dir tiene ${#TODOS[@]} archivo(s), se conservan todos."
    continue
  fi
  borrados=0; liberado=0; i=0
  for f in "${TODOS[@]}"; do
    i=$((i + 1))
    if [ "$i" -le "$MANTENER_ULTIMOS" ]; then
      msg "backups: conservado (reciente): $f"
      continue
    fi
    if [ -n "$(find "$f" -mtime +"$RETENCION_DIAS" -print 2>/dev/null)" ]; then
      bytes=$(stat -c%s "$f" 2>/dev/null || echo 0)
      if [ "$DRY_RUN" = "1" ]; then
        msg "[SIMULACRO] borrar backup $f (~$((bytes / 1024 / 1024)) MB)"
      else
        rm -f "$f" && borrados=$((borrados + 1)) && liberado=$((liberado + bytes)) || msg "AVISO: no se pudo borrar $f"
      fi
    else
      msg "backups: conservado (dentro de ${RETENCION_DIAS} días): $f"
    fi
  done
  [ "$DRY_RUN" != "1" ] && msg "backups: $dir: $borrados borrados (~$((liberado / 1024 / 1024)) MB liberados)."
done

# --- 8. Logs del monitor: crecen cada 5 min, tope 10 MB (últimas 5000 líneas) ---
for f in /root/monitor.log /root/monitor_fish.log; do
  [ -f "$f" ] || continue
  kb=$(du -k "$f" 2>/dev/null | cut -f1)
  if [ "${kb:-0}" -gt 10240 ]; then
    msg "monitor: $f pesa $(du -sh "$f" 2>/dev/null | cut -f1), recortando…"
    recortar_final "$f" 5000
  else
    msg "monitor: $f OK ($(du -sh "$f" 2>/dev/null | cut -f1))."
  fi
done

# --- 9. PM2: vaciar logs solo si está corriendo ---
if command -v pm2 >/dev/null 2>&1 && command -v pgrep >/dev/null 2>&1 && pgrep -f PM2 >/dev/null 2>&1; then
  run pm2 flush
else
  msg "pm2 no está corriendo, se omite."
fi

df -h / 2>/dev/null || true
msg "===== Limpieza diaria: fin ====="
