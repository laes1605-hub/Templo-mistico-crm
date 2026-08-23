# Notas de voz del Agente en OGG/Opus (n8n → Chatwoot → WhatsApp Business)

Flujo: **`templo-mistico-nota-de-voz-ogg-opus.json`**

## El problema

Meta (WhatsApp Cloud API) solo acepta audio en estos MIME:

```
audio/ogg; codecs=opus · audio/mpeg · audio/amr · audio/mp4 · audio/aac
```

Cuando el flujo manda el audio tal como sale del TTS, Meta lo rechaza con:

```
131053 Media upload error
"Unsupported Audio mime type audio/opus.
 Please use one of audio/ogg; codecs=opus, audio/mpeg, audio/amr, audio/mp4, audio/aac."
```

Fijate en el detalle: **`audio/opus` NO es lo mismo que `audio/ogg; codecs=opus`**. Opus "crudo"
(o dentro de un contenedor WebM/CAF) es un archivo distinto a Opus dentro de un contenedor OGG.
Pedir `format: "opus"` en Fish Audio **no garantiza** que el resultado sea un OGG válido, y aunque
lo sea, si el MIME/nombre del binario en n8n queda como `audio/opus` o `.opus`, Chatwoot se lo pasa
así a Meta y el envío falla o llega como archivo adjunto en vez de nota de voz.

Por eso hay **dos** arreglos, y hacen falta los dos.

## Los dos arreglos

**1. Normalizar el contenedor con ffmpeg** (nodo `ffmpeg → OGG/Opus`)

```bash
ffmpeg -y -i entrada -vn -map_metadata -1 \
  -ac 1 -ar 48000 -c:a libopus -b:a 32k -vbr on \
  -compression_level 10 -application voip -f ogg salida.ogg
```

| Flag | Por qué |
|---|---|
| `-c:a libopus` + `-f ogg` | Opus **dentro de OGG**: lo único que acepta Meta |
| `-ac 1` | Mono, como una nota de voz real |
| `-ar 48000` | 48 kHz, el rate nativo de Opus |
| `-application voip` | Optimiza el encoder para voz |
| `-b:a 32k` | Archivo liviano; suficiente para voz |
| `-map_metadata -1` | Saca metadatos que a veces confunden el sniffing de MIME |

Convierte desde **cualquier** formato de entrada (mp3, wav, opus crudo, m4a), así que el flujo no se
rompe si Fish Audio cambia lo que devuelve.

**2. Forzar el MIME y el nombre** (nodo `Forzar MIME audio/ogg`)

ffmpeg produce el archivo correcto, pero n8n sigue etiquetando el binario con el MIME viejo. Ese nodo
reescribe los metadatos que Chatwoot lee:

```js
bin.fileName  = 'nota_de_voz.ogg';
bin.mimeType  = 'audio/ogg';   // NUNCA 'audio/opus'
```

y antes valida los bytes de verdad: firma `OggS` (offset 0) y cabecera `OpusHead` (offset 28).
Si ffmpeg falló en silencio, el flujo corta con un error claro en vez de mandarle basura a Meta.

## Instalación

1. n8n → **Import from File** → elegí el JSON.
2. Credenciales (las dos son tipo **Header Auth**):

   | Nodo | Name | Value |
   |---|---|---|
   | Fish Audio TTS | `Authorization` | `Bearer TU_FISH_AUDIO_API_KEY` |
   | Enviar a Chatwoot | `api_access_token` | `TU_CHATWOOT_API_TOKEN` |

3. En **Preparar variables** ajustá `CHATWOOT_URL` y `CHATWOOT_CUENTA` si tu cuenta no es la `1`.
   Poné tu voz clonada en `FISH_REFERENCE_ID` (o mandá `reference_id` en la llamada).
4. **ffmpeg tiene que existir dentro del contenedor de n8n**:

   ```bash
   docker exec -it n8n ffmpeg -version          # verificar
   docker exec -it -u root n8n apk add ffmpeg   # imagen oficial (Alpine)
   ```

   Y el nodo Execute Command debe estar habilitado:
   `NODES_EXCLUDE` **no** debe incluir `n8n-nodes-base.executeCommand`.

## Cómo llamarlo desde el Agente Luna

Es un sub-workflow. Desde tu flujo principal usá **Execute Sub-workflow** con:

```json
{
  "texto": "{{ $json.output }}",
  "conversation_id": "{{ $json.chatwoot_conversation_id }}",
  "reference_id": "opcional-id-de-voz"
}
```

`caption` va vacío a propósito: una nota de voz real no lleva texto al lado.

## Probarlo

Usá el trigger **Probar manualmente** (ya trae datos de prueba, solo cambiá el `conversation_id`).
Chequeá en el nodo `Forzar MIME audio/ogg` que la salida diga:

```
ogg_valido: true · ogg_canales: 1 · mimeType: audio/ogg
```

Verificación local de cualquier archivo generado:

```bash
ffprobe nota_de_voz.ogg
# Input #0, ogg → Stream #0:0: Audio: opus, 48000 Hz, mono   ✅
```

Si ves `Input #0, matroska,webm` o `Audio: mp3`, la conversión no corrió.

## Si algo falla

| Síntoma | Causa |
|---|---|
| `ffmpeg: command not found` (exitCode 127) | Falta ffmpeg en el contenedor → `apk add ffmpeg` |
| `El OGG no contiene un stream Opus` | Tu ffmpeg vino sin libopus → `ffmpeg -encoders \| grep opus` |
| Sigue el error 131053 | Algún nodo posterior repone el MIME; confirmá que `Forzar MIME` va **antes** de Chatwoot |
| Llega como archivo adjunto y no como nota de voz | Chatwoot manda `audio/ogg` pero sin `codecs=opus`; el audio igual se reproduce. Para PTT nativo garantizado hay que ir por Evolution API (`/message/sendWhatsAppAudio`) |
| El audio llega mudo o cortado | Fish Audio devolvió un error JSON en vez de audio: mirá el nodo `Guardar audio crudo` |
