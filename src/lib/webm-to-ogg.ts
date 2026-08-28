/**
 * Lossless WebM/Matroska (Opus) -> OGG/Opus remuxer (isomorphic, zero dependencies).
 *
 * The WhatsApp Cloud API only accepts voice notes as OGG with the Opus codec
 * (`audio/ogg; codecs=opus`). Browsers record voice notes with MediaRecorder as
 * WebM/Matroska wrapping the *very same* Opus packets, so the audio can be
 * converted losslessly by rewrapping the packets into an OGG container — no
 * re-encoding and no native ffmpeg binary required (important for serverless).
 *
 * Este archivo es isomórtico (solo `Uint8Array`/`DataView`, sin `Buffer` de
 * Node): se usa en el route /api/send-message (servidor) y también en el
 * navegador/APK para guardar las notas de voz del chat en formato OGG.
 *
 * Supported input: Matroska/WebM files containing an `A_OPUS` track, including
 * live-recorded files (Chrome MediaRecorder) where the Segment AND every
 * Cluster are written with unknown sizes, blocks grouped in BlockGroup, and
 * Xiph/fixed/EBML lacing. SimpleBlock and BlockGroup, all lacing modes.
 */

// ---- Helpers latin1 (el Buffer de Node no existe en el navegador) ----
function latin1Decode(u8: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end; i++) out += String.fromCharCode(u8[i]);
  return out;
}

function latin1Encode(str: string, u8: Uint8Array, offset: number): void {
  for (let i = 0; i < str.length && offset + i < u8.length; i++) {
    u8[offset + i] = str.charCodeAt(i) & 0xff;
  }
}

function concatU8(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// ---- Matroska element IDs (enough to locate the Opus track and packets) ----
const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_TIMECODE_SCALE = 0x2ad7b1;
const ID_TRACKS = 0x1654ae6b;
const ID_TRACK_ENTRY = 0xae;
const ID_TRACK_NUMBER = 0xd7;
const ID_CODEC_ID = 0x86;
const ID_CODEC_PRIVATE = 0x63a2;
const ID_AUDIO = 0xe1;
const ID_CHANNELS = 0x9f;
const ID_CLUSTER = 0x1f43b675;
const ID_TIMECODE = 0xe7;
const ID_SIMPLE_BLOCK = 0xa3;
const ID_BLOCK_GROUP = 0xa0;
const ID_BLOCK = 0xa1;

const SAMPLES_PER_SECOND = 48000; // Opus always decodes at 48 kHz

/** One EBML element: header + body boundaries, and whether the size was known. */
type Element = {
  id: number;
  bodyStart: number;
  bodyEnd: number; // for unknown sizes this equals `scopeEnd`
  known: boolean;
};

/** Read the element that starts at `pos`, bounded by `scopeEnd`. Null when done/invalid. */
function readElement(u8: Uint8Array, pos: number, scopeEnd: number): Element | null {
  if (pos + 2 > scopeEnd) return null;
  const first = u8[pos];
  if (first === 0) return null; // padding / invalid
  let idLen = 1;
  let mask = 0x80;
  while ((first & mask) === 0) {
    mask >>= 1;
    idLen++;
    if (idLen > 4) return null;
  }
  const sPos = pos + idLen;
  if (sPos >= scopeEnd) return null;
  let id = first;
  for (let i = 1; i < idLen; i++) id = id * 256 + u8[pos + i];

  const sFirst = u8[sPos];
  if (sFirst === undefined || sFirst === 0) return null;
  let sLen = 1;
  let sMask = 0x80;
  while ((sFirst & sMask) === 0) {
    sMask >>= 1;
    sLen++;
    if (sLen > 8) return null;
  }
  if (sPos + sLen > scopeEnd) return null;
  let size = sFirst & (sMask - 1);
  for (let i = 1; i < sLen; i++) size = size * 256 + u8[sPos + i];

  const known = size !== Math.pow(2, 7 * sLen) - 1; // all-one vint = unknown (streaming)
  const bodyStart = sPos + sLen;
  const bodyEnd = known ? Math.min(bodyStart + size, scopeEnd) : scopeEnd;
  return { id, bodyStart, bodyEnd, known };
}

/** Iterate over the EBML children with KNOWN sizes contained in [start, end). */
function forEachElement(u8: Uint8Array, start: number, end: number, cb: (id: number, bodyStart: number, bodyEnd: number) => void): void {
  let pos = start;
  while (true) {
    const el = readElement(u8, pos, end);
    if (!el || !el.known) return; // unknown-size children are handled by the callers
    cb(el.id, el.bodyStart, el.bodyEnd);
    pos = el.bodyEnd;
  }
}

function readUint(u8: Uint8Array, start: number, end: number): number {
  let value = 0;
  for (let i = start; i < end; i++) value = value * 256 + u8[i];
  return value;
}

/** Read a Matroska block (SimpleBlock or Block) and emit (track, timestampNs, frame) for every frame. */
function forEachFrame(
  u8: Uint8Array,
  dv: DataView,
  start: number,
  end: number,
  clusterTime: number,
  timecodeScale: number,
  emit: (track: number, timecodeNs: number, frame: Uint8Array) => void,
): void {
  let pos = start;
  const first = u8[pos];
  if (first === undefined || first === 0) return;

  // Track number (vint with the marker bit stripped).
  let len = 1;
  let mask = 0x80;
  while ((first & mask) === 0) {
    mask >>= 1;
    len++;
    if (len > 8) return;
  }
  let track = first & (mask - 1);
  for (let i = 1; i < len; i++) track = track * 256 + u8[start + i];
  pos = start + len;
  if (pos + 3 > end) return;

  const relTimecode = dv.getInt16(pos); // signed 16-bit, relative to the cluster timecode
  pos += 2;
  const flags = u8[pos];
  pos += 1;
  const lacing = (flags >> 1) & 0x03;

  const frames: Uint8Array[] = [];
  if (lacing === 0) {
    frames.push(u8.subarray(pos, end));
  } else {
    if (pos >= end) return;
    const frameCount = u8[pos] + 1;
    pos += 1;
    const sizes: number[] = [];
    if (lacing === 1) {
      // Xiph: 255-run terminated sizes for all but the last frame.
      for (let f = 0; f < frameCount - 1 && pos < end; f++) {
        let size = 0;
        while (pos < end) {
          const b = u8[pos++];
          size += b;
          if (b < 255) break;
        }
        sizes.push(size);
      }
      // El último frame = los bytes restantes del block (la spec de Xiph no
      // lo declara; sin esto se perdía el frame final de cada block laceado).
      sizes.push(end - pos - sizes.reduce((a, b) => a + b, 0));
    } else if (lacing === 2) {
      // Fixed: every frame has the same size, the last one takes the remainder.
      const available = end - pos;
      const size = Math.floor(available / frameCount);
      for (let f = 0; f < frameCount - 1; f++) sizes.push(size);
      sizes.push(available - size * (frameCount - 1));
    } else {
      // EBML: first size is a vint, then signed vint deltas (usually single byte).
      const readVint = () => {
        if (pos >= end) return { value: 0, length: 0 };
        const vFirst = u8[pos];
        let vLen = 1;
        let vMask = 0x80;
        while ((vFirst & vMask) === 0) {
          vMask >>= 1;
          vLen++;
          if (vLen > 8) return { value: 0, length: 0 };
        }
        if (pos + vLen > end) return { value: 0, length: 0 };
        let v = vFirst & (vMask - 1);
        for (let i = 1; i < vLen; i++) v = v * 256 + u8[pos + i];
        pos += vLen;
        return { value: v, length: vLen };
      };
      let size = readVint().value;
      sizes.push(size);
      for (let f = 1; f < frameCount - 1; f++) {
        const delta = readVint();
        const bits = 7 * Math.max(delta.length, 1);
        const signBit = Math.pow(2, bits - 1);
        const signed = delta.value >= signBit ? delta.value - 2 * signBit : delta.value;
        size += signed;
        sizes.push(size);
      }
      sizes.push(end - pos - sizes.reduce((a, b) => a + b, 0));
    }
    let cursor = pos;
    for (const size of sizes) {
      const frameEnd = Math.min(cursor + Math.max(size, 0), end);
      frames.push(u8.subarray(cursor, frameEnd));
      cursor = frameEnd;
    }
  }

  const timecodeNs = (clusterTime + relTimecode) * timecodeScale;
  for (const frame of frames) {
    if (frame.length > 0) emit(track, timecodeNs, frame);
  }
}

// ---- Opus packet duration (RFC 6716 section 3.1, needed for exact OGG granule positions) ----
// TOC byte layout: | config (5 bits) | stereo (1 bit) | code (2 bits) |
const OPUS_FRAME_MS: number[] = (() => {
  const table = new Array<number>(32);
  for (let i = 0; i < 12; i++) table[i] = [10, 20, 40, 60][i % 4]; // SILK NB/MB/WB
  for (let i = 12; i < 16; i++) table[i] = i % 2 === 0 ? 10 : 20; // Hybrid SWB/FB
  for (let i = 16; i < 32; i++) table[i] = [2.5, 5, 10, 20][i % 4]; // CELT NB/WB/SWB/FB
  return table;
})();

function opusPacketSamples(pkt: Uint8Array): number {
  const toc = pkt[0];
  const code = toc & 3;
  // code 0: one frame; code 1: two frames (VBR sizes); code 2: two frames (equal size);
  // code 3: frame-count byte |V (msb) | count (7 bits)| — a count of 0 is padding-only.
  const frames = code === 0 ? 1 : code === 3 ? (pkt.length >= 2 ? pkt[1] & 0x7f : 0) : 2;
  return Math.round((frames * OPUS_FRAME_MS[toc >> 3] * SAMPLES_PER_SECOND) / 1000);
}

// ---- OGG ----
const OGG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = (i << 24) >>> 0;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0;
    table[i] = r;
  }
  return table;
})();

function oggCrc32(u8: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < u8.length; i++) crc = (((crc << 8) >>> 0) ^ OGG_CRC_TABLE[((crc >>> 24) ^ u8[i]) & 0xff]) >>> 0;
  return crc;
}

/**
 * Lacing values OGG (RFC 3533, sección 5) para un payload de `length` bytes:
 * el valor de lacing es la longitud CRUDA de la porción de segmento: 255
 * significa "sigue en el siguiente lacing" (aporta 255 bytes) y un valor
 * L < 255 cierra el paquete "after that many additional bytes". Un paquete
 * de exactamente 255 bytes (o múltiplo) termina con lacing 0. Verificado
 * contra libogg y decodificadores reales (codec-parser): NO lleva el +1 que
 * tiene el Xiph lacing de WebM (no confundir).
 */
const lacingValues = (length: number): number[] => {
  const values: number[] = [];
  let remaining = length;
  while (remaining >= 255) {
    values.push(255);
    remaining -= 255;
  }
  values.push(remaining);
  return values;
};

function buildOpusHead(codecPrivate: Uint8Array | null, channels: number): Uint8Array {
  if (codecPrivate && codecPrivate.length >= 19 && latin1Decode(codecPrivate, 0, 8) === "OpusHead" && codecPrivate[8] <= 1) {
    return codecPrivate;
  }
  // Fallback: synthesize a mono 48 kHz head (MediaRecorder always writes one,
  // so this is only defensive).
  const head = new Uint8Array(19);
  const dv = new DataView(head.buffer);
  latin1Encode("OpusHead", head, 0);
  head[8] = 1; // version
  head[9] = Math.min(Math.max(channels || 1, 1), 2);
  dv.setUint16(10, 312, true); // pre-skip (libopus default)
  dv.setUint32(12, SAMPLES_PER_SECOND, true); // input sample rate
  dv.setInt16(16, 0, true); // output gain
  head[18] = 0; // channel mapping family
  return head;
}

function buildOpusTags(): Uint8Array {
  const vendor = "templo-mistico-crm remux";
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  const dv = new DataView(tags.buffer);
  latin1Encode("OpusTags", tags, 0);
  dv.setUint32(8, vendor.length, true);
  latin1Encode(vendor, tags, 12);
  dv.setUint32(8 + 4 + vendor.length, 0, true); // zero user comments
  return tags;
}

/**
 * Remux the Opus track of a WebM/Matroska buffer into a valid OGG/Opus stream
 * (`audio/ogg; codecs=opus`). Throws when the input contains no Opus packets.
 *
 * Isomórtico: funciona en Node (pase un `Buffer`, que es un `Uint8Array`) y
 * en el navegador/APK. Devuelve `Uint8Array` (el servidor puede envolverlo
 * con `Buffer.from(...)`).
 */
export function remuxWebmToOgg(webm: Uint8Array, options: { prerollMs?: number } = {}): Uint8Array {
  if (!webm || !webm.length) throw new Error("El WebM está vacío");
  const u8 = webm;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  type TrackInfo = { codecId: string; codecPrivate: Uint8Array | null; channels: number };
  const tracks = new Map<number, TrackInfo>();
  let timecodeScale = 1_000_000; // nanoseconds per tick (Matroska default = 1 ms)
  const packets: { data: Uint8Array }[] = [];
  let clusterTime = 0;
  let opusTrack: number | null = null;

  const collectBlock = (start: number, end: number) => {
    if (opusTrack === null) {
      for (const [number, info] of tracks) {
        if (info.codecId === "A_OPUS") {
          opusTrack = number;
          break;
        }
      }
    }
    if (opusTrack === null) return;
    forEachFrame(u8, dv, start, end, clusterTime, timecodeScale, (track, _timecodeNs, frame) => {
      if (track !== opusTrack) return;
      packets.push({ data: frame });
    });
  };

  /** Parse the children of a Cluster. Returns the position where the Segment walk should continue. */
  const parseCluster = (cluster: Element, segmentEnd: number): number => {
    const end = cluster.known ? cluster.bodyEnd : segmentEnd;
    let pos = cluster.bodyStart;
    while (true) {
      const child = readElement(u8, pos, end);
      if (!child) return end;
      // A live-recorded (unknown-size) cluster implicitly ends where the next
      // sibling element of the Segment level begins.
      if (!cluster.known && (child.id === ID_CLUSTER || child.id === ID_INFO || child.id === ID_TRACKS)) return pos;
      if (child.id === ID_TIMECODE) {
        clusterTime = readUint(u8, child.bodyStart, child.bodyEnd);
      } else if (child.id === ID_SIMPLE_BLOCK) {
        collectBlock(child.bodyStart, child.bodyEnd);
      } else if (child.id === ID_BLOCK_GROUP) {
        const groupEnd = child.known ? child.bodyEnd : end;
        let gpos = child.bodyStart;
        while (true) {
          const inner = readElement(u8, gpos, groupEnd);
          if (!inner) break;
          if (!child.known && (inner.id === ID_TIMECODE || inner.id === ID_SIMPLE_BLOCK || inner.id === ID_BLOCK_GROUP || inner.id === ID_CLUSTER)) break;
          if (inner.id === ID_BLOCK) collectBlock(inner.bodyStart, inner.bodyEnd);
          if (!inner.known) break;
          gpos = inner.bodyEnd;
        }
      }
      if (!child.known) return end; // a block child with unknown size cannot be bounded
      pos = child.bodyEnd;
    }
  };

  // Walk the top level (EBML header, then one Segment).
  let top = 0;
  while (true) {
    const el = readElement(u8, top, u8.length);
    if (!el) break;
    if (el.id === ID_SEGMENT) {
      const segmentEnd = el.known ? el.bodyEnd : u8.length;
      let pos = el.bodyStart;
      while (pos + 2 <= segmentEnd) {
        const child = readElement(u8, pos, segmentEnd);
        if (!child) break;
        if (child.id === ID_INFO) {
          forEachElement(u8, child.bodyStart, child.bodyEnd, (id, bs, be) => {
            if (id === ID_TIMECODE_SCALE) timecodeScale = readUint(u8, bs, be) || 1_000_000;
          });
        } else if (child.id === ID_TRACKS) {
          forEachElement(u8, child.bodyStart, child.bodyEnd, (id, bs, be) => {
            if (id !== ID_TRACK_ENTRY) return;
            let trackNumber = -1;
            const info: TrackInfo = { codecId: "", codecPrivate: null, channels: 0 };
            forEachElement(u8, bs, be, (id2, bs2, be2) => {
              if (id2 === ID_TRACK_NUMBER) trackNumber = readUint(u8, bs2, be2);
              else if (id2 === ID_CODEC_ID) info.codecId = latin1Decode(u8, bs2, be2);
              else if (id2 === ID_CODEC_PRIVATE) info.codecPrivate = u8.subarray(bs2, be2);
              else if (id2 === ID_AUDIO) {
                forEachElement(u8, bs2, be2, (id3, bs3, be3) => {
                  if (id3 === ID_CHANNELS) info.channels = readUint(u8, bs3, be3);
                });
              }
            });
            if (trackNumber >= 0) tracks.set(trackNumber, info);
          });
        } else if (child.id === ID_CLUSTER) {
          pos = parseCluster(child, segmentEnd);
          continue;
        }
        pos = child.known ? child.bodyEnd : segmentEnd;
      }
    }
    if (!el.known) break; // unknown-size Segment reaches the end of the buffer
    top = el.bodyEnd;
  }

  if (!packets.length) throw new Error("El WebM no contiene paquetes Opus");

  // ---- Mux the collected packets into OGG pages ----
  const serial = Math.floor(Math.random() * 0x100000000) >>> 0;
  let pageSeq = 0;
  const pages: Uint8Array[] = [];

  const buildPage = (headerType: number, granule: number, segments: number[], payload: Uint8Array[]): Uint8Array => {
    const payloadLength = payload.reduce((total, chunk) => total + chunk.length, 0);
    const page = new Uint8Array(27 + segments.length + payloadLength);
    const pdv = new DataView(page.buffer);
    latin1Encode("OggS", page, 0);
    page[4] = 0; // version
    page[5] = headerType;
    // Granule position as unsigned little-endian int64 (plain number arithmetic:
    // sample counts stay far below Number.MAX_SAFE_INTEGER for any voice note).
    let granuleValue = granule;
    for (let i = 0; i < 8; i++) {
      page[6 + i] = granuleValue % 256;
      granuleValue = Math.floor(granuleValue / 256);
    }
    pdv.setUint32(14, serial, true);
    pdv.setUint32(18, pageSeq, true);
    pdv.setUint32(22, 0, true); // CRC placeholder
    page[26] = segments.length;
    for (let i = 0; i < segments.length; i++) page[27 + i] = segments[i];
    let offset = 27 + segments.length;
    for (const chunk of payload) {
      page.set(chunk, offset);
      offset += chunk.length;
    }
    pdv.setUint32(22, oggCrc32(page), true);
    pageSeq++;
    return page;
  };

  const trackInfo = tracks.get(opusTrack!) ?? { codecId: "A_OPUS", codecPrivate: null, channels: 1 };
  const head = buildOpusHead(trackInfo.codecPrivate, trackInfo.channels);
  const preSkip = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint16(10, true);
  const prerollMs = Math.max(0, Math.min(options.prerollMs || 0, 3000));
  const silencePackets = Math.round(prerollMs / 20);
  // A valid 20 ms Opus silence/CN packet. Padding the start avoids the first
  // spoken syllables being eaten by mobile/WhatsApp decoder warm-up.
  const opusSilence20Ms = Uint8Array.from([0xf8, 0xff, 0xfe]);
  pages.push(buildPage(0x02 /* BOS */, 0, lacingValues(head.length), [head]));
  const tags = buildOpusTags();
  pages.push(buildPage(0x00, 0, lacingValues(tags.length), [tags]));

  // RFC 7845: the granule position counts decoded 48 kHz samples including pre-skip.
  // Counting samples from each packet's TOC byte (exact) keeps granules monotonic
  // and immune to Matroska timestamp rounding.
  let segments: number[] = [];
  let payload: Uint8Array[] = [];
  let segmentCount = 0;
  let payloadBytes = 0;
  let lastGranule = 0;
  let totalSamples = 0;

  const flushPage = (isLast: boolean) => {
    if (!payload.length) return;
    pages.push(buildPage(isLast ? 0x04 /* EOS */ : 0x00, lastGranule, segments, payload));
    segments = [];
    payload = [];
    segmentCount = 0;
    payloadBytes = 0;
  };

  const addPacket = (data: Uint8Array) => {
    totalSamples += opusPacketSamples(data);
    lastGranule = preSkip + totalSamples;
    const lacing = lacingValues(data.length);
    if (lacing.length > 255) throw new Error("Paquete Opus demasiado grande para una página OGG");
    if (segmentCount + lacing.length > 255 || payloadBytes + data.length > 65025) flushPage(false);
    segments.push(...lacing);
    payload.push(data);
    segmentCount += lacing.length;
    payloadBytes += data.length;
  };

  for (let i = 0; i < silencePackets; i++) addPacket(opusSilence20Ms);
  for (const packet of packets) addPacket(packet.data);
  flushPage(true);

  return concatU8(pages);
}
