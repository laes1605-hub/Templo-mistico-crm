/**
 * Lossless WebM/Matroska (Opus) -> OGG/Opus remuxer (server-side, zero dependencies).
 *
 * The WhatsApp Cloud API only accepts voice notes as OGG with the Opus codec
 * (`audio/ogg; codecs=opus`). Browsers record voice notes with MediaRecorder as
 * WebM/Matroska wrapping the *very same* Opus packets, so the audio can be
 * converted losslessly by rewrapping the packets into an OGG container — no
 * re-encoding and no native ffmpeg binary required (important for serverless).
 *
 * Supported input: Matroska/WebM files containing an `A_OPUS` track, including
 * streaming files with unknown-size segments (what Chrome's MediaRecorder
 * produces). SimpleBlock and BlockGroup blocks, all lacing modes.
 */

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

/** Iterate over the EBML elements contained in buf[start, end). */
function forEachElement(buf: Buffer, start: number, end: number, cb: (id: number, bodyStart: number, bodyEnd: number) => void): void {
  let pos = start;
  while (pos + 2 <= end) {
    const first = buf[pos];
    if (first === 0) return; // padding / invalid
    let idLen = 1;
    let mask = 0x80;
    while ((first & mask) === 0) {
      mask >>= 1;
      idLen++;
      if (idLen > 4) return;
    }
    const sPos = pos + idLen;
    if (sPos >= end) return;
    let id = first;
    for (let i = 1; i < idLen; i++) id = id * 256 + buf[pos + i];

    const sFirst = buf[sPos];
    if (sFirst === undefined || sFirst === 0) return;
    let sLen = 1;
    let sMask = 0x80;
    while ((sFirst & sMask) === 0) {
      sMask >>= 1;
      sLen++;
      if (sLen > 8) return;
    }
    if (sPos + sLen > end) return;
    let size = sFirst & (sMask - 1);
    for (let i = 1; i < sLen; i++) size = size * 256 + buf[sPos + i];

    const unknownSize = size === Math.pow(2, 7 * sLen) - 1; // all-one vint (streaming)
    const bodyStart = sPos + sLen;
    const bodyEnd = unknownSize || bodyStart + size > end ? end : bodyStart + size;
    cb(id, bodyStart, bodyEnd);
    if (unknownSize) return; // the body consumed the rest of the scope
    pos = bodyEnd;
  }
}

function readUint(buf: Buffer, start: number, end: number): number {
  let value = 0;
  for (let i = start; i < end; i++) value = value * 256 + buf[i];
  return value;
}

/** Read a Matroska block (SimpleBlock or Block) and emit (track, timestampNs, frame) for every frame. */
function forEachFrame(
  buf: Buffer,
  start: number,
  end: number,
  clusterTime: number,
  timecodeScale: number,
  emit: (track: number, timecodeNs: number, frame: Buffer) => void,
): void {
  let pos = start;
  const first = buf[pos];
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
  for (let i = 1; i < len; i++) track = track * 256 + buf[start + i];
  pos = start + len;
  if (pos + 3 > end) return;

  const relTimecode = buf.readInt16BE(pos); // signed 16-bit, relative to the cluster timecode
  pos += 2;
  const flags = buf[pos];
  pos += 1;
  const lacing = (flags >> 1) & 0x03;

  const frames: Buffer[] = [];
  if (lacing === 0) {
    frames.push(buf.subarray(pos, end));
  } else {
    if (pos >= end) return;
    const frameCount = buf[pos] + 1;
    pos += 1;
    const sizes: number[] = [];
    if (lacing === 1) {
      // Xiph: 255-run terminated sizes for all but the last frame.
      for (let f = 0; f < frameCount - 1 && pos < end; f++) {
        let size = 0;
        while (pos < end) {
          const b = buf[pos++];
          size += b;
          if (b < 255) break;
        }
        sizes.push(size);
      }
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
        const vFirst = buf[pos];
        let vLen = 1;
        let vMask = 0x80;
        while ((vFirst & vMask) === 0) {
          vMask >>= 1;
          vLen++;
          if (vLen > 8) return { value: 0, length: 0 };
        }
        if (pos + vLen > end) return { value: 0, length: 0 };
        let v = vFirst & (vMask - 1);
        for (let i = 1; i < vLen; i++) v = v * 256 + buf[pos + i];
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
      frames.push(buf.subarray(cursor, frameEnd));
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

function opusPacketSamples(pkt: Buffer): number {
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

function oggCrc32(buf: Buffer): number {
  let crc = 0;
  for (let i = 0; i < buf.length; i++) crc = (((crc << 8) >>> 0) ^ OGG_CRC_TABLE[((crc >>> 24) ^ buf[i]) & 0xff]) >>> 0;
  return crc;
}

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

function buildOpusHead(codecPrivate: Buffer | null, channels: number): Buffer {
  if (codecPrivate && codecPrivate.length >= 19 && codecPrivate.toString("latin1", 0, 8) === "OpusHead" && codecPrivate[8] <= 1) {
    return codecPrivate;
  }
  // Fallback: synthesize a mono 48 kHz head (MediaRecorder always writes one,
  // so this is only defensive).
  const head = Buffer.alloc(19);
  head.write("OpusHead", 0, "latin1");
  head[8] = 1; // version
  head[9] = Math.min(Math.max(channels || 1, 1), 2);
  head.writeUInt16LE(312, 10); // pre-skip (libopus default)
  head.writeUInt32LE(SAMPLES_PER_SECOND, 12); // input sample rate
  head.writeInt16LE(0, 16); // output gain
  head[18] = 0; // channel mapping family
  return head;
}

function buildOpusTags(): Buffer {
  const vendor = "templo-mistico-crm remux";
  const tags = Buffer.alloc(8 + 4 + vendor.length + 4);
  tags.write("OpusTags", 0, "latin1");
  tags.writeUInt32LE(vendor.length, 8);
  tags.write(vendor, 12, "latin1");
  tags.writeUInt32LE(0, 8 + 4 + vendor.length); // zero user comments
  return tags;
}

/**
 * Remux the Opus track of a WebM/Matroska buffer into a valid OGG/Opus stream
 * (`audio/ogg; codecs=opus`). Throws when the input contains no Opus packets.
 */
export function remuxWebmToOgg(webm: Uint8Array): Buffer {
  const buf = Buffer.isBuffer(webm) ? webm : Buffer.from(webm);
  if (!buf.length) throw new Error("El WebM está vacío");

  type TrackInfo = { codecId: string; codecPrivate: Buffer | null; channels: number };
  const tracks = new Map<number, TrackInfo>();
  let timecodeScale = 1_000_000; // nanoseconds per tick (Matroska default = 1 ms)
  const packets: { timecodeNs: number; data: Buffer }[] = [];
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
    forEachFrame(buf, start, end, clusterTime, timecodeScale, (track, timecodeNs, frame) => {
      if (track !== opusTrack) return;
      packets.push({ timecodeNs, data: frame });
    });
  };

  forEachElement(buf, 0, buf.length, (id, bs, be) => {
    if (id !== ID_SEGMENT) return; // EBML header, Void, etc.
    forEachElement(buf, bs, be, (id2, bs2, be2) => {
      if (id2 === ID_INFO) {
        forEachElement(buf, bs2, be2, (id3, bs3, be3) => {
          if (id3 === ID_TIMECODE_SCALE) timecodeScale = readUint(buf, bs3, be3) || 1_000_000;
        });
      } else if (id2 === ID_TRACKS) {
        forEachElement(buf, bs2, be2, (id3, bs3, be3) => {
          if (id3 !== ID_TRACK_ENTRY) return;
          let trackNumber = -1;
          const info: TrackInfo = { codecId: "", codecPrivate: null, channels: 0 };
          forEachElement(buf, bs3, be3, (id4, bs4, be4) => {
            if (id4 === ID_TRACK_NUMBER) trackNumber = readUint(buf, bs4, be4);
            else if (id4 === ID_CODEC_ID) info.codecId = buf.toString("latin1", bs4, be4);
            else if (id4 === ID_CODEC_PRIVATE) info.codecPrivate = buf.subarray(bs4, be4);
            else if (id4 === ID_AUDIO) {
              forEachElement(buf, bs4, be4, (id5, bs5, be5) => {
                if (id5 === ID_CHANNELS) info.channels = readUint(buf, bs5, be5);
              });
            }
          });
          if (trackNumber >= 0) tracks.set(trackNumber, info);
        });
      } else if (id2 === ID_CLUSTER) {
        forEachElement(buf, bs2, be2, (id3, bs3, be3) => {
          if (id3 === ID_TIMECODE) clusterTime = readUint(buf, bs3, be3);
          else if (id3 === ID_SIMPLE_BLOCK) collectBlock(bs3, be3);
          else if (id3 === ID_BLOCK_GROUP) {
            forEachElement(buf, bs3, be3, (id4, bs4, be4) => {
              if (id4 === ID_BLOCK) collectBlock(bs4, be4);
            });
          }
        });
      }
    });
  });

  if (!packets.length) throw new Error("El WebM no contiene paquetes Opus");

  // ---- Mux the collected packets into OGG pages ----
  const serial = Math.floor(Math.random() * 0x100000000) >>> 0;
  let pageSeq = 0;
  const pages: Buffer[] = [];

  const buildPage = (headerType: number, granule: number, segments: number[], payload: Buffer[]): Buffer => {
    const payloadLength = payload.reduce((total, chunk) => total + chunk.length, 0);
    const page = Buffer.alloc(27 + segments.length + payloadLength);
    page.write("OggS", 0, "latin1");
    page[4] = 0; // version
    page[5] = headerType;
    // Granule position as unsigned little-endian int64 (plain number arithmetic:
    // sample counts stay far below Number.MAX_SAFE_INTEGER for any voice note).
    let granuleValue = granule;
    for (let i = 0; i < 8; i++) {
      page[6 + i] = granuleValue % 256;
      granuleValue = Math.floor(granuleValue / 256);
    }
    page.writeUInt32LE(serial, 14);
    page.writeUInt32LE(pageSeq, 18);
    page.writeUInt32LE(0, 22); // CRC placeholder
    page[26] = segments.length;
    for (let i = 0; i < segments.length; i++) page[27 + i] = segments[i];
    let offset = 27 + segments.length;
    for (const chunk of payload) {
      chunk.copy(page, offset);
      offset += chunk.length;
    }
    page.writeUInt32LE(oggCrc32(page), 22);
    pageSeq++;
    return page;
  };

  const head = buildOpusHead(tracks.get(opusTrack!)?.codecPrivate ?? null, tracks.get(opusTrack!)?.channels ?? 1);
  const preSkip = head.readUInt16LE(10);
  pages.push(buildPage(0x02 /* BOS */, 0, lacingValues(head.length), [head]));
  const tags = buildOpusTags();
  pages.push(buildPage(0x00, 0, lacingValues(tags.length), [tags]));

  // RFC 7845: the granule position counts decoded 48 kHz samples including pre-skip.
  // Counting samples from each packet's TOC byte (exact) keeps granules monotonic
  // and immune to Matroska timestamp rounding.
  let segments: number[] = [];
  let payload: Buffer[] = [];
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

  for (const packet of packets) {
    totalSamples += opusPacketSamples(packet.data);
    lastGranule = preSkip + totalSamples;
    const lacing = lacingValues(packet.data.length);
    if (lacing.length > 255) throw new Error("Paquete Opus demasiado grande para una página OGG");
    if (segmentCount + lacing.length > 255 || payloadBytes + packet.data.length > 65025) flushPage(false);
    segments.push(...lacing);
    payload.push(packet.data);
    segmentCount += lacing.length;
    payloadBytes += packet.data.length;
  }
  flushPage(true);

  return Buffer.concat(pages);
}
