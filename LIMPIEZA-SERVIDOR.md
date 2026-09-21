# Limpieza automática del servidor (diaria 5:00 am, retiene 2 días)

El servidor Ubuntu (stack Docker: n8n + Chatwoot + Evolution API) se llena de
logs, cachés y backups cada pocos días. `scripts/limpieza-servidor.sh`
automatiza esa limpieza con un cron diario a las 5:00 am, hora del servidor.
Son las 5 (y no las 3) a propósito: el `backup.sh` del servidor corre de
3:00 a ~4:30 am, y la limpieza debe podar DESPUÉS de que el respaldo termina.

## Qué hace (retención: 2 días)

1. `journalctl`: deja solo los últimos 2 días (tope adicional de 500 MB).
2. `/var/log`: borra rotados/comprimidos (`*.gz`, `*.1`, `*.old`…) de +2 días.
3. `/tmp` y `/var/tmp`: borra archivos sin usar hace +2 días.
4. APT: `clean` + `autoclean` + `autoremove` (caché y kernels viejos).
5. Snap: borra versiones viejas desactivadas.
6. Docker: purga contenedores/redes/imágenes **sin uso** de +48 h, vacía los
   `*-json.log` de contenedores e informa volúmenes huérfanos (sin tocarlos).
   El propio log (`/var/log/limpieza-servidor.log`) se recorta solo si pasa
   de 20 MB.
7. Backups locales (`/root/backups`): borra masters (`backup_completo_*`) y
   por-servicio (`chatwoot/`, `evolution/`, `n8n/`, `configs/`, `supabase/`)
   de +2 días, conservando **siempre los 2 más recientes de cada set**
   aunque sean viejos. Las rarezas (carpetas coladas, sueltos) solo se
   informan, no se tocan.
8. Logs que crecen solos (`/root/monitor.log`, `/root/monitor_fish.log`,
   `/root/backups/backup.log`): tope de 10 MB (deja las últimas 5000 líneas).
9. PM2: `pm2 flush`, solo si PM2 está corriendo.

## Qué NUNCA toca

- Volúmenes de Docker (bases de datos, chats, adjuntos, n8n, Evolution).
- Contenedores en ejecución ni imágenes en uso.
- Los 2 backups más recientes (aunque tengan más de 2 días).
- Sin `set -e`: si una sección falla, las demás siguen corriendo.

## Instalación en el servidor

```bash
# 0. Copiar el script al servidor (desde este repo)
scp scripts/limpieza-servidor.sh TU-USUARIO@TU-SERVIDOR:/tmp/
ssh TU-USUARIO@TU-SERVIDOR

# 1. Hora de Colombia (para que las 3 am sean hora Colombia)
sudo timedatectl set-timezone America/Bogota
timedatectl | grep -i zone || date

# 2. Instalar el script
sudo install -m 0755 /tmp/limpieza-servidor.sh /usr/local/bin/limpieza-servidor.sh
bash -n /usr/local/bin/limpieza-servidor.sh && echo "Sintaxis OK"

# 3. Simulacro (no borra nada, muestra lo que haría)
sudo /usr/local/bin/limpieza-servidor.sh --dry-run | head -n 60

# 4. Programar: todos los días 5:00 am (después del backup de las 3 am)
echo '0 5 * * * root /usr/local/bin/limpieza-servidor.sh >> /var/log/limpieza-servidor.log 2>&1' \
  | sudo tee /etc/cron.d/limpieza-servidor > /dev/null
sudo chmod 644 /etc/cron.d/limpieza-servidor

# 5. Servicio cron activo
sudo systemctl enable --now cron
systemctl is-active cron

# 6. (Opcional) una limpieza real ya, para comprobar
sudo /usr/local/bin/limpieza-servidor.sh | tail -n 20
```

## Verificación

```bash
cat /etc/cron.d/limpieza-servidor   # debe mostrar la línea de las 5 am
tail -n 40 /var/log/limpieza-servidor.log  # al día siguiente, el reporte
df -h /                             # espacio antes/después
grep CRON /var/log/syslog | grep limpieza | tail -n 5
```

## Cambiar hora o retención

- Hora: editar `/etc/cron.d/limpieza-servidor` (formato cron, hora del servidor).
- Retención: `RETENCION_DIAS=7` como variable de entorno en la línea del cron,
  ej: `0 3 * * * root RETENCION_DIAS=7 /usr/local/bin/limpieza-servidor.sh …`.
- Backups: `BACKUP_DIRS="/root/backups /otra/ruta"` (raíces, separadas por
  espacio), `BACKUP_SUBDIRS="chatwoot evolution n8n configs supabase"` (sets
  por servicio dentro de cada raíz) y `MANTENER_ULTIMOS=2` (mínimo que siempre
  se conserva por set).

## Notas

- El cron de `monitor.sh` (`>> /root/monitor.log`) escribe cada línea DOS
  veces, porque el script ya guarda con `tee -a` en ese mismo archivo. Si se
  quiere, cambiar ese cron a `... /root/monitor.sh >/dev/null 2>&1` para que
  el log crezca a la mitad. No es urgente: la limpieza lo recorta a diario.
  Lo mismo aplica al cron de `backup.sh` con `backup.log`.
- El `backup.sh` del servidor NO se modifica a propósito: su retención
  propia (7 días por servicio, 30 días masters) queda como red de seguridad
  amplia, y este script impone la retención real de 2 días corriendo después.
- `backup.sh` y `monitor.sh` contienen claves (Evolution, Supabase). Deben
  quedar solo-legibles por root: `sudo chmod 600 /root/backup.sh
  /root/monitor.sh /root/monitor_fish.sh`.

## Opcional (recomendado): tope a los logs de Docker

La limpieza diaria vacía los logs, pero entre una y otra pueden crecer mucho.
Este tope (10 MB × 3 archivos por contenedor) lo evita. ⚠️ **Reinicia Docker:
WhatsApp/n8n se caen ~1 minuto** — hacerlo en horario valle. Aplica a
contenedores nuevos; los actuales quedan cubiertos por la limpieza diaria.

```bash
sudo mkdir -p /etc/docker
printf '%s\n' '{' '  "log-driver": "json-file",' '  "log-opts": {' \
  '    "max-size": "10m",' '    "max-file": "3"' '  }' '}' \
  | sudo tee /etc/docker/daemon.json > /dev/null
sudo systemctl restart docker
```

## Desinstalar

```bash
sudo rm /etc/cron.d/limpieza-servidor /usr/local/bin/limpieza-servidor.sh
```
