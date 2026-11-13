import { Module } from './Module.js';
import { vertSrc } from '../shaders/vert.js';
import { panoramaEquirectFrag, panoramaCubemapFrag } from '../shaders/panorama.js';
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

// Views its input as a panorama from the centre, as QTVR views a file: an
// equirectangular image (2:1) on a sphere, or a cubemap (a horizontal strip of
// six faces, px, nx, py, ny, pz, nz) on a cube. Each projection is a shader of
// its own that casts a ray per pixel. In fullscreen, a drag turns the Yaw and
// Pitch knobs and the wheel turns FOV.
export class PanoramaModule extends Module {
  static uid = '75258cea';

  constructor(glCanvas, id) {
    super('Panorama', glCanvas, id);
    this.inputs = [{ id: '1c36', name: 'in', type: 'video' }];
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
    };
    this.shaders = [
      glCanvas.createShader(vertSrc, panoramaEquirectFrag),
      glCanvas.createShader(vertSrc, panoramaCubemapFrag),
    ];
    this.createOutputFBO();
    this.spinYaw = 0;       // degrees turned by Spin, added to the Yaw knob
    this.yawDelta = 0;      // fullscreen drag still to apply, in degrees
    this.pitchDelta = 0;
    this.dragX = null;      // last fullscreen drag position, null when not dragging
    this.dragY = null;
    this.lastTime = performance.now() / 1000;
  }

  process(graph, glCanvas) {
    const now = performance.now() / 1000;
    const dt = Math.min(now - this.lastTime, MAX_DT);
    this.lastTime = now;
    this.spinYaw = wrapDegrees(this.spinYaw + dt * this.params.spin.value);
    this._applyDrag();

    const input = this.getInput(graph, 0);
    if (!input) return;

    // A cable on Projection rounds to an option, as the menu's box does
    const shader = this.shaders[Math.round(this.params.projection.value) === CUBEMAP ? 1 : 0];
    const yaw = (this.params.yaw.value + this.spinYaw) * Math.PI / 180;
    const pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.params.pitch.value)) * Math.PI / 180;
    const fov = this.params.fov.value * Math.PI / 180;

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
    this.shaders = null;
    super.dispose();
  }
}

function wrapDegrees(deg) {
  return ((deg + 180) % 360 + 360) % 360 - 180;
}

registerModule('Panorama', PanoramaModule);
