import { Module } from './Module.js';
import { registerModule } from '../moduleRegistry.js';

const MAX_DT = 0.1;   // clamp long stalls so a tab switch doesn't jump the spin

const PROJECTIONS = ['Equirectangular', 'Cubemap', 'Cylindrical'];
const EQUIRECTANGULAR = 0;
const CUBEMAP = 1;
const CYLINDRICAL = 2;

// The viewer's three.js OrbitControls settings (rotateSpeed -0.25, enableDamping):
// a drag of the canvas height turns the view by 2π × 0.25, and the turn still to
// apply eases in at 5% a frame
const ROTATE_SPEED = 0.25;
const DAMPING_FACTOR = 0.05;
const ZOOM_PER_WHEEL = 1.001;   // FOV factor per unit of wheel delta
const MAX_PITCH = 90 - 1e-4;    // degrees; looking straight up or down flips the camera

const CYLINDER_RADIUS = 10;

// Faces of the three.js version's BoxGeometry(1, 1, 1) scaled by (1, 1, -1), in
// atlas order (px, nx, py, ny, pz, nz). Each face lists the corners that get the
// tile's top-left, top-right, bottom-right and bottom-left, in p5 coordinates (y down).
const SKYBOX_FACES = [
  [[1, -1, -1], [1, -1, 1], [1, 1, 1], [1, 1, -1]],
  [[-1, -1, 1], [-1, -1, -1], [-1, 1, -1], [-1, 1, 1]],
  [[-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1]],
  [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]],
  [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]],
  [[1, -1, 1], [-1, -1, 1], [-1, 1, 1], [1, 1, 1]],
];
const SKYBOX_UVS = [[0, 0], [1, 0], [1, 1], [0, 1]];

// A QuickTime VR-style panorama image, ported from the vrml-qtvr-viewer project's
// p5.js viewer: the image is mapped inside a sphere (equirectangular), a cube
// (a horizontal strip of six faces) or an open cylinder, and viewed from its center.
export class QTVRModule extends Module {
  constructor(glCanvas, id) {
    super('QTVR', glCanvas, id);
    this.outputs = [{ name: 'out', type: 'video' }];
    this.historicalInfo = 'QTVR';
    this.params = {
      projection: {
        value: CYLINDRICAL, min: 0, max: PROJECTIONS.length - 1, step: 1, label: 'Projection', widget: 'dropdown',
        valueLabels: PROJECTIONS,
      },
      yaw:   { value: 0, min: -180, max: 180, step: 1, label: 'Yaw' },
      pitch: { value: 0, min: -90, max: 90, step: 1, label: 'Pitch' },
      fov:   { value: 75, min: 20, max: 120, step: 1, label: 'FOV' },
      spin:  { value: 0, min: -90, max: 90, step: 1, label: 'Spin' },
    };
    this.img = null;
    this.faces = null;      // the cube faces cut from the atlas, made on first use
    this.fileName = '';     // shown on the load button
    this.cylinderHeight = 0;
    this.spinYaw = 0;       // degrees turned by Spin, added to the Yaw knob
    this.yawDelta = 0;      // fullscreen drag still to apply, in degrees
    this.pitchDelta = 0;
    this.dragX = null;      // last fullscreen drag position, null when not dragging
    this.dragY = null;
    this.lastTime = performance.now() / 1000;
    // Antialiased, unlike the 2D modules' buffers, so the cube's seams stay clean
    this.outputFBO = glCanvas.createFramebuffer({ antialias: true });
    this._createFileInput();
  }

  _createFileInput() {
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'image/*';
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

  loadFile(file) {
    const url = URL.createObjectURL(file);
    const p = this.glCanvas._pInst;
    p.loadImage(url, (img) => {
      URL.revokeObjectURL(url);
      this._setImage(img, file.name);
    }, () => {
      URL.revokeObjectURL(url);
      // Keep whatever panorama was loaded before
      alert(`Could not load ${file.name}: not a readable image`);
    });
    this.fileInput.value = '';   // so picking the same file again still fires 'change'
  }

  _setImage(img, fileName) {
    // Panorama strips can be very wide; shrink any that won't fit in one texture
    const gl = this.glCanvas._renderer.GL;
    const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (img.width > maxSize || img.height > maxSize) {
      const s = maxSize / Math.max(img.width, img.height);
      img.resize(Math.floor(img.width * s), Math.floor(img.height * s));
    }

    this._freeImages();
    this.img = img;
    this.fileName = fileName;
    // The viewer's cylinder: its circumference spans the image's width
    this.cylinderHeight = (img.height / img.width) * (2 * Math.PI * CYLINDER_RADIUS);

    // Guess the projection from the shape: 2:1 is equirectangular, a 6:1 strip a
    // cubemap, and anything else a cylindrical strip. A cable on it still wins.
    const aspect = img.width / img.height;
    const projection = Math.abs(aspect - 6) < 0.05 ? CUBEMAP
      : Math.abs(aspect - 2) < 0.05 ? EQUIRECTANGULAR
      : CYLINDRICAL;
    this.setParam('projection', projection);
  }

  // The faces are square tiles the atlas's height wide, left to right
  _cutFaces() {
    const tile = this.img.height;
    this.faces = [];
    for (let i = 0; i < 6; i++) {
      this.faces.push(this.img.get(tile * i, 0, tile, tile));
    }
  }

  // p5 keeps a GL texture for every image it has drawn and never frees it, and
  // a panorama strip can take tens of megabytes
  _freeImages() {
    const renderer = this.glCanvas._renderer;
    for (const img of [this.img, ...(this.faces || [])]) {
      const tex = img && renderer.textures.get(img);
      if (!tex) continue;
      renderer.GL.deleteTexture(tex.glTex);
      renderer.textures.delete(img);
    }
    this.img = null;
    this.faces = null;
  }

  process(graph, glCanvas) {
    const now = performance.now() / 1000;
    const dt = Math.min(now - this.lastTime, MAX_DT);
    this.lastTime = now;
    this.spinYaw = wrapDegrees(this.spinYaw + dt * this.params.spin.value);
    this._applyDrag();

    if (!this.img) return;

    const projection = Math.round(this.params.projection.value);
    const yaw = (this.params.yaw.value + this.spinYaw) * Math.PI / 180;
    const pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.params.pitch.value)) * Math.PI / 180;
    const fov = this.params.fov.value * Math.PI / 180;

    this.outputFBO.begin();
    glCanvas.background(0);
    // p5's own texture shader, whatever the last module left bound
    glCanvas.resetShader();
    glCanvas.noLights();
    glCanvas.noStroke();

    // Look around from the center, starting toward -z as in the viewer
    glCanvas.perspective(fov, glCanvas.width / glCanvas.height, 0.1, 1000);
    const cosPitch = Math.cos(pitch);
    glCanvas.camera(0, 0, 0, Math.sin(yaw) * cosPitch, -Math.sin(pitch), -Math.cos(yaw) * cosPitch, 0, 1, 0);

    if (projection === EQUIRECTANGULAR) {
      // Inside of a sphere, mirrored so the image reads correctly, and turned so
      // the view starts at the same spot as three's SphereGeometry
      glCanvas.texture(this.img);
      glCanvas.rotateY(Math.PI / 2);
      glCanvas.scale(-1, 1, 1);
      glCanvas.sphere(500, 60, 40);
    } else if (projection === CUBEMAP) {
      if (!this.faces) this._cutFaces();
      // textureMode isn't saved by push(), so put it back for the other modules
      const prevTextureMode = glCanvas._renderer.textureMode;
      glCanvas.textureMode(glCanvas.NORMAL);
      for (let i = 0; i < 6; i++) {
        glCanvas.texture(this.faces[i]);
        glCanvas.beginShape(glCanvas.QUADS);
        SKYBOX_FACES[i].forEach(([x, y, z], k) => {
          glCanvas.vertex(x * 0.5, y * 0.5, z * 0.5, SKYBOX_UVS[k][0], SKYBOX_UVS[k][1]);
        });
        glCanvas.endShape();
      }
      glCanvas.textureMode(prevTextureMode);
    } else {
      // Cylindrical panoramic strip, open-ended
      glCanvas.texture(this.img);
      glCanvas.scale(-1, 1, 1);
      glCanvas.cylinder(CYLINDER_RADIUS, this.cylinderHeight, 60, 1, false, false);
    }
    this.outputFBO.end();
  }

  // Fullscreen drag turns the Yaw and Pitch knobs, eased like the viewer's
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

  // The viewer's negative rotateSpeed: the panorama follows the pointer
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

  // The wheel zooms by turning the FOV knob, as QuickTime VR's zoom keys did
  handleWheel(delta) {
    this.setParam('fov', this.params.fov.value * Math.pow(ZOOM_PER_WHEEL, delta));
  }

  dispose() {
    this._freeImages();
    if (this.fileInput) this.fileInput.remove();
    super.dispose();
  }
}

function wrapDegrees(deg) {
  return ((deg + 180) % 360 + 360) % 360 - 180;
}

registerModule('QTVR', QTVRModule);
