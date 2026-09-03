# Migrar el CRM a otro Supabase

## Contexto

El proyecto actual `qrrkokfmbdtodrqbfehs` quedó **restringido por límites**. Esto
no se arregla únicamente cambiando llaves: hay que mover la base (o crear una
nueva y cargar datos) a un proyecto que sí tenga margen.

La app web/Capacitor ya no tiene la URL ni las llaves incrustadas: lee todo de
variables de entorno (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, etc.). Por eso solo tenés que apuntar la app al
proyecto nuevo.

---

## 0. Antes de empezar: ¿el proyecto viejo sigue dando datos?

La migración más suave es desde el **proyecto actual** hacia uno nuevo **mientras
siga accesible por REST** (aunque esté "restringido", muchas veces el REST sigue
respondiendo aunque el plan sea haya topado con límites). Verificalo:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  "https://qrrkokfmbdtodrqbfehs.supabase.co/rest/v1/?apikey=<SERVICE_ROLE>&Authorization=Bearer <SERVICE_ROLE>"
```

- `200` / `201` → sí se puede migrar por REST con el script de este repo.
- `000` / `timeout` / `SSL` → el backend está cerrado; hay que pedir a Soporte de
  Supabase **acceso temporal de lectura** o un `pg_dump`, o usar el export/backup
  que tengas.

No borres el proyecto viejo hasta que des por confirmado que la copia nueva
funciona.

---

## 1. Crear el proyecto nuevo en Supabase

1. https://supabase.com/dashboard → **New project**.
2. Anotá:
   - **Project URL** → `https://xxx.supabase.co`
   - **anon public key** → Settings → API → `anon public`
   - **service_role key** → Settings → API → `service_role`
   - **Database URL** (para `psql`/`pg_dump`) → Settings → Database →
     Connection string. Formato:
     `postgresql://postgres.<REF>:<PASSWORD>@db.<REF>.supabase.co:5432/postgres`
3. Elegí un plan con más margen que el que colgó (free reventó por límites;
   evalúa Pro si el tráfico es diario y con adjuntos).

---

## 2. Migrar esquema + datos

### Ruta A (recomendada si hay conexión Postgres en el origen)

```bash
# 1) dumps exactos desde el ORIGEN (si te lo permiten)
pg_dump "postgresql://postgres.VIEJO_REF:PASS@db.VIEJO_REF.supabase.co:5432/postgres" --schema-only > esquema_viejo.sql
pg_dump "postgresql://postgres.VIEJO_REF:PASS@db.VIEJO_REF.supabase.co:5432/postgres" --data-only > datos_viejos.sql

# 2) aplicar en el DESTINO
psql "postgresql://postgres.NUEVO_REF:PASS@db.NUEVO_REF.supabase.co:5432/postgres" -v ON_ERROR_STOP=1 -f esquema_viejo.sql
psql "postgresql://postgres.NUEVO_REF:PASS@db.NUEVO_REF.supabase.co:5432/postgres" -v ON_ERROR_STOP=1 -f datos_viejos.sql
```

Esto copia **todo** (columnas, PK, FK, triggers, funciones, datos). Es el camino
ideal.

### Ruta B (REST: sin conexión Postgres, pero el proyecto viejo responde)

El script `scripts/migrar-supabase.mjs` genera el esquema desde el OpenAPI del
origen y después copia las filas tabla por tabla.

```bash
# Paso 1: generar esquema
SUPABASE_ORIGEN_URL=https://VIEJO.supabase.co \
SUPABASE_ORIGEN_KEY=<SERVICE_ROLE_VIEJO> \
node scripts/migrar-supabase.mjs --schema
```

Esto crea `supabase/migrations/0000_migrar_esquema_origen.sql`.

```bash
# Paso 2: aplicarlo en el Supabase NUEVO
#  - SQL Editor del dashboard: pegar y Run.
#  - o con psql:
psql "postgresql://postgres.NUEVO_REF:PASS@db.NUEVO_REF.supabase.co:5432/postgres" \
     -v ON_ERROR_STOP=1 -f supabase/migrations/0000_migrar_esquema_origen.sql
```

```bash
# Paso 3: copiar datos
SUPABASE_ORIGEN_URL=https://VIEJO.supabase.co \
SUPABASE_ORIGEN_KEY=<SERVICE_ROLE_VIEJO> \
SUPABASE_DESTINO_URL=https://NUEVO.supabase.co \
SUPABASE_DESTINO_KEY=<SERVICE_ROLE_NUEVO> \
node scripts/migrar-supabase.mjs --datos
```

Opciones útiles:
- `MIGRAR_TABLAS=clientes,conversaciones,mensajes,pagos,tareas` → copiar solo
  algunas tablas.
- `BATCH_MIGRAR=1000` → lote por consulta (por defecto 500).
- `--dry-run` → no escribe/escribe nada, solo muestra el plan.
- `--auto-sql` → intenta aplicar el esquema con `psql` usando
  `DATABASE_URL_DESTINO`.

**Límite de la Ruta B:** reconstruye columnas + RLS básica. No reconstruye de
forma exacta primary keys compuestas, FKs ni triggers. Esos `pg_dump` (Ruta A)
sigue siendo la referencia si el origen da conexión.

---

## 3. Ajustes post-migración (importantes en el nuevo proyecto)

1. **Storage:** creá el bucket `media-mensajes` (público) y las políticas de
   acceso. Las migraciones `20260916_media_storage.sql` y
   `20260917_respuestas_rapidas_a_storage.sql` lo asumen.
2. **RLS:** si usás las políticas públicas que genera el script, se podrá
   leer/escribir con `anon`; si querés más seguridad, configura políticas solo
   para el backend.
3. **Pipeline / etapas:** si la copia no trajo `pipeline_etapas`, ejecutá
   `supabase/migrations/20260826_mejoras_luna_grupos_colores.sql` para sembrar
   Personal/Templo.
4. **Realtime:** si la app usa suscripciones realtime en `conversaciones` /
   `mensajes` / `pipeline_etapas`, verificá que en el proyecto nuevo estén
   habilitadas (Dashboard → Database → Replication → enabled for relevant tables).
   La migración `20260831_fix_no_leidos_realtime.sql` puede necesitar re-ejecutarse.
5. **Config inicial:** `config_general` (kill switch de Luna, labels, divisas),
   `config_divisas`, `respuestas_rapidas` y `pipeline_etapas` deben estar
   presentes para que el CRM funcione completo.

---

## 4. Apuntar la app al nuevo proyecto

En Vercel → Settings → Environment Variables (proyecto de la rama activa):

```text
NEXT_PUBLIC_SUPABASE_URL=https://NUEVO.supabase.co
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

Luego redeploy. La APK carga la web de `https://templo-mistico-crm.vercel.app`,
así que no necesita rebuild si solo cambias variables de Vercel.

Verificar:

```bash
curl -sS "https://NUEVO.supabase.co/rest/v1/?apikey=SU_SERVICE_ROLE&Authorization=Bearer SU_SERVICE_ROLE"
```

---

## 5. Reimportar n8n (Luna y recordatorios)

Los workflows del repo ya no llevan llaves reales. Usá:

- `n8n/IMPORTAR-EN-N8N.RELLENAR.json` → reemplazá los marcadores
  `AQUI_SUPABASE_URL`, `AQUI_SUPABASE_SERVICE_ROLE_KEY`, `AQUI_CHATWOOT_URL`,
  `AQUI_CHATWOOT_API_TOKEN`, `AQUI_EVOLUTION_URL`, `AQUI_EVOLUTION_API_KEY`,
  `AQUI_FISH_AUDIO_API_KEY`, `AQUI_CEREBRO_API_SECRET`,
  `AQUI_OPENAI_API_KEY`, `AQUI_GROQ_API_KEY`.
- `n8n/03-recordatorios-whatsapp-por-etapa.json` → reemplazá
  `https://TU-CHATWOOT.duckdns.org`, `AQUI_CHATWOOT_API_TOKEN`,
  `https://TU-PROYECTO.supabase.co`, `AQUI_SUPABASE_SERVICE_ROLE_KEY`.

Después de importar: desactivá el workflow viejo, probá con un contacto de
prueba y activá.

---

## 6. Checklist

- [ ] Antes: `curl` al proyecto viejo — ¿responde REST?
- [ ] Proyecto nuevo creado (con plan que cubra el uso real).
- [ ] Esquema aplicado en el nuevo (por `pg_dump` o por `migrar-supabase --schema`).
- [ ] Datos copiados y verificados (`select count(*)` en las tablas principales).
- [ ] Bucket `media-mensajes` creado.
- [ ] Realtime habilitado en las tablas que usa la app.
- [ ] Variables de Vercel apuntando al nuevo proyecto.
- [ ] Redeploy y verificación del dashboard.
- [ ] n8n reimportado y activo.
- [ ] Proyecto viejo conservado como respaldo (no borrado).
