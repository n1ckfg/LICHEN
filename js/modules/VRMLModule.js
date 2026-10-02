import { Module } from './Module.js';
import { registerModule } from '../moduleRegistry.js';
import { VRMLLoader } from './vrml/VRMLLoader.js';
import { decodeVRML, preprocessVRML } from './vrml/preprocessVRML.js';

const MAX_DT = 0.1;   // clamp long stalls so a tab switch doesn't jump the spin

// The viewer's camera: 60° vertical FOV. Its far plane is kept to a sane value,
// since the model is always fitted to FIT_SIZE units round the origin.
const FOV = Math.PI / 3;
const NEAR = 0.1;
const FAR = 10000;
const FIT_SIZE = 50;

// p5's orbitControl, which the viewer uses: a drag adds 0.6 rad of velocity per
// short side of the canvas dragged, and the velocity decays by 0.85 a frame
const ORBIT_GAIN = 0.6;
const ORBIT_DAMPING = 0.85;
const ZOOM_PER_WHEEL = 1.001;   // distance factor per unit of wheel delta

// A VRML97 world (.wrl, optionally gzipped), ported from the vrml-qtvr-viewer
// project's p5.js viewer. The loader bakes the scene into a few vertex-colored
// p5.Geometry objects, drawn here from an orbiting camera.
export class VRMLModule extends Module {
  constructor(glCanvas, id) {
    super('VRML', glCanvas, id);
    this.outputs = [{ name: 'out', type: 'video' }];
    this.historicalInfo = 'VRML';
    this.params = {
      yaw:      { value: 0, min: -180, max: 180, step: 1, label: 'Yaw' },
      pitch:    { value: 0, min: -89, max: 89, step: 1, label: 'Pitch' },
      distance: { value: 80, min: 1, max: 200, step: 1, label: 'Distance' },
      spin:     { value: 0, min: -90, max: 90, step: 1, label: 'Spin' },
    };
    this.scene = null;      // { geometries, boundingBox, background } from VRMLLoader
    this.fileName = '';     // shown on the load button
    this.fitScale = 1;
    this.fitCenter = [0, 0, 0];
    this.spinYaw = 0;       // degrees turned by Spin, added to the Yaw knob
    this.yawVelocity = 0;   // fullscreen drag still to apply, in degrees per frame
    this.pitchVelocity = 0;
    this.dragX = null;      // last fullscreen drag position, null when not dragging
    this.dragY = null;
    this.lastTime = performance.now() / 1000;
    // Antialiased, unlike the 2D modules' buffers, so model edges don't stair-step
    this.outputFBO = glCanvas.createFramebuffer({ antialias: true });
    this._createFileInput();
  }

  _createFileInput() {
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.wrl,.wrz,.gz';
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
      const text = preprocessVRML(await decodeVRML(await file.arrayBuffer()));
      this._setScene(new VRMLLoader().parse(text), file.name);
    } catch (e) {
      // Keep whatever world was loaded before
      alert(`Could not load ${file.name}: ${e.message}`);
    }
    this.fileInput.value = '';   // so picking the same file again still fires 'change'
  }

  _setScene(scene, fileName) {
    this._freeScene();
    this.scene = scene;
    this.fileName = fileName;

    // Scale to FIT_SIZE units and center, as the viewer does
    const box = scene.boundingBox;
    this.fitScale = 1;
    this.fitCenter = [0, 0, 0];
    if (box) {
      const maxDim = Math.max(...box.max.map((max, i) => max - box.min[i]));
      this.fitScale = maxDim > 0 ? FIT_SIZE / maxDim : 1;
      this.fitCenter = box.max.map((max, i) => (max + box.min[i]) / 2);
    }
  }

  // p5 keeps the GPU buffers of every geometry it has drawn until told otherwise
  _freeScene() {
    if (!this.scene) return;
    for (const geometry of this.scene.geometries) this.glCanvas.freeGeometry(geometry);
    this.scene = null;
  }

  process(graph, glCanvas) {
    const now = performance.now() / 1000;
    const dt = Math.min(now - this.lastTime, MAX_DT);
    this.lastTime = now;
    this.spinYaw = wrapDegrees(this.spinYaw + dt * this.params.spin.value);
    this._applyDrag();

    if (!this.scene) return;

    const yaw = (this.params.yaw.value + this.spinYaw) * Math.PI / 180;
    const pitch = this.params.pitch.value * Math.PI / 180;
    const r = this.params.distance.value;

    this.outputFBO.begin();
    const bg = this.scene.background;
    if (bg) {
      glCanvas.background(bg[0] * 255, bg[1] * 255, bg[2] * 255);
    } else {
      glCanvas.background(0);
    }
    // p5's own lit shader with the vertex colors, whatever the last module left bound
    glCanvas.resetShader();
    glCanvas.noLights();
    glCanvas.noStroke();
    glCanvas.fill(255);

    // Orbit the origin; p5's y axis points down, so a positive pitch is a negative y
    glCanvas.perspective(FOV, glCanvas.width / glCanvas.height, NEAR, FAR);
    glCanvas.camera(
      r * Math.sin(yaw) * Math.cos(pitch), -r * Math.sin(pitch), r * Math.cos(yaw) * Math.cos(pitch),
      0, 0, 0,
      0, 1, 0
    );

    // The viewer's lights, matching its three.js original's AmbientLight(1.2) and
    // DirectionalLight(2.0) from (200, 200, 200). p5 lights are in world space.
    glCanvas.ambientLight(215);
    glCanvas.directionalLight(120, 120, 120, -1, 1, -1);

    // VRML is y-up, so the scene is drawn with y flipped
    glCanvas.scale(this.fitScale, -this.fitScale, this.fitScale);
    glCanvas.translate(-this.fitCenter[0], -this.fitCenter[1], -this.fitCenter[2]);
    for (const geometry of this.scene.geometries) {
      glCanvas.model(geometry);
    }
    this.outputFBO.end();
  }

  // Fullscreen drag turns the Yaw and Pitch knobs, with orbitControl's damping
  _applyDrag() {
    if (Math.abs(this.yawVelocity) < 1e-4 && Math.abs(this.pitchVelocity) < 1e-4) {
      this.yawVelocity = 0;
      this.pitchVelocity = 0;
      return;
    }
    this.setParam('yaw', wrapDegrees(this.params.yaw.value + this.yawVelocity));
    this.setParam('pitch', this.params.pitch.value + this.pitchVelocity);
    this.yawVelocity *= ORBIT_DAMPING;
    this.pitchVelocity *= ORBIT_DAMPING;
  }

  handleMouseDown(mx, my, canvasW, canvasH, button) {
    this.dragX = mx;
    this.dragY = my;
  }

  handleMouseDrag(mx, my, canvasW, canvasH) {
    if (this.dragX === null) return;
    const k = ORBIT_GAIN / Math.min(canvasW, canvasH) * 180 / Math.PI;
    this.yawVelocity -= (mx - this.dragX) * k;
    this.pitchVelocity += (my - this.dragY) * k;
    this.dragX = mx;
    this.dragY = my;
  }

  handleMouseUp() {
    this.dragX = null;
    this.dragY = null;
  }

  // The wheel zooms by turning the Distance knob
  handleWheel(delta) {
    this.setParam('distance', this.params.distance.value * Math.pow(ZOOM_PER_WHEEL, delta));
  }

  dispose() {
    this._freeScene();
    if (this.fileInput) this.fileInput.remove();
    super.dispose();
  }
}

function wrapDegrees(deg) {
  return ((deg + 180) % 360 + 360) % 360 - 180;
}

registerModule('VRML', VRMLModule);
