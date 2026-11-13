# 📲 Segundo WhatsApp Personal (cuenta de respaldo, SIN API)

> **Para qué sirve:** cuando WhatsApp bloquea **temporalmente** el número personal
> principal por hacer muchas llamadas en un día, el CRM no se queda sin canal.
> Hay un **segundo número personal** con la misma funcionalidad (mensajes, adjuntos,
> notas de voz, llamadas desde la APK y seguimientos de Luna) que se activa en un
> toque. La elección es **manual**, a propósito: tú decides cuándo cambiar.

| Canal | Cómo corre | Cuándo se usa |
|---|---|---|
| 🌐 **WhatsApp API** (Templo) | Meta Cloud API + Chatwoot | Publicidad y leads nuevos |
| 👤 **WhatsApp 1** (personal) | Evolution API, instancia `personal` | Operación normal |
| 👤 **WhatsApp 2** (respaldo) | Evolution API, instancia `personal2` | Cuando bloquean el número principal |

---

## 1. Qué hace el CRM (ya implementado)

- **Selector en la bandeja**: arriba de la lista de chats aparecen las dos cuentas
  personales con su estado (`conectado` / `desconectado`). Tocar una la deja activa.
- **Cabecera del chat**: el chip `👤 WhatsApp 1 / 👤 WhatsApp 2` cambia la cuenta de
  **ese** chat. Cada conversación recuerda con cuál se responde.
- **Envío**: texto, imágenes, videos, archivos y **notas de voz** salen por la
  instancia de Evolution de la cuenta elegida.
- **Llamadas (APK Android)**: abre la app de WhatsApp que corresponda al número
  (ver sección 5).
- **Luna y seguimientos**: no hay que tocar nada. Luna responde por **Chatwoot,
  en la misma conversación por la que entró el mensaje**, así que un chat de la
  bandeja del WhatsApp 2 se responde solo por la instancia 2. Los recordatorios
  (`n8n/03-recordatorios-*`) también envían por Chatwoot.
- **Si una cuenta falla por bloqueo/desconexión**, la app muestra un aviso claro
  con la otra cuenta como salida (no reintenta sola: el cambio es manual).

---

## 2. Crear la instancia en Evolution (servidor Contabo)

En el servidor (`/opt/templo`) ya corre Evolution. Crea la segunda instancia:

```bash
source /opt/templo/.env       # para tener EVOLUTION_API_KEY

# 2.1 Crear la instancia
curl -X POST "https://evo-crmesteban.duckdns.org/instance/create" \
  -H "apikey: $EVOLUTION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "personal2",
    "qrcode": true,
    "integration": "WHATSAPP-BAILEYS"
  }'
```

**2.2 Conectar el segundo número** (QR o código de emparejamiento):

```bash
# Abre el panel y escanea el QR con el WhatsApp del SEGUNDO número
# https://evo-crmesteban.duckdns.org/manager

# …o pide el QR por API:
curl "https://evo-crmesteban.duckdns.org/instance/connect/personal2" \
  -H "apikey: $EVOLUTION_API_KEY"
```

Comprueba que quedó conectada:

```bash
curl "https://evo-crmesteban.duckdns.org/instance/connectionState/personal2" \
  -H "apikey: $EVOLUTION_API_KEY"
# → {"instance":{"instanceName":"personal2","state":"open"}}
```

> ⚠️ Usa un número **distinto** al principal. Si el principal está bloqueado, el
> QR del segundo se escanea con la SIM/app del número de respaldo.

---

## 3. Crear la bandeja en Chatwoot

1. **Chatwoot → Ajustes → Bandejas de entrada → Añadir bandeja**.
2. Tipo **API** (la que usa Evolution para inyectar mensajes).
3. Nombre sugerido: **`WhatsApp Personal 2`** (el CRM reconoce el nombre y, si no,
   usa el ID que configures).
4. Guarda y **apunta el ID de la bandeja**: está en la URL
   (`/app/accounts/1/settings/inboxes/7` → el `7`).
5. Conecta la instancia de Evolution a esa bandeja (integración Chatwoot de la
   instancia):

```bash
curl -X POST "https://evo-crmesteban.duckdns.org/chatwoot/set/personal2" \
  -H "apikey: $EVOLUTION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "accountId": "1",
    "token": "TU_CHATWOOT_API_TOKEN",
    "url": "https://crmesteban.duckdns.org",
    "signMsg": false,
    "reopenConversation": true,
    "conversationPending": false,
    "nameInbox": "WhatsApp Personal 2",
    "importContacts": true,
    "importMessages": true
  }'
```

> La integración de Chatwoot de la instancia principal (`personal`) ya existía.
> Repite **los mismos valores** cambiando solo la instancia y el `nameInbox`.

---

## 4. Activar en el CRM

### 4.1 Base de datos (una sola vez)

Ejecuta en **Supabase → SQL Editor**:

```
supabase/migrations/20261113000001_segundo_whatsapp_personal.sql
```

Crea la columna `conversaciones.cuenta_whatsapp` y las claves de configuración.
Es idempotente.

### 4.2 Ajustes de la app

**Ajustes → WhatsApp Personal · Segunda cuenta**:

| Campo | Ejemplo | Nota |
|---|---|---|
| Número del WhatsApp 2 | `573001234567` | Con código de país |
| Nombre visible | `WhatsApp 2` | Como quieras verlo en la bandeja |
| Instancia de Evolution | `personal2` | La del paso 2 |
| ID de la bandeja de Chatwoot | `7` | La del paso 3 |

Pulsa **Guardar cuentas** → **Probar** y verifica que diga `conectado`.

### 4.3 Variables de entorno (opcional, recomendado en Vercel)

Si prefieres fijar los datos sin depender de la base de datos:

| Variable | Valor por defecto | Uso |
|---|---|---|
| `EVOLUTION_INSTANCE` | `personal` | Instancia de WhatsApp 1 |
| `EVOLUTION_INSTANCE_PERSONAL2` | `personal2` | Instancia de WhatsApp 2 |
| `CHATWOOT_INBOX_PERSONAL2_ID` | (vacío) | Bandeja del WhatsApp 2 |
| `WHATSAPP_PERSONAL2_NUMERO` | (vacío) | Número visible del WhatsApp 2 |

Las variables mandan sobre `config_general` para instancia/bandeja.

---

## 5. Llamadas desde la APK en el mismo teléfono

El CRM abre la app de WhatsApp con el número del cliente. Para el **WhatsApp 2**
en el mismo teléfono hay dos caminos:

### Recomendado: WhatsApp Business como segunda app (sin API)

- Instala **WhatsApp Business** (`com.whatsapp.w4b`) con el segundo número.
- En **Ajustes → WhatsApp Personal → App del teléfono para llamar con WhatsApp 2**,
  elige `WhatsApp Business`.
- Funciona igual que el principal: llamada directa o chat abierto.

### App dual / clon (Dual Messenger, Segundo espacio, WhatsApp 2 de Xiaomi…)

- Algunos teléfonos exponen una app clonada con su propio paquete; el selector de
  Ajustes la detecta y funciona.
- **Limitación de Android**: las apps creadas por *Dual Messenger* de Samsung o por
  el *Segundo espacio* viven en otro perfil de usuario y **no se pueden lanzar
  desde otra app**. En ese caso el CRM no puede abrir la clonada: Whats App 2 se
  atiende abriendo la app manualmente. El CRM seguirá enviando mensajes y notas de
  voz por ese número (eso va por Evolution, no por el teléfono).

> Si el segundo número está en **otro teléfono**, las llamadas se hacen desde ese
> teléfono; el CRM sigue enviando mensajes y haciendo seguimiento sin problema.

---

## 6. Uso diario

1. **Día normal** → deja activo 👤 **WhatsApp 1** (arriba en la bandeja).
2. **WhatsApp bloquea el número principal** → toca 👤 **WhatsApp 2**:
   - queda como cuenta activa,
   - el chat que tengas abierto pasa a esa cuenta.
3. Cada chat guarda su cuenta. Si un cliente escribió por el número 1 y quieres
   seguir por el 2, abre el chat y toca el chip `👤 WhatsApp 1`.
4. Cuando el bloqueo del principal termina, vuelve a tocar 👤 **WhatsApp 1**.

Los chats se pueden filtrar/ver igual: la bandeja es la misma para las dos cuentas
(grupo **Personal**), y el chip de la cabecera dice por cuál se está respondiendo.

### ¿Y el historial?

La conversación del CRM es única por cliente: si el cliente escribe por el número 2,
sus mensajes se suman al mismo chat. Chatwoot guarda cada mensaje en su bandeja de
origen, así que la trazabilidad se conserva.

---

## 7. Seguimientos de Luna

| Flujo | Canal de salida | ¿Hay que cambiar algo? |
|---|---|---|
| Luna responde (n8n Luna) | Chatwoot, misma conversación | No |
| Recordatorios «No contesta» | Chatwoot, chat personal | No |
| Aviso al maestro de Luna | Evolution, instancia `personal` | Opcional: si el principal está bloqueado, cambia `INSTANCIA_MAESTRO` en `n8n/luna/code/aplicar-transicion.js` y en `LUNA-WORKFLOW-COMPLETO.json` por `personal2` |

---

## 8. Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| El selector dice **sin verificar** | Falta `EVOLUTION_API_KEY` en Vercel | Añádela (la misma de `/opt/templo/.env`) |
| Dice **desconectado** | La sesión Baileys se cayó o cambió el QR | Reconecta con `/instance/connect/personal2` |
| Los mensajes del número 2 no llegan al CRM | Bandeja de Chatwoot mal vinculada | Revisa el ID de bandeja y la integración de la instancia |
| «No se pudo guardar la cuenta del chat» | Falta la migración | Ejecuta `20261113000001_segundo_whatsapp_personal.sql` |
| El audio sale como archivo y no como nota de voz | Evolution no aceptó PTT | Reintenta; revisa `/message/sendWhatsAppAudio/personal2` |
| No aparece la segunda cuenta en Ajustes | Configuración vacía | Rellena número o bandeja y guarda |

**Comprobaciones rápidas**

```sql
-- ¿Qué chats atiende cada canal?
SELECT * FROM public.v_conversaciones_por_cuenta;

-- Configuración guardada
SELECT clave, valor FROM public.config_general
 WHERE clave LIKE 'whatsapp_personal%';
```

---

## 9. Archivos tocados

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20261113000001_segundo_whatsapp_personal.sql` | Columna `cuenta_whatsapp`, config y vista de control |
| `src/lib/whatsapp-cuentas.ts` | Reglas puras (cuenta ↔ instancia ↔ bandeja, errores de bloqueo) |
| `src/lib/whatsapp-cuentas-servidor.ts` | Configuración, estado de Evolution y resolución de cuenta |
| `src/app/api/whatsapp-cuentas/route.ts` | API para leer/guardar/activar cuentas |
| `src/app/api/send-message/route.ts` | Envío por la instancia de la cuenta elegida |
| `src/lib/sync-chatwoot.ts` | Marca la cuenta de cada conversación y diagnostica ambas |
| `src/lib/whatsapp-personal.ts` | Llamada por la app de la cuenta elegida |
| `src/app/page.tsx` | Selector en la bandeja + chip por chat |
| `src/components/AjustesPanel.tsx` | Sección «WhatsApp Personal · Segunda cuenta» |
| `android/.../WhatsAppPersonalPlugin.java` | `listarApps` y `openChat` con paquete |
| `android/app/src/main/AndroidManifest.xml` | Visibilidad de WhatsApp Business y variantes |

Pruebas: `npm run test:whatsapp2`.
