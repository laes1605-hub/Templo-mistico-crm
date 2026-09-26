# 🆓 SERVIDOR GRATUITO EN ORACLE CLOUD — GUÍA PASO A PASO

**Objetivo:** reemplazar el EC2 de AWS vencido con una máquina **siempre gratuita** (sin vencimiento)
de Oracle Cloud: hasta **4 OCPU ARM + 24 GB RAM + 200 GB disco + 10 TB tráfico/mes** — suficiente
para correr n8n + Chatwoot + la API de WhatsApp con Docker.

> ⚠️ **Límite 2026:** las cuentas gratuitas nuevas pueden estar limitadas a **2 OCPU / 12 GB**
> (las cuentas convertidas a Pay-As-You-Go conservan 4/24). Aun 2/12 te sobra para el stack actual.

---

## 📋 Antes de empezar — lo que necesitas

- [ ] Un correo electrónico **nuevo o que nunca se haya usado con Oracle Cloud** (1 cuenta por correo).
- [ ] **Tarjeta de crédito o débito** Visa/Mastercard/Amex/Discover (solo para verificar identidad;
  Oracle hace una retención temporal de ~1 USD que devuelve. **No cobra nada** si te quedas en Always Free).
- [ ] Teléfono móvil (llegará un código por SMS).
- [ ] Tu dominio (para los webhooks de WhatsApp/Chatwoot necesitarás HTTPS: `n8n.tudominio.com`, `chat.tudominio.com`).

---

## 1️⃣ Crear la cuenta (10 min)

1. Ve a **https://signup.oraclecloud.com**.
2. Llena el formulario:
   - **País:** Colombia.
   - **Nombre y correo** → te llegará un link de verificación (vence en 30 min).
   - **Contraseña** y **nombre de la cuenta en la nube** (ej: `templo-mistico`). Guárdalos: es tu usuario de acceso.
3. ⭐ **Elegir la región principal (Home Region) — NO SE PUEDE CAMBIAR DESPUÉS.**
   - Recomendada para Colombia: **US East (Ashburn)** → ~60–70 ms desde Bogotá.
   - Alternativas válidas: **US West (Phoenix)**, **São Paulo (Brazil)** o **Mexico Northeast (Monterrey)**
     (~70–90 ms desde Bogotá — confirmado Always Free elegible en 2026).
   - Verifica que diga *"Always Free eligible"* junto al nombre.
4. Dirección y teléfono (código SMS para verificar).
5. **Método de verificación de pago:** tarjeta. Verás un cargo temporal de ~1 USD que se revierte.
   - Si la tarjeta es rechazada: usa una real (no virtual/prepagada), que la dirección de facturación
     coincida con el estado de la tarjeta, y sin VPN activa.
6. Acepta términos → **Iniciar prueba gratuita**. La cuenta queda activa en unos minutos.

> 🎁 Adicional: las cuentas nuevas suelen recibir **~300 USD de crédito de prueba por 30 días**
> para cualquier servicio. Los recursos **Always Free siguen gratis cuando el crédito se agote**.

---

## 2️⃣ Crear la instancia ARM (5 min)

1. Entra a **https://cloud.oracle.com** → inicia sesión.
2. Menú hamburguesa (☰) → **Compute → Instances → Create Instance**.
3. Configura:
   - **Name:** `templo-crm`
   - **Image:** *Ubuntu* → **Canonical Ubuntu 24.04** (se detecta ARM automáticamente).
   - **Shape:** *Cambiar unidad* → pestaña **Ampere** → **VM.Standard.A1.Flex** (debe decir
     *"Siempre gratis elegible"*).
   - ⚠️ **OJO:** la tabla muestra **1 OCPU / 6 GB — es solo el valor por defecto, no el límite**.
     Los sliders de OCPU y Memoria están escondidos: (a) click en la **flechita ▶** a la izquierda
     de "VM.Standard.A1.Flex" — la fila se expande y aparecen los sliders adentro; o (b) en el
     menú lateral del formulario, sección **"Compilación de unidad"**. Se **arrastran** con el mouse.
     Sube **OCPU a 4** y **Memoria a 24 GB** (tope Always Free de A1). Si el slider solo llega a
     2 OCPU / 12 GB, déjalo ahí (restricción para cuentas nuevas, gratis igual).
     Recién después dale a *Seleccionar unidad*.
   - **SSH Keys:** selecciona *Generate a key pair* → **descarga AMBAS llaves** (privada y pública)
     y guárdalas en un lugar seguro. **Sin la privada no vuelves a entrar al servidor.**
4. Abajo, en **Boot volume**: sube el tamaño a **100 GB** (el free tier cubre hasta 200 GB en total;
  así n8n + Chatwoot + backups holgados).
   - ⚠️ **VPU/GB (rendimiento del disco): déjalo en el default "Equilibrado / 10 VPU"** — no lo
     subas: los niveles de rendimiento superior generan cobros fuera del Always Free.
5. **Create**.

### ❗ Si sale "Out of capacity" (error clásico)

Las instancias ARM gratuitas a veces no tienen cupo en tu región. Opciones, en orden:

1. **Antes de cerrar el formulario: "Guardar como pila"** — deja la configuración guardada y los
   reintentos son de un click (Resource Manager → Stacks), sin rellenar nada de nuevo.
2. **Reintenta** varias veces (la capacidad se libera a cada rato) o cambia de Availability Domain.
3. **Pide una máquina más pequeña para entrar:** crea con **2 OCPU / 12 GB** (o incluso 1/6) —
   un pedido menor entra más fácil en los huecos de capacidad. Una vez creada se agranda con
   *Más acciones → Editar unidad* cuando haya cupo.
4. **Sube la cuenta a Pay-As-You-Go (PAYG)** — confirmado que sigue funcionando en 2026:
   - Link **"cambiar de versión"** del banner de prueba, o Menú ☰ → **Billing & Cost Management →
     Upgrade and Payment Management → Pay As You Go**.
   - Confirmas la tarjeta (retención de ~100 USD que **se devuelve**).
   - Con PAYG la instancia A1 se crea al primer intento, **sigue siendo gratis** dentro de los
     límites Always Free (4 OCPU/24 GB/200 GB), restaura el tope 4/24 en cuentas nuevas, y además
     **no te pueden reclamar la máquina por inactividad**.
   - 🛡️ Después actívate protecciones: crea un **Budget de $1 USD** con alerta al 100% en
     *Billing → Budgets* para que te llegue un correo si algo llegara a cobrarse.

---

## 🔁 PLAN B: VPS económicos verificados (sep 2026) — sin drama de capacidad

Si Oracle sigue en "Out of capacity" o quieres algo inmediato y estable:

| Proveedor | Plan | Specs | Precio | Ubicación | Link |
|---|---|---|---|---|---|
| **Contabo** ⭐ | Cloud VPS 4 (antes VPS 10) | 4 vCPU / **8 GB** / 100 GB SSD / tráfico ilimitado | **$5.28/mes** (renueva $6.60) | **New York** (~70 ms) | https://contabo.com |
| **RackNerd** ⭐ | Popular | 2 vCPU / **3.5 GB** / 65 GB SSD / 7 TB | **$32.49/año** (~$2.7/mes) | Dallas o NY | https://www.racknerd.com (Specials) |
| RackNerd | Standard | 3 vCPU / 4 GB / 105 GB | $43.88/año | Dallas o NY | ídem |
| **Hostinger** | KVM 2 | 2 vCPU / 8 GB / 100 GB NVMe | $8.99/mes (renueva ~$16, contrato 24 m) | EE.UU. / São Paulo | https://www.hostinger.com/vps-hosting |
| IONOS | VPS | 2–4 GB | ~$2–4/mes | EE.UU. / España | https://www.ionos.com |
| Hetzner | CPX11 | 2 vCPU / 2 GB | ~$7–8/mes | Ashburn | https://console.hetzner.cloud/register |
| Netcup | RS 1000 G12 | 4 dedicados / 8 GB | €8.74/mes | Solo Europa (~140 ms) | https://www.netcup.com |

Notas:
- **Todos aceptan tarjeta débito virtual** (sin retención tipo Oracle). Contabo/Hostinger/IONOS
  pagan mensual; RackNerd es anual con precio congelado de por vida.
- **Recomendado para todo el stack (Chatwoot + n8n + WhatsApp):** Contabo VPS 10 NY — 8 GB sobran.
- **Presupuesto mínimo:** RackNerd 3.5 GB/año — n8n + WhatsApp API cómodo, Chatwoot ajustado (usar swap).
- Contabo: CPU compartida/oversold y disco más lento que Hetzner; OK para cargas ligeras.
- RackNerd: a veces hace verificación manual del primer pedido (1–2 h) y rechaza pedidos con VPN activa.
- Las líneas baratas de Hetzner (CAX/CX) solo se venden en Europa; en EE.UU. es la línea CPX (AMD).

---

## 🔁 PLAN C: Hetzner (~US$6–10/mes) — calidad premium

1. **Cuenta:** https://console.hetzner.cloud/register (cuentas nuevas reciben ~$20 de crédito de
   prueba; acepta tarjetas de débito virtuales, a diferencia del PAYG de Oracle).
2. **Crear servidor** (`+ Add Server`):
   - **Location:** Ashburn, US (el más cercano a Colombia ~60 ms).
   - **Image:** Ubuntu 24.04.
   - **Type:** Shared vCPU (x86) → **CPX11** (2 vCPU/2 GB, ~$6–7/mes; justo para n8n + WhatsApp API)
     o **CPX21** (3 vCPU/4 GB, ~$9–10/mes; cómodo para sumar Chatwoot). ⭐
   - **SSH Key:** pega tu clave pública → Create order.
   - Nota: las líneas baratas CAX/CX son solo de Europa; en EE.UU. se vende la línea CPX (AMD).
   - Tráfico incluido en EE.UU.: 1 TB/mes (sobra para chats y webhooks).
3. **Ventajas:** la IP es estática de fábrica (no se reserva nada), no hay firewall interno tipo
   iptables de Oracle (opcionalmente usa el Cloud Firewall del panel para dejar solo 22/80/443),
   y no reclaman instancias por inactividad.
4. **Diferencia clave al seguir esta guía:** en Hetzner se entra como `root`
   (`ssh -i clave.key root@IP`) y todo lo demás (Docker, Caddy, compose, DNS) es idéntico.

---

## 3️⃣ Reservar la IP pública (para que no cambie)

La IP por defecto es *efímera*: cambia si apagas/enciendes la máquina. Como tus webhooks de
WhatsApp y Chatwoot apuntan a esa IP (o al dominio), resérvala:

1. Instancia → **Attached VNICs** → tu VNIC → **IPv4 Addresses** → ✏️ Edit.
2. En *Public IP type* elige **Reserved public IP** → *Create a reserved public IP* → Update.

---

## 4️⃣ Conectarse por SSH

```bash
# desde tu PC (Linux/Mac/Git Bash en Windows)
chmod 400 ~/Descargas/ssh-key-*.key
ssh -i ~/Descargas/ssh-key-*.key ubuntu@TU_IP_PUBLICA
```

---

## 5️⃣ Abrir puertos (dos capas — Oracle bloquea en ambas)

### Capa 1: firewall de nube (Security List de la VCN)

Menú ☰ → **Networking → Virtual Cloud Networks** → tu VCN → **Security Lists → Default Security List → Add Ingress Rules**. Agrega **dos reglas** (una por puerto):

| Source CIDR | IP Protocol | Destination Port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

> Deja el `22` (SSH) como está. El resto de servicios (n8n 5678, Chatwoot 3000…) **no se abren**:
> irán detrás de un proxy HTTPS por 443.

### Capa 2: firewall interno de Ubuntu (la imagen de Oracle viene cerrada)

```bash
sudo iptables -I INPUT -p tcp --dport 80  -m state --state NEW -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -m state --state NEW -j ACCEPT
sudo netfilter-persistent save
```

---

## 6️⃣ Instalar Docker

```bash
sudo apt update && sudo apt -y upgrade
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
newgrp docker
docker --version   # verificar
```

*(Todo el stack — n8n, Chatwoot, Postgres, Redis, Caddy — publica imágenes ARM64 oficiales:
funciona sin problemas sobre Ampere.)*

---

## 7️⃣ Desplegar el stack con HTTPS automático (Caddy + n8n)

Apunta en tu DNS un registro **A** `n8n.tudominio.com` → TU_IP_PUBLICA (TTL 300). Luego:

```bash
mkdir -p ~/stack && cd ~/stack
```

**`docker-compose.yml`** (base para n8n; Chatwoot se agrega igual más adelante):

```yaml
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config

  n8n:
    image: docker.n8n.io/n8nio/n8n
    restart: unless-stopped
    environment:
      - N8N_HOST=n8n.tudominio.com
      - N8N_PROTOCOL=https
      - WEBHOOK_URL=https://n8n.tudominio.com/
      - GENERIC_TIMEZONE=America/Bogota
      - TZ=America/Bogota
    volumes:
      - n8n_data:/home/node/.n8n

volumes:
  caddy_data:
  caddy_config:
  n8n_data:
```

**`Caddyfile`** (certificados HTTPS gratis y automáticos de Let's Encrypt):

```
n8n.tudominio.com {
    reverse_proxy n8n:5678
}
```

```bash
docker compose up -d
```

En ~1 minuto tienes `https://n8n.tudominio.com` con SSL válido → ya puedes
**restaurar tus workflows y credenciales** (importa los `n8n/*.json` de este repo, o copia el
volumen viejo `~/.n8n` del servidor AWS antes de apagarlo).

> 📦 **Chatwoot** se agrega al mismo compose con su `docker-compose` oficial
> (Postgres + Redis + Rails + Sidekiq) y una línea en el `Caddyfile`:
> `chat.tudominio.com { reverse_proxy chatwoot_rails_1:3000 }`.
> Restaurar el dump de su Postgres desde el servidor viejo trae consigo conversaciones y contactos.

---

## 8️⃣ Mantener el servidor vivo y sano

- **Política anti-inactividad de Oracle:** las instancias Always Free ociosas 7 días
  (CPU, red y RAM con uso <20%) pueden ser detenidas/reclamadas. Con n8n ejecutando
  recordatorios y Chatwoot recibiendo mensajes, el uso real te mantiene activo.
  Si algún servicio queda muy quieto, un simple cron que genere actividad lo resuelve.
- **Actualizar el sistema** de vez en cuando: `sudo apt update && sudo apt -y upgrade` y
  `docker compose pull && docker compose up -d`.
- **Backups:** crea un script cron que haga `docker exec` dump de las BDs y súbelas a
  Google Drive (el repo ya tiene la lógica en `BACKUPS-GOOGLE.md` / `scripts/limpiar-backups-gdrive.mjs`).
- **No apagues la instancia desde la consola** salvo necesidad; si lo haces, la IP reservada (paso 3) evita dramas.

---

## ✅ Checklist final

| # | Paso | Hecho |
|---|---|---|
| 1 | Cuenta creada, región Ashburn, tarjeta verificada | ☐ |
| 2 | Instancia A1 ARM (4/24 o 2/12) + Ubuntu 24.04 + llaves SSH guardadas | ☐ |
| 3 | IP pública **reservada** | ☐ |
| 4 | Puertos 80/443 abiertos en Security List **y** iptables | ☐ |
| 5 | Docker instalado | ☐ |
| 6 | DNS apuntando + Caddy con HTTPS | ☐ |
| 7 | n8n restaurado (workflows de `n8n/` + credenciales + volumen `.n8n` viejo) | ☐ |
| 8 | Chatwoot restaurado (dump de Postgres + media) | ☐ |
| 9 | Webhooks actualizados en Meta/WhatsApp Cloud API y Chatwoot | ☐ |
| 10 | Budget de $1 con alerta activado | ☐ |
| 11 | Backup programado | ☐ |
| 12 | **Último:** recién ahí apagar el EC2 viejo de AWS | ☐ |

---

## 🆘 Problemas comunes

| Síntoma | Solución |
|---|---|
| *"Out of capacity"* al crear la instancia | Reintentar / cambiar AD / **upgrade a PAYG** (paso 2) |
| Tarjeta rechazada en el registro | Tarjeta real (no virtual), dirección que coincida, sin VPN, probar otra |
| No puedo conectarme por SSH (timeout) | Falta regla de entrada 22 en Security List, o usas la llave equivocada |
| Abro `:5678` en el navegador y no carga | **Correcto**: no se abren puertos de apps; todo va por 443 detrás de Caddy |
| HTTPS no emite certificado | El DNS aún no propagó (`dig n8n.tudominio.com`), espera y reinicia Caddy |
| Webhooks de WhatsApp no llegan | La URL del webhook en Meta debe ser `https://` y apuntar al dominio nuevo |
| Cuenta suspendida por "inactividad" | Mantén el stack corriendo (paso 8) o sube a PAYG |
