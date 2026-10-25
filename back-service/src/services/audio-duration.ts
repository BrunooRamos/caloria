interface Box {
  start: number; // primer byte del contenido, después del header
  end: number;
}

function findBox(buf: Buffer, start: number, end: number, type: string): Box | undefined {
  let offset = start;
  while (offset + 8 <= end) {
    let size = buf.readUInt32BE(offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return undefined;
      const large = buf.readBigUInt64BE(offset + 8);
      if (large > BigInt(end - offset)) return undefined;
      size = Number(large);
      header = 16;
    } else if (size === 0) {
      size = end - offset; // la caja llega hasta el final
    }
    if (size < header || offset + size > end) return undefined;
    if (buf.toString("latin1", offset + 4, offset + 8) === type) {
      return { start: offset + header, end: offset + size };
    }
    offset += size;
  }
  return undefined;
}

const UNKNOWN_32 = 0xffffffff;
const UNKNOWN_64 = 0xffffffffffffffffn;

export function mp4DurationSeconds(buf: Buffer): number | undefined {
  const moov = findBox(buf, 0, buf.length, "moov");
  if (!moov) return undefined;
  const mvhd = findBox(buf, moov.start, moov.end, "mvhd");
  if (!mvhd) return undefined;

  const version = buf[mvhd.start];
  let timescale: number;
  let duration: number;
  if (version === 0 && mvhd.end - mvhd.start >= 20) {
    timescale = buf.readUInt32BE(mvhd.start + 12);
    const raw = buf.readUInt32BE(mvhd.start + 16);
    if (raw === UNKNOWN_32) return undefined;
    duration = raw;
  } else if (version === 1 && mvhd.end - mvhd.start >= 32) {
    timescale = buf.readUInt32BE(mvhd.start + 20);
    const raw = buf.readBigUInt64BE(mvhd.start + 24);
    if (raw === UNKNOWN_64) return undefined;
    duration = Number(raw);
  } else {
    return undefined;
  }
  if (timescale === 0 || duration === 0) return undefined;
  return duration / timescale;
}
