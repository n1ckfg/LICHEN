import { Module } from './Module.js';
import { vertSrc } from '../shaders/vert.js';
import {
  panoramaEquirectFrag, panoramaCubemapFrag, panoramaDepthVert, panoramaDepthFrag,
} from '../shaders/panorama.js';
import { registerModule } from '../moduleRegistry.js';

const MAX_DT = 0.1;   // clamp long stalls so a tab switch doesn't jump the spin

const PROJECTIONS = ['Equirectangular', 'Cubemap'];
const CUBEMAP = 1;

// QTVR's drag, after the three.js OrbitControls of the viewer it was ported
// from (rotateSpeed -0.25, enableDamping): a drag of the canvas height turns
// the view by 2π × 0.25, and the turn still to apply eases in at 5% a frame
const ROTATE_SPEED = 0.25;
const DAMPING_FACTOR = 0.05;
const ZOOM_PER_WHEEL = 1.001;   // FOV factor per unit of wheel delta
const MAX_PITCH = 90 - 1e-4;    // degrees; looking straight up or down flips the camera

// With d cabled, the points the panorama is drawn as. The equirectangular
// sphere has threejs_depth_eqr's 512 x 256 segments, a point at the middle of
// each, and the cube about as many points in all
const SPHERE_COLS = 512;
const SPHERE_ROWS = 256;
const CUBE_FACE_POINTS = 148;   // across each face, 6 x 148^2 = 131,424
// Each face's corners in the strip's top-left, top-right and bottom-left, from
// QTVR's SKYBOX_FACES, as panoramaCubemapFrag has them
const CUBE_CORNERS = [
  [[ 1, -1, -1], [ 1, -1,  1], [ 1,  1, -1]],   // px
  [[-1, -1,  1], [-1, -1, -1], [-1,  1,  1]],   // nx
  [[-1, -1,  1], [ 1, -1,  1], [-1, -1, -1]],   // py
  [[-1,  1, -1], [ 1,  1, -1], [-1,  1,  1]],   // ny
  [[-1, -1, -1], [ 1, -1, -1], [-1,  1, -1]],   // pz
  [[ 1, -1,  1], [-1, -1,  1], [ 1,  1,  1]],   // nz
];
const QUAD_CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

// threejs_depth_eqr's WASD: Q and E fly down and up. The speed builds by
// 0.002 world units a frame while a key is held, to 0.04, and falls back the
// same way, counted in 60ths of a second here so it is the same at any rate
const KEY_SPEED_MAX = 0.04;
const KEY_ACCEL = 0.002;
const MOVE_KEYS = ['w', 'a', 's', 'd', 'q', 'e'];

let nextGeometryId = 0;

// Views its input as a panorama from the centre, as QTVR views a file: an
// equirectangular image (2:1) on a sphere, or a cubemap (a horizontal strip of
// six faces, px, nx, py, ny, pz, nz) on a cube. Each projection is a shader of
// its own that casts a ray per pixel. In fullscreen, a drag turns the Yaw and
// Pitch knobs and the wheel turns FOV.
// With d cabled, a depth map in the same projection as the input, the
// panorama is a cloud of points at the distances d gives, after
// KINECT/threejs_depth_eqr, seen from X, Y and Z. In fullscreen, W, A, S, D,
// Q and E move the viewpoint by turning those knobs.
export class PanoramaModule extends Module {
  static uid = '75258cea';

  constructor(glCanvas, id) {
    super('Panorama', glCanvas, id);
    this.inputs = [
      { id: '1c36', name: 'in', type: 'video' },
      { id: 'f850', name: 'd', type: 'video' },
    ];
    this.outputs = [{ id: 'd12f', name: 'out', type: 'video' }];
    this.params = {
      projection: {
        id: '5677', value: 0, min: 0, max: PROJECTIONS.length - 1, step: 1, label: 'Projection', widget: 'dropdown',
        valueLabels: PROJECTIONS,
      },
      yaw:   { id: '512a', value: 0, min: -180, max: 180, step: 1, label: 'Yaw' },
      pitch: { id: '44ab', value: 0, min: -90, max: 90, step: 1, label: 'Pitch' },
      fov:   { id: '1bc2', value: 75, min: 20, max: 120, step: 1, label: 'FOV' },
      spin:  { id: '61fe', value: 0, min: -90, max: 90, step: 1, label: 'Spin' },
      // With d cabled: threejs_depth_eqr's Displacement, its point size and alpha
      depth:     { id: '9c65', value: 20, min: 0, max: 100, step: 0.5, label: 'Depth' },
      pointSize: { id: '3db4', value: 4, min: 1, max: 30, step: 0.5, label: 'Point Size' },
      opacity:   { id: 'dbed', value: 0.3, min: 0, max: 1, step: 0.05, label: 'Opacity' },
      // and the viewpoint, in world units: +X right, +Y up and -Z ahead at Yaw 0
      x: { id: '764b', value: 0, min: -20, max: 20, step: 0.1, label: 'X' },
      y: { id: 'f54d', value: 0, min: -20, max: 20, step: 0.1, label: 'Y' },
      z: { id: '3469', value: 0, min: -20, max: 20, step: 0.1, label: 'Z' },
    };
    this.shaders = [
      glCanvas.createShader(vertSrc, panoramaEquirectFrag),
      glCanvas.createShader(vertSrc, panoramaCubemapFrag),
    ];
    // [equirectangular, cubemap], and their points, built when first drawn
    this.depthShaders = [false, true].map((cubemap) =>
      glCanvas.createShader(panoramaDepthVert(cubemap), panoramaDepthFrag));
    this.clouds = [null, null];
    // The points are tested against depth, so the output has a depth buffer.
    // The ray-cast quad passes the test wherever it draws
    this.outputFBO = this.createFramebuffer({ depth: true });
    this.spinYaw = 0;       // degrees turned by Spin, added to the Yaw knob
    this.yawDelta = 0;      // fullscreen drag still to apply, in degrees
    this.pitchDelta = 0;
    this.dragX = null;      // last fullscreen drag position, null when not dragging
    this.dragY = null;
    this.keysHeld = new Set();  // fullscreen movement keys held down
    this.keySpeed = 0;          // world units a 60th of a second
    // A key let go in another window never comes up here
    this.onBlur = () => this.releaseKeys();
    window.addEventListener('blur', this.onBlur);
    this.lastTime = performance.now() / 1000;
  }

  process(graph, glCanvas) {
    const now = performance.now() / 1000;
    const dt = Math.min(now - this.lastTime, MAX_DT);
    this.lastTime = now;
    this.spinYaw = wrapDegrees(this.spinYaw + dt * this.params.spin.value);
    this._applyDrag();

    const yaw = (this.params.yaw.value + this.spinYaw) * Math.PI / 180;
    const pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.params.pitch.value)) * Math.PI / 180;
    this._applyKeys(dt, yaw, pitch);

    const input = this.getInput(graph, 0);
    if (!input) return;

    // A cable on Projection rounds to an option, as the menu's box does
    const cubemap = Math.round(this.params.projection.value) === CUBEMAP;
    const fov = this.params.fov.value * Math.PI / 180;
    const depth = this.getInput(graph, 1);
    if (depth) {
      this._drawCloud(input, depth, cubemap, yaw, pitch, fov, glCanvas);
      return;
    }

    const shader = this.shaders[cubemap ? 1 : 0];
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(shader);
    shader.setUniform('tex0', input);
    shader.setUniform('uTexSize', [input.width * input.density, input.height * input.density]);
    shader.setUniform('uYaw', yaw);
    shader.setUniform('uPitch', pitch);
    shader.setUniform('uTanHalf', Math.tan(fov / 2));
    shader.setUniform('uAspect', glCanvas.width / glCanvas.height);
    this.renderQuad();
    this.outputFBO.end();
  }

  // The points, each displaced along its ray by d, seen from X, Y and Z
  _drawCloud(input, depth, cubemap, yaw, pitch, fov, glCanvas) {
    const shader = this.depthShaders[+cubemap];
    if (!this.clouds[+cubemap]) this.clouds[+cubemap] = cubemap ? cubeCloud() : sphereCloud();
    const size = this.params.pointSize.value;

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.background(0);
    glCanvas.noStroke();
    glCanvas.blendMode(glCanvas.BLEND);
    glCanvas.shader(shader);
    shader.setUniform('tex0', input);
    shader.setUniform('uDepthTex', depth);
    if (cubemap) {
      shader.setUniform('uTexSize', [input.width * input.density, input.height * input.density]);
      shader.setUniform('uDepthSize', [depth.width * depth.density, depth.height * depth.density]);
    }
    shader.setUniform('uEye', this._eye());
    shader.setUniform('uYaw', yaw);
    shader.setUniform('uPitch', pitch);
    shader.setUniform('uTanHalf', Math.tan(fov / 2));
    shader.setUniform('uAspect', glCanvas.width / glCanvas.height);
    shader.setUniform('uDepth', this.params.depth.value);
    shader.setUniform('uPointScale', [size / glCanvas.width, size / glCanvas.height]);
    shader.setUniform('uOpacity', this.params.opacity.value);
    glCanvas.model(this.clouds[+cubemap]);
    this.outputFBO.end();
  }

  // X, Y and Z in p5's world, whose y runs down
  _eye() {
    return [this.params.x.value, -this.params.y.value, this.params.z.value];
  }

  // threejs_depth_eqr's WASD, through the X, Y and Z knobs: W and S move along
  // the view, A and D across it, and E and Q up and down the screen
  _applyKeys(dt, yaw, pitch) {
    const held = (k) => (this.keysHeld.has(k) ? 1 : 0);
    const steps = dt * 60;
    if (MOVE_KEYS.some((k) => this.keysHeld.has(k))) {
      this.keySpeed = Math.min(this.keySpeed + KEY_ACCEL * steps, KEY_SPEED_MAX);
    } else {
      this.keySpeed = Math.max(this.keySpeed - KEY_ACCEL * steps, 0);
      return;
    }
    // The shaders' camera basis: ahead, right, and up the screen
    const cp = Math.cos(pitch);
    const f = [Math.sin(yaw) * cp, -Math.sin(pitch), -Math.cos(yaw) * cp];
    const r = [Math.cos(yaw), 0, Math.sin(yaw)];
    const up = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
    const ahead = held('w') - held('s');
    const right = held('d') - held('a');
    const rise = held('e') - held('q');
    const step = this.keySpeed * steps;
    const move = [0, 1, 2].map((i) => (f[i] * ahead + r[i] * right + up[i] * rise) * step);
    this.setParam('x', this.params.x.value + move[0]);
    this.setParam('y', this.params.y.value - move[1]);
    this.setParam('z', this.params.z.value + move[2]);
  }

  // Fullscreen keys, routed by js/main.js
  handleKey(key) {
    if (typeof key === 'string') this.keysHeld.add(key.toLowerCase());
  }

  handleKeyUp(key) {
    if (typeof key === 'string') this.keysHeld.delete(key.toLowerCase());
  }

  releaseKeys() {
    this.keysHeld.clear();
  }

  // A fullscreen drag turns the Yaw and Pitch knobs, eased as QTVR's does
  _applyDrag() {
    if (Math.abs(this.yawDelta) < 1e-3 && Math.abs(this.pitchDelta) < 1e-3) {
      this.yawDelta = 0;
      this.pitchDelta = 0;
      return;
    }
    this.setParam('yaw', wrapDegrees(this.params.yaw.value + this.yawDelta * DAMPING_FACTOR));
    this.setParam('pitch', this.params.pitch.value + this.pitchDelta * DAMPING_FACTOR);
    this.yawDelta *= 1 - DAMPING_FACTOR;
    this.pitchDelta *= 1 - DAMPING_FACTOR;
  }

  handleMouseDown(mx, my, canvasW, canvasH, button) {
    this.dragX = mx;
    this.dragY = my;
  }

  // The panorama follows the pointer, as the viewer's negative rotateSpeed did
  handleMouseDrag(mx, my, canvasW, canvasH) {
    if (this.dragX === null) return;
    const k = 360 * ROTATE_SPEED / canvasH;
    this.yawDelta -= (mx - this.dragX) * k;
    this.pitchDelta += (my - this.dragY) * k;
    this.dragX = mx;
    this.dragY = my;
  }

  handleMouseUp() {
    this.dragX = null;
    this.dragY = null;
  }

  // The wheel zooms by turning the FOV knob
  handleWheel(delta) {
    this.setParam('fov', this.params.fov.value * Math.pow(ZOOM_PER_WHEEL, delta));
  }

  dispose() {
    window.removeEventListener('blur', this.onBlur);
    for (const cloud of this.clouds) if (cloud) this.glCanvas.freeGeometry(cloud);
    this.clouds = [null, null];
    this.shaders = null;
    this.depthShaders = null;
    super.dispose();
  }
}

// A geometry of points, one quad each. points(add) calls add(direction, u, v,
// face) for every point, and each becomes four vertices at its direction, with
// its corner and face in the normal (see panoramaDepthVert)
function pointCloud(points) {
  const geometry = new p5.Geometry(1, 1, function () {
    points((dir, u, v, face) => {
      const i = this.vertices.length;
      for (const [cx, cy] of QUAD_CORNERS) {
        this.vertices.push(new p5.Vector(dir[0], dir[1], dir[2]));
        this.vertexNormals.push(new p5.Vector(cx, cy, face));
        this.uvs.push(u, v);
      }
      this.faces.push([i, i + 1, i + 2], [i + 1, i + 3, i + 2]);
    });
  });
  // model() caches GPU buffers under a geometry's gid, and builds strokes for
  // every edge on a first draw unless the geometry has one of its own (see
  // Development Conventions)
  geometry.gid = `Panorama|${nextGeometryId++}`;
  geometry.edges = [[0, 1]];
  return geometry;
}

// A point at the middle of each of the sphere's segments, read where
// panoramaEquirectFrag would read its direction: uv (u, v) is at
// (cos phi cos theta, sin phi, cos phi sin theta), theta = 2 pi u, phi = pi (v - 1/2)
function sphereCloud() {
  return pointCloud((add) => {
    for (let j = 0; j < SPHERE_ROWS; j++) {
      const v = (j + 0.5) / SPHERE_ROWS;
      const phi = Math.PI * (v - 0.5);
      for (let i = 0; i < SPHERE_COLS; i++) {
        const u = (i + 0.5) / SPHERE_COLS;
        const theta = 2 * Math.PI * u;
        add([Math.cos(phi) * Math.cos(theta), Math.sin(phi), Math.cos(phi) * Math.sin(theta)], u, v, 0);
      }
    }
  });
}

// A grid of points over each face, at uv (u, v) across it, which is
// c0 + u (c1 - c0) + v (c3 - c0) on the cube of side 2
function cubeCloud() {
  const n = CUBE_FACE_POINTS;
  return pointCloud((add) => {
    CUBE_CORNERS.forEach(([c0, c1, c3], face) => {
      for (let j = 0; j < n; j++) {
        const v = (j + 0.5) / n;
        for (let i = 0; i < n; i++) {
          const u = (i + 0.5) / n;
          const p = [0, 1, 2].map((k) => c0[k] + u * (c1[k] - c0[k]) + v * (c3[k] - c0[k]));
          const len = Math.hypot(p[0], p[1], p[2]);
          add([p[0] / len, p[1] / len, p[2] / len], u, v, face);
        }
      }
    });
  });
}

function wrapDegrees(deg) {
  return ((deg + 180) % 360 + 360) % 360 - 180;
}

registerModule('Panorama', PanoramaModule);
