# Luna · Lead Nuevo → Datos → pausa manual

El workflow de Luna ahora tiene **un solo recorrido automático** y solo puede responder
cuando el lead está en las etapas **Nuevo Lead** o **Datos**.

| Etapa del CRM | Qué hace Luna | Qué está prohibido | Resultado |
|---|---|---|---|
| **Nuevo Lead / Lead Nuevo** | Saluda, se presenta como Luna y pregunta el motivo de la consulta. | Pedir nombres, fotos o la palma. | Después de responder, mueve el lead inmediatamente a **Datos**. |
| **Datos** | Entiende qué trabajo necesita el cliente a partir de lo que cuenta y prepara una sola lista completa de requisitos. | Volver a preguntar el motivo o pedir datos de otra modalidad. | Envía la lista una sola vez y se pausa completamente en ese chat. |
| Cualquier otra etapa | No responde. | Todo mensaje automático de Luna. | El flujo termina en silencio. |

## Lista que se envía al cliente

### Si el trabajo es de pareja

1. El nombre de cada uno.
2. Una foto de cada uno **o una sola foto juntos**.

### Si es una consulta personal

1. Una foto suya.
2. Una foto de la palma de su mano derecha.
3. Su nombre completo.

Si alguno de esos datos ya estaba guardado, Luna solo muestra lo que falta. La foto de una
pareja sirve para completar las dos fotos. En un trabajo personal, una foto de la palma nunca
se toma como foto del rostro.

## Cómo se identifica el trabajo

Luna interpreta lo que dice el cliente y lo relaciona con el catálogo disponible, incluyendo
suerte, amor, recuperación o retorno, dominio, alejamiento, endulzamiento, limpieza,
protección, prosperidad, empleo, juegos de azar y otros casos. También determina si el caso es
**personal** o de **pareja**.

La extracción usa IA y tiene un respaldo por palabras clave para casos como:

- **Suerte, chance, lotería, prosperidad, dinero o empleo** → normalmente personal.
- **Amor, pareja, recuperar, retorno, ex, volver, dominio o alejamiento** → normalmente pareja.
- **Limpieza, brujería, mal de ojo o protección** → normalmente personal, salvo que el cliente
  indique que el trabajo está dirigido a una persona concreta.

## Cómo queda pausada Luna

Cuando Luna envía la lista en la etapa Datos, `Aplicar Transicion de Etapa` guarda:

- `agente_activo = false` en la conversación de Supabase;
- `luna_pausada = true` y `lista_requisitos_enviada = true` en los atributos de Chatwoot;
- la etiqueta `bot-pausado` en la conversación.

El candado se revisa **antes** de las llamadas a IA. Por eso el siguiente mensaje del cliente
no genera otra respuesta automática ni consume llamadas de análisis. El chat aparece como
**Pausada** en el CRM para que el operador continúe manualmente.

También se envía al Maestro un aviso interno con el caso y los requisitos pendientes.

## Archivo persistente

La memoria de Luna se guarda en los atributos de la conversación de Chatwoot y se refleja en
Supabase. Incluye el motivo, categoría, tipo de trabajo, nombres y URLs de las fotos:

`tipo_trabajo`, `motivo_categoria`, `motivo_resumen`, `motivo_conocido`, `nombre_cliente`,
`nombre_otra_persona`, `foto_cliente`, `foto_otra_persona`, `foto_mano`, `foto_cliente_url`,
`foto_otra_persona_url`, `foto_mano_url`, `fotos_pendientes`, `luna_etapa`,
`lista_requisitos_enviada`, `luna_pausada`.

Un dato guardado no se sobreescribe con una interpretación nueva de la IA. Si una foto llega
antes de que se entienda el trabajo, queda en `fotos_pendientes` y se asigna cuando se define
la modalidad.

## Instalación y regeneración

1. Si aún no lo hiciste, ejecuta las migraciones de `supabase/` relacionadas con el expediente
   de Luna.
2. Configura `n8n/luna/secrets.local.json` localmente.
3. Ejecuta:

   ```bash
   npm run build:luna
   npm run check:luna
   ```

4. Importa en n8n `n8n/IMPORTAR-EN-N8N.json` cuando exista el archivo local con llaves. La
   versión `n8n/05-luna-etapas.github.json` es la copia versionada y usa `$env`; no es la copia
   recomendada para la instancia que bloquea el acceso a variables de entorno.
5. Desactiva el workflow anterior y activa el generado.
6. Confirma que en el pipeline existan etapas con nombre **Nuevo Lead** o **Lead Nuevo** y
   **Datos**. Las claves pueden ser dinámicas: el workflow busca por el nombre visible.

Si tu CRM usa otro nombre, agrega el nombre normalizado en `ETAPAS_EXTRA` dentro de
`Leer Estado del Lead`, apuntándolo únicamente a `lead_nuevo` o `datos`.

## Verificación

```bash
npm run check:luna
```

La verificación comprueba que:

- Luna solo actúa en Lead Nuevo y Datos;
- Lead Nuevo saluda y transfiere directamente a Datos;
- Datos clasifica suerte, amor y recuperación, envía todos los requisitos en un solo mensaje
  y activa la pausa;
- pareja acepta una foto de los dos;
- personal exige foto, palma derecha y nombre completo;
- una pausa corta el flujo antes de volver a llamar a la IA;
- las fotos se clasifican y los datos persistidos no se pisan.
