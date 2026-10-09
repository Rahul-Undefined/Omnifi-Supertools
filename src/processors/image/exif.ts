/** Minimal EXIF reader for JPEG: pulls the tags people actually look for. */
const TAGS: Record<number, string> = {
  0x010f: "Make",
  0x0110: "Model",
  0x0112: "Orientation",
  0x0131: "Software",
  0x0132: "DateTime",
  0x829a: "ExposureTime",
  0x829d: "FNumber",
  0x8827: "ISO",
  0x9003: "DateTimeOriginal",
  0x920a: "FocalLength",
  0xa002: "PixelXDimension",
  0xa003: "PixelYDimension",
  0x0002: "GPSLatitude",
  0x0001: "GPSLatitudeRef",
  0x0004: "GPSLongitude",
  0x0003: "GPSLongitudeRef",
};

export async function readExif(file: Blob): Promise<Record<string, string | number>> {
  const buf = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
  if (buf.byteLength < 4 || buf.getUint16(0) !== 0xffd8) return {};
  let offset = 2;
  while (offset < buf.byteLength - 4) {
    const marker = buf.getUint16(offset);
    if (marker === 0xffe1) {
      const len = buf.getUint16(offset + 2);
      if (offset + 10 <= buf.byteLength && buf.getUint32(offset + 4) === 0x45786966) return parseTiff(buf, offset + 10, Math.min(buf.byteLength, offset + 2 + len));
      offset += 2 + len;
    } else if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
    else offset += 2 + buf.getUint16(offset + 2);
  }
  return {};
}

function parseTiff(dv: DataView, start: number, end: number): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  const le = dv.getUint16(start) === 0x4949;
  const u16 = (o: number) => dv.getUint16(o, le);
  const u32 = (o: number) => dv.getUint32(o, le);
  const gpsTags = new Set([1, 2, 3, 4]);
  const readIfd = (ifd: number, gps: boolean) => {
    if (ifd < start || ifd + 2 > end) return;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > end) return;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8][type] ?? 1;
      const valOff = count * size > 4 ? start + u32(e + 8) : e + 8;
      if (tag === 0x8769) { readIfd(start + u32(e + 8), false); continue; }
      if (tag === 0x8825) { readIfd(start + u32(e + 8), true); continue; }
      const name = TAGS[tag];
      if (!name || gps !== gpsTags.has(tag)) continue;
      try {
        if (type === 2) {
          let s = "";
          for (let k = 0; k < count - 1 && valOff + k < end; k++) s += String.fromCharCode(dv.getUint8(valOff + k));
          out[name] = s.trim();
        } else if (type === 3) out[name] = u16(valOff);
        else if (type === 4) out[name] = u32(valOff);
        else if (type === 5) {
          const vals: number[] = [];
          for (let k = 0; k < count && valOff + k * 8 + 8 <= end; k++) vals.push(u32(valOff + k * 8) / (u32(valOff + k * 8 + 4) || 1));
          if (vals.length) out[name] = vals.length === 3 ? +(vals[0] + vals[1] / 60 + vals[2] / 3600).toFixed(6) : +vals[0].toFixed(4);
        }
      } catch {
        /* skip malformed entry */
      }
    }
  };
  try {
    readIfd(start + u32(start + 4), false);
  } catch {
    return out;
  }
  if (typeof out.GPSLatitude === "number" && typeof out.GPSLongitude === "number") {
    const lat = out.GPSLatitudeRef === "S" ? -out.GPSLatitude : out.GPSLatitude;
    const lon = out.GPSLongitudeRef === "W" ? -out.GPSLongitude : out.GPSLongitude;
    out.GPS = `${lat}, ${lon}`;
  }
  return out;
}
