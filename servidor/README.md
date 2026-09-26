# 🖥️ SERVIDOR CONTABO — STACK TEMPLO MÍSTICO (estado FINAL tras la migración)

> **Migración completada el 2026-09-26.** Servidor: Contabo Cloud VPS 4 (4 vCPU / 8 GB / 100 GB)
> IP: `185.215.180.178` · Ubuntu 24.04 · Docker + Compose.
> El EC2 de AWS (free tier vencido) fue terminado. Guía histórica de Oracle: `../SERVIDOR-ORACLE-FREE.md`.

## Arquitectura real en producción

```
Internet → Caddy (HTTPS auto, 3 dominios DuckDNS)
   ├── crmesteban.duckdns.org        → chatwoot:3000  (CRM mensajería)
   ├── n8n-crmesteban.duckdns.org    → n8n:5678       (Luna, recordatorios)
   └── evo-crmesteban.duckdns.org    → evolution-api:8080 (WhatsApp Baileys)
```

- Archivos en `/opt/templo/`: `docker-compose.yml` (Caddy, n8n, Chatwoot, Postgres pgvector, Redis)
  + **`docker-compose.override.yml`** (Evolution API + su Postgres 15 + su Redis — compose lo carga solo)
  + `Caddyfile` + `.env`.
- **DuckDNS solo permite un nivel** (por eso `n8n-crmesteban` y no `n8n.crmesteban`).
- Chatwoot usa **pgvector/pgvector:pg17** (extensión `vector` requerida por Chatwoot moderno).

## Llaves críticas (respaldadas en `/opt/templo/.env`)

Si se pierden, se pierden las credenciales encriptadas — copia `.env` a lugar seguro:
- `CHATWOOT_SECRET_KEY_BASE` (la del EC2 viejo — mantiene compatibilidad con los datos restaurados)
- `N8N_ENCRYPTION_KEY` (ídem — workflows y credenciales de n8n)
- `EVOLUTION_API_KEY` (ídem — la usan las integraciones Chatwoot↔Evolution)

## Operación diaria

```bash
cd /opt/templo
docker compose ps                          # estado
docker compose logs -f --tail=50 chatwoot  # logs de un servicio
docker compose pull && docker compose up -d   # actualizar todo
```

## Respaldos (configurados)

1. **Cron diario 3 AM** → dumps de `chatwoot_production` y `evolution` en `/root/backups` (retención 7 días).
2. **Snapshot de Contabo** (1 incluido en el plan) → crear desde my.contabo.com tras cada cambio grande.
3. Opcional: subir `/root/backups` a Google Drive (ver `../BACKUPS-GOOGLE.md`).

## WhatsApp — dos canales

| Canal | Cómo corre | Reconexión |
|---|---|---|
| **WhatsApp Personal** (Baileys) | Evolution API en este servidor | QR o pairing code: `GET /instance/connect/<nombre>` con header `apikey` (o panel `/manager`) |
| **WhatsApp Cloud API** (Meta) | Nube de Meta → webhook `https://crmesteban.duckdns.org/webhooks/whatsapp` | Re-verificar webhook en developers.facebook.com si cambia dominio |

## Restauración desde cero (si el servidor muere)

1. Contratar VPS → instalar Docker (`curl -fsSL https://get.docker.com | sh`).
2. Copiar `/opt/templo/` completo (los 4 archivos) desde el backup + restaurar `.env`.
3. Restaurar dumps de `/root/backups` (o el snapshot de Contabo, que lo trae todo: `docker compose up -d` y listo).
4. Apuntar los 3 dominios DuckDNS a la IP nueva.
5. Reconectar instancias WhatsApp (QR/pairing) y re-verificar webhook de Meta.

## Lecciones de esta migración (para la próxima)

- **Rescate primero, apagado después**: nunca apagar el servidor viejo sin verificar los respaldos restaurados.
- `docker compose` solo carga `docker-compose.yml` + `docker-compose.override.yml` (otros nombres hay que pasarlos con `-f`).
- Chatwoot moderno **exige pgvector**; Postgres plano falla en `db:chatwoot_prepare`.
- Cambios de subdominio ⇒ reescribir URLs en las BDs (script `fixurls.sql` del proceso) y re-verificar webhooks de Meta.
- El respaldo del 25-sep perdió solo los chats del 25→26 (el EC2 murió antes del segundo dump).
