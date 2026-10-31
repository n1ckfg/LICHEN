// Reads a glTF 2.0 model (.glb, or .gltf with its buffers and images) into
// plain arrays, one entry a primitive, in place of three.js's GLTFLoader.
// Draco-compressed primitives (KHR_draco_mesh_compression) are decoded with
// Google's Draco decoder (js/libraries/draco/), copied from node-gles3, whose
// glutils.geomFromGLTF() this follows. Unlike geomFromGLTF(), it reads every
// primitive of every mesh in the scene, and puts each through its node's
// transform, so the model is in one space.
//
// Out: { primitives, min, max }, min and max being the model's bounding box.
// Each primitive is
//   { positions, normals, colors, uvs, indices, baseColor, image }
// positions and normals: Float32Array, 3 a vertex, in the scene's space
// colors: Float32Array, RGBA a vertex, linear, or null for none
// uvs: Float32Array, 2 a vertex (TEXCOORD_0), or null
// indices: Uint32Array, 3 a triangle
// baseColor: the material's baseColorFactor, linear RGBA
// image: its baseColorTexture as { bytes, mimeType }, or null
//
// Only triangles are read (modes 4, 5 and 6); points and lines are skipped.
// Skins, morph targets and animations are ignored, so a skinned mesh is drawn
// in its bind pose.

const GLB_MAGIC = 0x46546c67;   // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const COMPONENT_ARRAYS = {
  5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
  5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
};
// What a normalized integer is divided by, and the least it can be (glTF 3.11)
const NORMALIZE = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535, 5125: 4294967295 };

const DRACO_WASM = new URL('../../libraries/draco/draco_decoder.wasm', import.meta.url);

// files: a Map of file name -> ArrayBuffer for the external buffers and images
// a .gltf names, if it names any
export async function readGLTF(arrayBuffer, files = new Map()) {
  const { gltf, bin } = splitGLB(arrayBuffer);
  if (!gltf.asset || !String(gltf.asset.version).startsWith('2')) {
    throw new Error('not a glTF 2.0 file');
  }
  const required = (gltf.extensionsRequired || []).filter((e) => e !== 'KHR_draco_mesh_compression' &&
    e !== 'KHR_mesh_quantization' && e !== 'KHR_materials_unlit' && e !== 'KHR_texture_transform');
  if (required.length) throw new Error(`needs ${required.join(', ')}`);

  const buffers = (gltf.buffers || []).map((b, i) => resolveBuffer(b, i, bin, files));
  const viewBytes = (index) => {
    const bv = gltf.bufferViews[index];
    const buffer = buffers[bv.buffer];
    return new Uint8Array(buffer.buffer, buffer.byteOffset + (bv.byteOffset || 0), bv.byteLength);
  };

  const usesDraco = (gltf.meshes || []).some((m) => m.primitives.some((p) => p.extensions?.KHR_draco_mesh_compression));
  const draco = usesDraco ? (await loadDraco()).draco : null;

  const primitives = [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const addMesh = (meshIndex, matrix) => {
    for (const prim of gltf.meshes[meshIndex].primitives) {
      const mode = prim.mode ?? 4;
      if (mode < 4) continue;
      const data = prim.extensions?.KHR_draco_mesh_compression
        ? decodeDracoPrimitive(draco, gltf, prim, viewBytes)
        : readPrimitive(gltf, prim, viewBytes);
      data.indices = triangles(data.indices, data.positions.length / 3, mode);
      if (!data.normals) data.normals = smoothNormals(data.positions, data.indices);
      transform(data, matrix);
      for (let i = 0; i < data.positions.length; i += 3) {
        for (let c = 0; c < 3; c++) {
          const v = data.positions[i + c];
          if (v < min[c]) min[c] = v;
          if (v > max[c]) max[c] = v;
        }
      }
      primitives.push({ ...data, ...readMaterial(gltf, prim.material, viewBytes, files) });
    }
  };

  // Walk the scene's nodes, or with no scene, draw every mesh where it is
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  if (scene) {
    const visit = (nodeIndex, parent) => {
      const node = gltf.nodes[nodeIndex];
      const matrix = multiply(parent, nodeMatrix(node));
      // A skinned mesh ignores its node's transform: its joints place it
      if (node.mesh !== undefined) addMesh(node.mesh, node.skin !== undefined ? IDENTITY : matrix);
      for (const child of node.children || []) visit(child, matrix);
    };
    for (const n of scene.nodes || []) visit(n, IDENTITY);
  } else {
    (gltf.meshes || []).forEach((_, i) => addMesh(i, IDENTITY));
  }

  if (primitives.length === 0) throw new Error('no triangles in it');
  return { primitives, min, max };
}

// A .glb's JSON and binary chunks, or a .gltf's JSON
function splitGLB(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (arrayBuffer.byteLength >= 12 && view.getUint32(0, true) === GLB_MAGIC) {
    let gltf = null, bin = null;
    const length = Math.min(view.getUint32(8, true), arrayBuffer.byteLength);
    for (let offset = 12; offset + 8 <= length;) {
      const chunkLength = view.getUint32(offset, true);
      const chunkType = view.getUint32(offset + 4, true);
      const bytes = new Uint8Array(arrayBuffer, offset + 8, chunkLength);
      if (chunkType === CHUNK_JSON) gltf = JSON.parse(new TextDecoder().decode(bytes));
      else if (chunkType === CHUNK_BIN && !bin) bin = bytes;
      offset += 8 + chunkLength;
    }
    if (!gltf) throw new Error('no JSON chunk');
    return { gltf, bin };
  }
  return { gltf: JSON.parse(new TextDecoder().decode(arrayBuffer)), bin: null };
}

// A buffer's bytes: the .glb's own chunk, a data: URI, or a file picked with the .gltf
function resolveBuffer(buffer, index, bin, files) {
  if (buffer.uri === undefined) {
    if (index === 0 && bin) return bin;
    throw new Error(`buffer ${index} has no data`);
  }
  return new Uint8Array(resolveURI(buffer.uri, files));
}

function resolveURI(uri, files) {
  if (uri.startsWith('data:')) {
    const comma = uri.indexOf(',');
    const binary = atob(uri.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
  const name = decodeURIComponent(uri).split('/').pop();
  const file = files.get(name);
  if (!file) throw new Error(`it needs ${name}: pick it with the .gltf`);
  return file;
}

// An accessor as floats (normalized integers scaled to -1..1 or 0..1), or as
// integers for indices
function readAccessor(gltf, index, viewBytes, asFloat = true) {
  const accessor = gltf.accessors[index];
  const n = TYPE_COMPONENTS[accessor.type];
  const Array_ = COMPONENT_ARRAYS[accessor.componentType];
  const out = asFloat ? new Float32Array(accessor.count * n) : new Uint32Array(accessor.count * n);
  if (accessor.bufferView === undefined) return out;   // all zeros, as with no sparse values

  const bv = gltf.bufferViews[accessor.bufferView];
  const bytes = viewBytes(accessor.bufferView);
  const size = Array_.BYTES_PER_ELEMENT;
  const stride = bv.byteStride || n * size;
  const offset = accessor.byteOffset || 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const get = {
    5120: (o) => view.getInt8(o), 5121: (o) => view.getUint8(o),
    5122: (o) => view.getInt16(o, true), 5123: (o) => view.getUint16(o, true),
    5125: (o) => view.getUint32(o, true), 5126: (o) => view.getFloat32(o, true),
  }[accessor.componentType];
  const div = asFloat && accessor.normalized ? NORMALIZE[accessor.componentType] : 1;
  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < n; c++) {
      const v = get(offset + i * stride + c * size);
      out[i * n + c] = div === 1 ? v : Math.max(v / div, -1);
    }
  }
  return out;
}

function readPrimitive(gltf, prim, viewBytes) {
  const a = prim.attributes;
  const positions = readAccessor(gltf, a.POSITION, viewBytes);
  const count = positions.length / 3;
  return {
    positions,
    normals: a.NORMAL !== undefined ? readAccessor(gltf, a.NORMAL, viewBytes) : null,
    colors: a.COLOR_0 !== undefined ? toRGBA(readAccessor(gltf, a.COLOR_0, viewBytes), count) : null,
    uvs: a.TEXCOORD_0 !== undefined ? readAccessor(gltf, a.TEXCOORD_0, viewBytes) : null,
    indices: prim.indices !== undefined ? readAccessor(gltf, prim.indices, viewBytes, false) : null,
  };
}

// ------------------------------------------------------------------ Draco

let dracoPromise = null;

// The decoder's wasm is compiled once, the first time a Draco file is read,
// and the promise gives { draco }, the decoder module.
// It is compiled asynchronously: Chrome won't compile wasm over 4 KB
// synchronously on the main thread, as node-gles3 does.
function loadDraco() {
  if (!dracoPromise) {
    dracoPromise = (async () => {
      await import('../../libraries/draco/draco_wasm_wrapper.js');   // a classic script: it puts DracoDecoderModule on the global scope
      const res = await fetch(DRACO_WASM);
      if (!res.ok) throw new Error(`could not fetch the Draco decoder (HTTP ${res.status})`);
      const wasmBinary = await res.arrayBuffer();
      // The module has a then() of its own, which calls back with the module
      // again, so a promise resolved with it never settles: it travels in a box
      return new Promise((resolve) => {
        globalThis.DracoDecoderModule({ wasmBinary, onModuleLoaded: (draco) => resolve({ draco }) });
      });
    })();
    dracoPromise.catch(() => { dracoPromise = null; });   // so a later file can try again
  }
  return dracoPromise;
}

// As three.js's DRACOLoader, each attribute is decoded as its accessor's
// component type, then normalized if the accessor says so
function decodeDracoPrimitive(draco, gltf, prim, viewBytes) {
  const ext = prim.extensions.KHR_draco_mesh_compression;
  const bytes = viewBytes(ext.bufferView);
  const decoder = new draco.Decoder();
  const buffer = new draco.DecoderBuffer();
  const mesh = new draco.Mesh();
  try {
    buffer.Init(new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), bytes.byteLength);
    const status = decoder.DecodeBufferToMesh(buffer, mesh);
    if (!status.ok() || mesh.ptr === 0) throw new Error(`Draco: ${status.error_msg()}`);

    const numPoints = mesh.num_points();
    const attribute = (name) => {
      const id = ext.attributes[name];
      if (id === undefined) return null;
      const accessor = gltf.accessors[prim.attributes[name]];
      const Array_ = COMPONENT_ARRAYS[accessor?.componentType] || Float32Array;
      const attr = decoder.GetAttributeByUniqueId(mesh, id);
      const n = attr.num_components();
      const length = numPoints * n;
      const byteLength = length * Array_.BYTES_PER_ELEMENT;
      const ptr = draco._malloc(byteLength);
      try {
        decoder.GetAttributeDataArrayForAllPoints(mesh, attr, dracoType(draco, Array_), byteLength, ptr);
        const raw = new Array_(draco.HEAPF32.buffer, ptr, length);
        const div = accessor?.normalized ? NORMALIZE[accessor.componentType] : 1;
        const out = new Float32Array(length);
        for (let i = 0; i < length; i++) out[i] = div === 1 ? raw[i] : Math.max(raw[i] / div, -1);
        return { values: out, n };
      } finally {
        draco._free(ptr);
      }
    };

    const color = attribute('COLOR_0');
    const indexCount = mesh.num_faces() * 3;
    const ptr = draco._malloc(indexCount * 4);
    let indices;
    try {
      decoder.GetTrianglesUInt32Array(mesh, indexCount * 4, ptr);
      indices = new Uint32Array(draco.HEAPU32.buffer, ptr, indexCount).slice();
    } finally {
      draco._free(ptr);
    }
    return {
      positions: attribute('POSITION').values,
      normals: attribute('NORMAL')?.values || null,
      colors: color ? toRGBA(color.values, numPoints) : null,
      uvs: attribute('TEXCOORD_0')?.values || null,
      indices,
    };
  } finally {
    draco.destroy(mesh);
    draco.destroy(buffer);
    draco.destroy(decoder);
  }
}

function dracoType(draco, Array_) {
  switch (Array_) {
    case Int8Array: return draco.DT_INT8;
    case Uint8Array: return draco.DT_UINT8;
    case Int16Array: return draco.DT_INT16;
    case Uint16Array: return draco.DT_UINT16;
    case Uint32Array: return draco.DT_UINT32;
    default: return draco.DT_FLOAT32;
  }
}

// ------------------------------------------------------------------ geometry

function toRGBA(colors, count) {
  if (colors.length === count * 4) return colors;
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    out[i * 4] = colors[i * 3];
    out[i * 4 + 1] = colors[i * 3 + 1];
    out[i * 4 + 2] = colors[i * 3 + 2];
    out[i * 4 + 3] = 1;
  }
  return out;
}

// Indices as a triangle list, from a list, strip or fan, indexed or not
function triangles(indices, count, mode) {
  const index = indices || Uint32Array.from({ length: count }, (_, i) => i);
  if (mode === 4) return index.length % 3 ? index.slice(0, index.length - index.length % 3) : index;
  const out = [];
  for (let i = 2; i < index.length; i++) {
    if (mode === 5) {
      // A strip flips every other triangle to keep its winding
      if (i % 2) out.push(index[i - 1], index[i - 2], index[i]);
      else out.push(index[i - 2], index[i - 1], index[i]);
    } else {
      out.push(index[0], index[i - 1], index[i]);
    }
  }
  return Uint32Array.from(out);
}

// A primitive with no normals gets each vertex's faces' normals, weighted by area
function smoothNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) {
      normals[k] += nx;
      normals[k + 1] += ny;
      normals[k + 2] += nz;
    }
  }
  return normals;
}

// Puts positions through the node's matrix and normals through its inverse
// transpose, and leaves the normals unit length
function transform(data, m) {
  const p = data.positions, nrm = data.normals;
  const identity = m === IDENTITY;
  // The inverse transpose of the upper 3x3 is its cofactor matrix, up to scale
  const c = [
    m[5] * m[10] - m[6] * m[9], m[6] * m[8] - m[4] * m[10], m[4] * m[9] - m[5] * m[8],
    m[9] * m[2] - m[10] * m[1], m[10] * m[0] - m[8] * m[2], m[8] * m[1] - m[9] * m[0],
    m[1] * m[6] - m[2] * m[5], m[2] * m[4] - m[0] * m[6], m[0] * m[5] - m[1] * m[4],
  ];
  for (let i = 0; i < p.length; i += 3) {
    let x = p[i], y = p[i + 1], z = p[i + 2];
    if (!identity) {
      p[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
      p[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      p[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
    x = nrm[i]; y = nrm[i + 1]; z = nrm[i + 2];
    if (!identity) {
      const tx = c[0] * x + c[3] * y + c[6] * z;
      const ty = c[1] * x + c[4] * y + c[7] * z;
      const tz = c[2] * x + c[5] * y + c[8] * z;
      x = tx; y = ty; z = tz;
    }
    const l = Math.hypot(x, y, z) || 1;
    nrm[i] = x / l;
    nrm[i + 1] = y / l;
    nrm[i + 2] = z / l;
  }
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// A node's local matrix, column-major, from matrix or translation/rotation/scale
function nodeMatrix(node) {
  if (node.matrix) return node.matrix;
  if (!node.translation && !node.rotation && !node.scale) return IDENTITY;
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function multiply(a, b) {
  if (a === IDENTITY) return b;
  if (b === IDENTITY) return a;
  const out = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

// ------------------------------------------------------------------ material

// The base colour factor and texture, the only parts of the material drawn
function readMaterial(gltf, index, viewBytes, files) {
  const pbr = gltf.materials?.[index]?.pbrMetallicRoughness || {};
  const baseColor = pbr.baseColorFactor || [1, 1, 1, 1];
  let image = null;
  const texture = gltf.textures?.[pbr.baseColorTexture?.index];
  const source = gltf.images?.[texture?.source];
  if (source && (pbr.baseColorTexture.texCoord || 0) === 0) {
    if (source.bufferView !== undefined) {
      image = { bytes: viewBytes(source.bufferView), mimeType: source.mimeType };
    } else if (source.uri) {
      try {
        const bytes = new Uint8Array(resolveURI(source.uri, files));
        const guess = source.uri.startsWith('data:') ? source.uri.slice(5, source.uri.search(/[;,]/))
          : source.uri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
        image = { bytes, mimeType: source.mimeType || guess };
      } catch (e) {
        console.warn(`Mesh: no texture, since ${e.message}`);
      }
    }
  }
  return { baseColor, image };
}
