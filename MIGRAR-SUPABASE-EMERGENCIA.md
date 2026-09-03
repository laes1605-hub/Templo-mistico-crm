# Urgencia / migración: Supabase restringido y CRM caído

**Estado al revisar el repo (2026-09-02):** la app sigue en línea, pero la base
`https://qrrkokfmbdtodrqbfehs.supabase.co` ya no responde (el DNS resuelve, pero el
TLS se corta). Eso es típico de un proyecto **pausado/suspendido/limitado**,
no de un bug de la app.

**Además:** el repo `laes1605-hub/Templo-mistico-crm` es **público** y contenía
copias de varias llaves reales (service role de Supabase, token de Chatwoot,
API key de Evolution, API key de Fish, secreto del Cerebro y número maestro).
Esa exposición suele ser el motivo de la restricción. En este commit ya **no hay
llaves reales en el código**: se sanearon y todo se lee de variables de entorno.

---

## 0. Lo primero (no programes nada nuevo hasta esto)

1. **Entra a Supabase** https://supabase.com/dashboard/projects con la cuenta dueña.
2. Busca el proyecto `qrrkokfmbdtodrqbfehs`.
   - **Paused** → reactívelo (gratis, los datos siguen ahí).
   - **Restricted / Suspended / Needs help** → lee el correo de Supabase y usa el
     formulario de soporte. Al estar **suspendido**, pide que te **rehabiliten o
     dejen exportar la base**. Es la única forma segura de no perder datos.
3. **NO borres el proyecto** ni crees otro mientras no confirmes qué pasó.

---

## 1. Rotar credenciales (obligatorio, aunque recuperes la base)

Las llaves que acababan en un repo público deben darse por **comprometidas**:

| Servicio | Dónde rotar |
| --- | --- |
| Supabase | Settings → API → **Regenerate** anon y service role |
| Chatwoot | Configuración de la cuenta → Access Tokens → genera uno nuevo |
| Evolution | Panel de instancias → regenerar `apikey` |
| Fish Audio | Cuenta → API keys → revocar y crear una nueva |
| Cerebro | Cambiar `CEREBRO_API_SECRET` / `ADMIN_SECRET` en Vercel |

Después:
- Pon el repo **privado** (`Settings → Danger Zone → Change visibility`).
- Si querés historia limpia, reescribí el historial de secretos (p. ej.
  `git-filter-repo`) y forzaste el push; si no, al menos privado + rotación.
- No subas de nuevo `n8n/luna/secrets.local.json` (ya está en `.gitignore`).

---

## 2. Recuperar datos/schema del proyecto actual (si se puede)

El repo **no tenía las tablas base** de `clientes`, `conversaciones`, `mensajes`,
`pagos`, `tareas`, etc. (se crearon a mano en Supabase; sólo se versionaron las
migraciones). Así que, para reconstruir en otra base, necesitás el esquema.

**Camino ideal** (cuando soporte te devuelva acceso, aunque sea de lectura):

```bash
# PostgreSQL: dump EXACTO (esquema + datos)
pg_dump "postgresql://postgres.[PROJECT_REF]:[DB_PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" --schema-only > esquema.sql
pg_dump "postgresql://postgres.[PROJECT_REF]:[DB_PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" --data-only > datos.sql
```

**Camino REST** (si no tenés la conexión Postgres pero el proyecto responde):

```bash
SUPABASE_URL=https://[PROJECT_REF].supabase.co \
SUPABASE_SERVICE_ROLE_KEY=eyJ... \
node scripts/dump-esquema-supabase.mjs --datos
```

Genera `supabase/migrations/0000_reconstruir_esquema.sql` y
`0000_reconstruir_datos.sql`. (Reconstruye columnas/RLS básicas, no PK/UQ/triggers
con la fidelidad de `pg_dump`.)

---

## 3. Retargetear la app al proyecto nuevo (misma base, misma URL o nueva)

La app ya lee todo de variables de entorno. En **Vercel → Settings → Environment
Variables** cargá:

```text
NEXT_PUBLIC_SUPABASE_URL=https://TU-PROYECTO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...ANON...
SUPABASE_SERVICE_ROLE_KEY=eyJ...SERVICE_ROLE...
CHATWOOT_URL=https://tu-chatwoot.duckdns.org
CHATWOOT_API_TOKEN=TU_TOKEN_NUEVO
CHATWOOT_ACCOUNT_ID=1
EVOLUTION_API_URL=https://tu-evolution.duckdns.org
EVOLUTION_API_KEY=TU_KEY
EVOLUTION_INSTANCE=personal
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gs...
FISH_AUDIO_API_KEY=sk-fish-...
CEREBRO_API_SECRET=...
ADMIN_SECRET=...
```

Luego **redeploy** de `main`/la rama activa. Si usás la APK, recordá que carga la
web de `https://templo-mistico-crm.vercel.app`; no hace falta rebuild del APK para
cambios de web.

Verificación rápida:

```bash
curl -sS "https://TU-PROYECTO.supabase.co/rest/v1/?apikey=...&Authorization=Bearer ..."
```

---

## 4. Crear base nueva SOLO si el proyecto viejo no se puede recuperar

1. Crea un proyecto Supabase nuevo (plan free está bien para empezar).
2. Si tenés `esquema.sql` (pg_dump) ejecutalo; si no, ejecutá
   `0000_reconstruir_esquema.sql`.
3. Aplica las migraciones del repo **en orden**:

   ```bash
   for f in supabase/migrations/*.sql; do
     echo "[$f]"; # pegar en SQL Editor o pasar por psql
   done
   ```

   O en una sola pasada con `psql`:

   ```bash
   psql "$CONNECTION_STRING" -v ON_ERROR_STOP=1 -f supabase/migrations/0000_reconstruir_esquema.sql
   psql "$CONNECTION_STRING" -v ON_ERROR_STOP=1 -f supabase/migrations/20260824_fase3_cerebro_ia.sql
   # ... el resto en orden (el comando "for" en el repo es la referencia)
   ```

4. **Storage**: creá el bucket `media-mensajes` (público) y su política. Las
   migraciones de `20260916_media_storage.sql` y `20260917_respuestas_rapidas_a_storage.sql`
   asumen que existe.
5. **Pipeline/etapas**: la migración `20260826_mejoras_luna_grupos_colores.sql`
   siembra las etapas de Personal/Templo; si la saltaste, insertá las semillas.
6. Cargá `config_general` (kill switch de Luna, labels, divisas) y `respuestas_rapidas`
   si tenés dump de datos.
7. Configurá variables de Vercel (paso 3) y redeploy.

---

## 5. Reconfigurar n8n (workflows de Luna y recordatorios)

- Los workflows del repo ya **no llevan llaves reales**:
  - `n8n/IMPORTAR-EN-N8N.RELLENAR.json` trae marcadores `AQUI_*`.
  - Ábrelo en un editor y reemplazá cada marcador (lista completa en
    `SINCRONIZACION-CHATWOOT.md`).
- Para regenerarlo: copiá `n8n/luna/secrets.local.json` (plantilla según
  `.env.example`) y corré `npm run build:luna`. Ese archivo `.local.json` no se
  versiona.
- En n8n, importá el JSON, desactivá el workflow viejo y probá con un contacto
  de prueba.

---

## 6. Checklist final

- [ ] Proyecto de Supabase reactivado o exportado
- [ ] Todas las llaves rotadas (Supabase, Chatwoot, Evolution, Fish, Cerebro)
- [ ] Repo privado
- [ ] Env vars en Vercel (con el proyecto nuevo)
- [ ] Esquema base + migraciones aplicadas en la base nueva
- [ ] Bucket `media-mensajes` creado
- [ ] Workflows n8n re-importados con llaves nuevas
- [ ] App redeployada y visible en `templo-mistico-crm.vercel.app`
- [ ] APK abre la web y consulta la base nueva

---

## Notas de seguridad para el futuro

- Nunca commitear `.env*` ni `secrets.local.json`.
- Cualquier clave que estuvo en GitHub debe rotarse, no sólo borrarse.
- Si la base queda en el plan free, configurá una alerta de inactividad (o un
  cron que haga un `SELECT 1` cada ~5 días) para que no se pause de nuevo.
- Considerá tener un dump automático (cron de `pg_dump`) en Storage/Drive.
