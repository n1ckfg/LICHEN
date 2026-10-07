import { Module } from './Module.js';
import { registerModule } from '../moduleRegistry.js';
import { OrbitCamera } from './latk/OrbitCamera.js';
import { readLatk } from './latk/readLatk.js';
import { projectFrame, PointStream } from './latk/strokes.js';
import { latkSegmentVert, latkLineFrag, LATK_BATCH } from '../shaders/latk.js';

const MAX_DT = 0.1;          // clamp long stalls so a tab switch doesn't jump the clocks
const POINT_TEX_W = 2048;    // point stream texels per row
const ORBIT_RATE = 0.01;     // example-latk's drag rate, radians per pixel
const ZOOM_RATE = 0.001;     // and its wheel: distance x exp(delta x ZOOM_RATE)
const DEFAULT_FILE = new URL('../../files/latk/jellyfish.latk', import.meta.url);

let nextGeometryId = 0;

// A Latk drawing (Lightning Artist Toolkit), played back and drawn as lines in
// its strokes' colours, seen through an orbiting camera. This is the player
// from Twoscilloscope's example-latk without the oscilloscope:
// TwoscilloscopeModule extends it with the audio round trip.
export class LatkModule extends Module {
  constructor(glCanvas, id, type = 'Latk') {
    super(type, glCanvas, id);
    this.outputs = [{ name: 'out', type: 'video' }];
    this.historicalInfo = 'Latk';
    this.params = {
      fps: { value: 12, min: 0, max: 60, step: 1, label: 'FPS' },   // ofxLatk's 12 frames a second
      yaw: { value: 0, min: -180, max: 180, step: 1, label: 'Yaw' },
      pitch: { value: OrbitCamera.HOME_PITCH * 180 / Math.PI, min: -89, max: 89, step: 1, label: 'Pitch' },
      // In radii of the drawing, so it fits whatever its size
      distance: {
        value: OrbitCamera.HOME_DISTANCE, min: OrbitCamera.MIN_DISTANCE, max: OrbitCamera.MAX_DISTANCE, step: 0.01,
        label: 'Distance',
      },
      spin: { value: 0, min: -90, max: 90, step: 1, label: 'Spin' },
      width: { value: 2, min: 0.5, max: 10, step: 0.1, label: 'Width' },   // example-latk's strokeWeight
    };

    this.lineShader = glCanvas.createShader(latkSegmentVert, latkLineFrag);
    this.geometry = this._buildGeometry();
    this.createOutputFBO();
    // The point stream, one point per texel. Float, since it holds positions and
    // 24-bit colours, and sized up on demand.
    this.pointFBO = glCanvas.createFramebuffer({
      width: POINT_TEX_W, height: 8, density: 1, depth: false,
      format: glCanvas.FLOAT, textureFiltering: glCanvas.NEAREST,
    });
    this.warnedNoFloat = false;
    this.stream = new PointStream();

    this.cam = new OrbitCamera();
    this.latk = null;         // { layers } once a drawing is in
    this.fileName = '';       // shown on the load button
    this.frameClock = 0;      // Latk frames still to advance
    this.spinYaw = 0;         // degrees turned by Spin, added to the Yaw knob
    this.dragX = null;        // last fullscreen drag position, null when not dragging
    this.dragY = null;
    this.lastTime = performance.now() / 1000;

    this._createFileInput();
    this._loadDefault();
  }

  // One quad per segment in a batch. The vertex shader places every quad, so
  // this is built once and never re-uploaded.
  _buildGeometry() {
    const geometry = new p5.Geometry(1, 1, function () {
      for (let q = 0; q < LATK_BATCH; q++) {
        const base = this.vertices.length;
        this.vertices.push(
          new p5.Vector(-1, -1, q), new p5.Vector(1, -1, q),
          new p5.Vector(1, 1, q), new p5.Vector(-1, 1, q));
        this.faces.push([base, base + 1, base + 2], [base, base + 2, base + 3]);
      }
    });
    // p5 caches a geometry's GPU buffers under its gid (see Development Conventions)
    geometry.gid = `${this.type}|${nextGeometryId++}`;
    return geometry;
  }

  _createFileInput() {
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.latk,.json';
    this.fileInput.style.display = 'none';
    document.body.appendChild(this.fileInput);
    this.fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.loadFile(file);
    });
  }

  pickFile() {
    this.fileInput.click();
  }

  async loadFile(file) {
    try {
      this._setDrawing(await readLatk(await file.arrayBuffer()), file.name);
    } catch (e) {
      // Keep whatever drawing was loaded before
      alert(`Could not load ${file.name}: ${e.message}`);
    }
    this.fileInput.value = '';   // so picking the same file again still fires 'change'
  }

  // example-latk's jellyfish, until a file is picked
  async _loadDefault() {
    try {
      const res = await fetch(DEFAULT_FILE);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const layers = await readLatk(await res.arrayBuffer());
      if (!this.latk) this._setDrawing(layers, 'jellyfish.latk');
    } catch (e) {
      console.error(`${this.type}: could not load jellyfish.latk`, e);
    }
  }

  // The camera looks at the whole drawing, every frame of it, as example-latk's
  // frameDrawing() did
  _setDrawing(layers, fileName) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const layer of layers) {
      for (const frame of layer.frames) {
        for (const stroke of frame.strokes) {
          for (const p of stroke.points) {
            for (let i = 0; i < 3; i++) {
              min[i] = Math.min(min[i], p.co[i]);
              max[i] = Math.max(max[i], p.co[i]);
            }
          }
        }
      }
    }
    if (min[0] <= max[0]) this.cam.fit(min, max);
    this.latk = { layers };
    this.fileName = fileName;
    this.frameClock = 0;
  }

  process(graph, glCanvas) {
    const now = performance.now() / 1000;
    const dt = Math.min(Math.max(now - this.lastTime, 0), MAX_DT);
    this.lastTime = now;
    this.spinYaw = wrapDegrees(this.spinYaw + dt * this.params.spin.value);

    this.outputFBO.begin();
    glCanvas.background(0);
    if (this.latk) {
      // ofxLatk's playback clock, accumulated so turning FPS doesn't jump it
      this.frameClock += dt * Math.max(0, this.params.fps.value);
      const steps = Math.floor(this.frameClock);
      this.frameClock -= steps;
      for (const layer of this.latk.layers) {
        if (layer.frames.length > 0) layer.counter = (layer.counter + steps) % layer.frames.length;
      }

      const cam = this.cam;
      cam.yaw = wrapDegrees(this.params.yaw.value + this.spinYaw) * Math.PI / 180;
      cam.pitch = this.params.pitch.value * Math.PI / 180;
      cam.distance = this.params.distance.value * cam.radius;

      this.drawFrame(glCanvas);
    }
    this.outputFBO.end();
  }

  // The current frame of each layer through the camera, into outputFBO
  drawFrame(glCanvas) {
    const w = glCanvas.width, h = glCanvas.height;
    const pieces = projectFrame(this.latk, this.cam.getModelViewProjectionMatrix(w, h), w, h);
    this.stream.addPieces(pieces, w, h);
    this.drawLines(glCanvas, this.stream, this.params.width.value);
  }

  // A point stream's segments as lines width output pixels wide, round-ended
  drawLines(glCanvas, stream, width) {
    const pxToScope = 2 / glCanvas.height;   // one output pixel, in scope units
    const halfWidth = width / 2 * pxToScope;
    const feather = pxToScope / this.pixelDensity;
    this.drawSegments(glCanvas, this.lineShader, stream, glCanvas.BLEND, (s) => {
      s.setUniform('uSize', halfWidth + feather);
      s.setUniform('uHalfWidth', halfWidth);
      s.setUniform('uFeather', feather);
    });
  }

  // Every segment of a point stream through shader s, which uses latkSegmentVert.
  // setUniforms sets the uniforms of s's own.
  drawSegments(glCanvas, s, stream, blend, setUniforms) {
    const n = stream.count;
    if (n < 2 || !this._upload(glCanvas, stream.data, n)) return;

    glCanvas.noStroke();
    glCanvas.shader(s);
    s.setUniform('uTexSize', [this.pointFBO.width, this.pointFBO.height]);
    s.setUniform('uLast', n - 1);
    s.setUniform('uAspect', glCanvas.width / glCanvas.height);
    setUniforms(s);
    glCanvas.blendMode(blend);
    for (let base = 0; base < n - 1; base += LATK_BATCH) {
      // p5 points every sampler at an empty texture after each draw, so this
      // has to be set again for every batch
      s.setUniform('uPoints', this.pointFBO);
      s.setUniform('uBase', base);
      glCanvas.model(this.geometry);
    }
    glCanvas.blendMode(glCanvas.BLEND);
  }

  // p5 has no way to fill a texture from an array, so this writes straight into
  // pointFBO's colour texture, putting back the binding and unpack state it
  // touches, as SlowscanJam does
  _upload(glCanvas, data, n) {
    const fbo = this.pointFBO;
    // Without float textures p5 falls back to 8 bits, which can't hold the stream
    if (fbo.format === glCanvas.UNSIGNED_BYTE) {
      if (!this.warnedNoFloat) console.warn(`${this.type}: this browser has no float framebuffers`);
      this.warnedNoFloat = true;
      return false;
    }
    const rows = Math.ceil(n / POINT_TEX_W);
    if (rows > fbo.height) fbo.resize(POINT_TEX_W, 1 << Math.ceil(Math.log2(rows)));

    const gl = glCanvas.drawingContext;
    const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const prevFlip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    const prevPremul = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, fbo.colorTexture);
    const full = Math.floor(n / POINT_TEX_W);
    const rest = n - full * POINT_TEX_W;
    if (full > 0) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, POINT_TEX_W, full, gl.RGBA, gl.FLOAT,
        data.subarray(0, full * POINT_TEX_W * 4));
    }
    if (rest > 0) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, full, rest, 1, gl.RGBA, gl.FLOAT,
        data.subarray(full * POINT_TEX_W * 4, n * 4));
    }
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlip);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, prevPremul);
    return true;
  }

  // ---------------------------------------------------------------- fullscreen

  // Dragging orbits, as example-latk's camera did, by turning the Yaw and Pitch knobs
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

  // A double-click goes back to the start, as example-latk's did
  handleDoubleClick() {
    this.setParam('yaw', 0);
    this.setParam('pitch', OrbitCamera.HOME_PITCH * 180 / Math.PI);
    this.setParam('distance', OrbitCamera.HOME_DISTANCE);
    this.spinYaw = 0;
  }

  dispose() {
    if (this.geometry) this.glCanvas.freeGeometry(this.geometry);
    if (this.pointFBO) this.pointFBO.remove();
    if (this.fileInput) this.fileInput.remove();
    this.geometry = null;
    this.pointFBO = null;
    super.dispose();
  }
}

function wrapDegrees(deg) {
  return ((deg + 180) % 360 + 360) % 360 - 180;
}

registerModule('Latk', LatkModule);
