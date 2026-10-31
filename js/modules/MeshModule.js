import { Module } from './Module.js';
import { registerModule } from '../moduleRegistry.js';
import { OrbitCamera } from './latk/OrbitCamera.js';
import { readGLTF } from './mesh/readGLTF.js';
import { meshVert, meshFrag } from '../shaders/mesh.js';

const MAX_DT = 0.1;          // clamp long stalls so a tab switch doesn't jump the spin
const ORBIT_RATE = 0.01;     // Latk's drag rate, radians per pixel
const ZOOM_RATE = 0.001;     // and its wheel: distance x exp(delta x ZOOM_RATE)
const DEFAULT_FILE = new URL('../../files/mesh/elephant_draco.glb', import.meta.url);

let nextGeometryId = 0;

// A glTF 2.0 model (.glb or .gltf), Draco-compressed or not, seen through an
// orbiting camera, as Latk sees its drawing. Each primitive is drawn in its
// vertex colours and its material's base colour and texture, lit from over the
// camera's shoulder.
export class MeshModule extends Module {
  static uid = '0e4e024b';

  constructor(glCanvas, id) {
    super('Mesh', glCanvas, id);
    this.outputs = [{ id: 'de5b', name: 'out', type: 'video' }];
    this.params = {
      yaw: { id: '7460', value: 0, min: -180, max: 180, step: 1, label: 'Yaw' },
      pitch: { id: '9618', value: OrbitCamera.HOME_PITCH * 180 / Math.PI, min: -89, max: 89, step: 1, label: 'Pitch' },
      // In radii of the model, so it fits whatever its size
      distance: {
        id: 'e311', value: OrbitCamera.HOME_DISTANCE, min: OrbitCamera.MIN_DISTANCE, max: OrbitCamera.MAX_DISTANCE, step: 0.01,
        label: 'Distance',
      },
      spin: { id: 'ea04', value: 0, min: -90, max: 90, step: 1, label: 'Spin' },
      light: { id: '9d5f', value: 1, min: 0, max: 1, step: 0.01, label: 'Light' },
    };

    this.meshShader = glCanvas.createShader(meshVert, meshFrag);
    // The model is geometry, so the output keeps p5's MSAA and depth (see Framebuffers in ARCHITECTURE.md)
    this.outputFBO = glCanvas.createFramebuffer();
    // Bound to uTexture for a primitive with no texture (see Set every sampler)
    this.white = this.createFramebuffer({ width: 1, height: 1, density: 1 });
    this.white.draw(() => glCanvas.background(255));

    this.cam = new OrbitCamera();
    this.parts = null;        // [{ geometry, baseColor, texture }] once a model is in
    this.fileName = '';       // shown on the load button
    this.loads = 0;           // so a slow load can't replace a later one
    this.spinYaw = 0;         // degrees turned by Spin, added to the Yaw knob
    this.dragX = null;        // last fullscreen drag position, null when not dragging
    this.dragY = null;
    this.lastTime = performance.now() / 1000;

    this._createFileInput();
    this._loadDefault();
  }

  _createFileInput() {
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    // A .gltf can name its buffers and images as files beside it, picked with it
    this.fileInput.accept = '.glb,.gltf,.bin,image/png,image/jpeg';
    this.fileInput.multiple = true;
    this.fileInput.style.display = 'none';
    document.body.appendChild(this.fileInput);
    this.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) this.loadFiles([...e.target.files]);
    });
  }

  pickFile() {
    this.fileInput.click();
  }

  async loadFiles(files) {
    const file = files.find((f) => /\.(glb|gltf)$/i.test(f.name));
    this.fileInput.value = '';   // so picking the same file again still fires 'change'
    if (!file) {
      alert('Pick a .glb or .gltf file');
      return;
    }
    const load = ++this.loads;
    try {
      const others = new Map();
      for (const f of files) if (f !== file) others.set(f.name, await f.arrayBuffer());
      const model = await readGLTF(await file.arrayBuffer(), others);
      if (load === this.loads) await this._setModel(model, file.name, load);
    } catch (e) {
      // Keep whatever model was loaded before
      alert(`Could not load ${file.name}: ${e.message}`);
    }
  }

  // node-gles3's Draco elephant, until a file is picked
  async _loadDefault() {
    const load = ++this.loads;
    try {
      const res = await fetch(DEFAULT_FILE);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const model = await readGLTF(await res.arrayBuffer());
      if (load === this.loads) await this._setModel(model, 'elephant_draco.glb', load);
    } catch (e) {
      console.error('Mesh: could not load elephant_draco.glb', e);
    }
  }

  async _setModel(model, fileName, load) {
    const textures = await Promise.all(model.primitives.map((prim) => this._loadTexture(prim.image)));
    if (load !== this.loads || this.disposed) {
      this._freeImages(textures);
      return;
    }
    this._freeModel();
    this.parts = model.primitives.map((prim, i) => ({
      geometry: buildGeometry(prim),
      baseColor: prim.baseColor,
      texture: textures[i],
    }));
    this.cam.fit(model.min, model.max);
    this.fileName = fileName;
  }

  // A texture as a p5.Image, or null if there is none or it won't decode
  async _loadTexture(image) {
    if (!image) return null;
    const url = URL.createObjectURL(new Blob([image.bytes], { type: image.mimeType }));
    try {
      return await new Promise((resolve, reject) => this.glCanvas._pInst.loadImage(url, resolve, reject));
    } catch (e) {
      console.warn('Mesh: a texture would not decode, so its primitive is drawn without it');
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // p5 keeps the GPU copy of every geometry and image it has drawn until told otherwise
  _freeModel() {
    if (!this.parts) return;
    for (const part of this.parts) this.glCanvas.freeGeometry(part.geometry);
    this._freeImages(this.parts.map((part) => part.texture));
    this.parts = null;
  }

  _freeImages(images) {
    const renderer = this.glCanvas._renderer;
    for (const img of images) {
      const tex = img && renderer.textures.get(img);
      if (!tex) continue;
      renderer.GL.deleteTexture(tex.glTex);
      renderer.textures.delete(img);
    }
  }

  process(graph, glCanvas) {
    const now = performance.now() / 1000;
    const dt = Math.min(Math.max(now - this.lastTime, 0), MAX_DT);
    this.lastTime = now;
    this.spinYaw = wrapDegrees(this.spinYaw + dt * this.params.spin.value);

    this.outputFBO.begin();
    glCanvas.background(0);
    if (this.parts) {
      const cam = this.cam;
      cam.yaw = wrapDegrees(this.params.yaw.value + this.spinYaw) * Math.PI / 180;
      cam.pitch = this.params.pitch.value * Math.PI / 180;
      cam.distance = this.params.distance.value * cam.radius;
      const eye = cam.getEye();

      glCanvas.noStroke();
      glCanvas.shader(this.meshShader);
      const s = this.meshShader;
      s.setUniform('uMVP', cam.getModelViewProjectionMatrix(glCanvas.width, glCanvas.height));
      s.setUniform('uEye', eye);
      s.setUniform('uLightDir', lightDirection(eye, cam.target));
      s.setUniform('uLight', this.params.light.value);
      for (const part of this.parts) {
        // p5 empties the samplers after every draw (see Set samplers again before every draw)
        s.setUniform('uTexture', part.texture || this.white);
        s.setUniform('uBaseColor', part.baseColor);
        glCanvas.model(part.geometry);
      }
    }
    this.outputFBO.end();
  }

  // ---------------------------------------------------------------- fullscreen

  // Dragging orbits, as in Latk, by turning the Yaw and Pitch knobs
  handleMouseDown(mx, my, canvasW, canvasH, button) {
    this.dragX = mx;
    this.dragY = my;
  }

  handleMouseDrag(mx, my, canvasW, canvasH) {
    if (this.dragX === null) return;
    const k = ORBIT_RATE * 180 / Math.PI;
    this.setParam('yaw', wrapDegrees(this.params.yaw.value - (mx - this.dragX) * k));
    this.setParam('pitch', this.params.pitch.value + (my - this.dragY) * k);
    this.dragX = mx;
    this.dragY = my;
  }

  handleMouseUp() {
    this.dragX = null;
    this.dragY = null;
  }

  // The wheel zooms by turning the Distance knob
  handleWheel(delta) {
    this.setParam('distance', this.params.distance.value * Math.exp(delta * ZOOM_RATE));
  }

  // A double-click goes back to the home view
  handleDoubleClick() {
    this.setParam('yaw', 0);
    this.setParam('pitch', OrbitCamera.HOME_PITCH * 180 / Math.PI);
    this.setParam('distance', OrbitCamera.HOME_DISTANCE);
    this.spinYaw = 0;
  }

  dispose() {
    this.disposed = true;
    this._freeModel();
    this.white.remove();
    if (this.fileInput) this.fileInput.remove();
    super.dispose();
  }
}

// One primitive as a p5.Geometry. Every vertex gets a colour and a uv, white
// and 0 where the file has none, so the shader's attributes are always fed.
function buildGeometry(prim) {
  const { positions, normals, colors, uvs, indices } = prim;
  const count = positions.length / 3;
  const geometry = new p5.Geometry(1, 1, function () {
    for (let i = 0; i < count; i++) {
      this.vertices.push(new p5.Vector(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]));
      this.vertexNormals.push(new p5.Vector(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]));
    }
    this.uvs = uvs ? Array.from(uvs) : new Array(count * 2).fill(0);
    this.vertexColors = colors ? Array.from(colors) : new Array(count * 4).fill(1);
    for (let i = 0; i < indices.length; i += 3) this.faces.push([indices[i], indices[i + 1], indices[i + 2]]);
  });
  // model() caches GPU buffers under a geometry's gid, and builds stroke
  // geometry for every edge unless it has one already (see Development Conventions)
  geometry.gid = `Mesh|${nextGeometryId++}`;
  geometry.edges = [[0, 1]];
  return geometry;
}

// The light sits over the camera's left shoulder, so the side facing the
// viewer is lit and the model still shows its shape
function lightDirection(eye, target) {
  const back = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const right = normalize([back[2], 0, -back[0]]);    // up x back
  const up = [
    back[1] * right[2] - back[2] * right[1],
    back[2] * right[0] - back[0] * right[2],
    back[0] * right[1] - back[1] * right[0],
  ];
  return normalize([0, 1, 2].map((i) => back[i] + 0.6 * up[i] - 0.4 * right[i]));
}

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function wrapDegrees(deg) {
  return ((deg + 180) % 360 + 360) % 360 - 180;
}

registerModule('Mesh', MeshModule);
