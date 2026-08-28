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

- Los nombres completos de las dos personas.
- Una foto clara y de frente de cada persona **o una sola foto clara donde aparezcan las dos**.

### Si es una consulta personal

- Su nombre completo.
- Una foto clara y de frente donde se vea bien su rostro.
- Una foto clara de la palma de su mano derecha.

Luna pide todo lo pendiente de una sola vez, con un saludo empático, «por favor» y un cierre de
agradecimiento. El mensaje al cliente no usa `1.`, `2.` ni `3.`. Así también suena natural si
se responde con una nota de voz y no dice «uno punto» o «dos punto».

Un nombre de una sola palabra —por ejemplo, «Ana»— se considera **parcial**. Luna no lo marca
como terminado: pide explícitamente el nombre y apellido. Si después recibe «Ana Pérez»,
enriquece el dato parcial sin sobrescribir ningún nombre completo que ya estuviera guardado.
La misma validación se aplica por separado a las dos personas en trabajos de pareja.

Si alguno de esos datos ya estaba guardado de forma completa, Luna solo muestra lo que falta.
La foto de una pareja sirve para completar las dos fotos. En un trabajo personal, una foto de
la palma nunca se toma como foto del rostro.

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

`Aplicar Transicion de Etapa` ahora se ejecuta **después** de que Chatwoot acepta el mensaje
de texto o la nota de voz con la solicitud completa. En ese momento guarda:

- `agente_activo = false` en la conversación de Supabase;
- `luna_pausada = true` y `lista_requisitos_enviada = true` en los atributos de Chatwoot;
- la etiqueta `bot-pausado` en la conversación.

Si Chatwoot rechaza el envío, el flujo no guarda una pausa falsa y el chat queda disponible
para reintentar o atenderlo manualmente. Cuando el envío sí termina, el candado se revisa
**antes** de las llamadas a IA del siguiente turno. Por eso el siguiente mensaje del cliente
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
  amable y activa la pausa después del envío;
- pareja exige nombre y apellido de ambos y acepta una foto de los dos;
- personal exige, en orden, foto de rostro, nombre y apellido, y palma derecha;
- un nombre de pila sigue pendiente y puede enriquecerse con el nombre completo;
- el audio no lee «uno punto» y conserva también el último requisito;
- un envío fallido no pausa el chat;
- una pausa corta el flujo antes de volver a llamar a la IA;
- las fotos se clasifican y los datos persistidos no se pisan.
