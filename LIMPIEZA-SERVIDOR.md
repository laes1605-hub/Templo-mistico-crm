# Limpieza automática del servidor (diaria 3:00 am, retiene 2 días)

El servidor Ubuntu (stack Docker: n8n + Chatwoot + Evolution API) se llena de
logs y cachés cada pocos días. `scripts/limpieza-servidor.sh` automatiza esa
limpieza con un cron diario a las 3:00 am, hora del servidor.

## Qué hace (retención: 2 días)

1. `journalctl`: deja solo los últimos 2 días (tope adicional de 500 MB).
2. `/var/log`: borra rotados/comprimidos (`*.gz`, `*.1`, `*.old`…) de +2 días.
3. `/tmp` y `/var/tmp`: borra archivos sin usar hace +2 días.
4. APT: `clean` + `autoclean` + `autoremove` (caché y kernels viejos).
5. Snap: borra versiones viejas desactivadas.
6. Docker: purga contenedores/redes/imágenes **sin uso** de +48 h y vacía los
   `*-json.log` de contenedores. El propio log (`/var/log/limpieza-servidor.log`)
   se recorta solo si pasa de 20 MB.
7. PM2: `pm2 flush`, solo si PM2 está corriendo.

## Qué NUNCA toca

- Volúmenes de Docker (bases de datos, chats, adjuntos, n8n, Evolution).
- Contenedores en ejecución ni imágenes en uso.
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

# 4. Programar: todos los días 3:00 am
echo '0 3 * * * root /usr/local/bin/limpieza-servidor.sh >> /var/log/limpieza-servidor.log 2>&1' \
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
cat /etc/cron.d/limpieza-servidor   # debe mostrar la línea de las 3 am
tail -n 40 /var/log/limpieza-servidor.log  # al día siguiente, el reporte
df -h /                             # espacio antes/después
grep CRON /var/log/syslog | grep limpieza | tail -n 5
```

## Cambiar hora o retención

- Hora: editar `/etc/cron.d/limpieza-servidor` (formato cron, hora del servidor).
- Retención: `RETENCION_DIAS=7` como variable de entorno en la línea del cron,
  ej: `0 3 * * * root RETENCION_DIAS=7 /usr/local/bin/limpieza-servidor.sh …`.

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
