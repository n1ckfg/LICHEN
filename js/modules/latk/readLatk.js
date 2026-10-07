// Reads a Latk drawing (Lightning Artist Toolkit): a .latk file, which is a zip
// holding one JSON file, or that JSON on its own. In place of latk.js, which
// brings JSZip along and reads a global called latk while it parses.
//
// Returns the layers in the shape latk.js gives them, as far as the renderer
// uses it: { name, counter, frames: [{ strokes: [{ color, points: [{ co }] }] }] }.
// co is [x, y, z], y up, as latk.js leaves it by default.
export async function readLatk(buffer) {
  const bytes = new Uint8Array(buffer);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const text = isZip ? await unzipJson(bytes) : new TextDecoder().decode(bytes);
  return jsonToLayers(JSON.parse(text));
}

// Latk.jsonToGp(), keeping only what the renderer reads
function jsonToLayers(data) {
  if (!data || !Array.isArray(data.grease_pencil)) throw new Error('not a Latk drawing');
  const layers = [];
  for (const gp of data.grease_pencil) {
    for (const jsonLayer of gp.layers || []) {
      const frames = (jsonLayer.frames || []).map((jsonFrame) => ({
        strokes: (jsonFrame.strokes || []).map((s) => ({
          color: Array.isArray(s.color) ? s.color : [0, 0, 0, 1],
          points: (s.points || []).map((p) => ({ co: [p.co[0], p.co[1], p.co[2]] })),
        })),
      }));
      layers.push({ name: jsonLayer.name, counter: 0, frames });
    }
  }
  return layers;
}

// The first JSON file in a zip, found through the central directory, since a
// local header written with a data descriptor leaves its sizes at 0
async function unzipJson(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file');

  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  let entry = null;
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('damaged zip directory');
    const nameLength = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const e = {
      name,
      method: view.getUint16(at + 10, true),
      size: view.getUint32(at + 20, true),
      local: view.getUint32(at + 42, true),
    };
    if (!entry) entry = e;
    if (name.toLowerCase().endsWith('.json')) {
      entry = e;
      break;
    }
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  if (!entry) throw new Error('empty zip file');

  const start = entry.local + 30 + view.getUint16(entry.local + 26, true) + view.getUint16(entry.local + 28, true);
  const data = bytes.subarray(start, start + entry.size);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error(`unsupported zip compression (method ${entry.method})`);
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}
