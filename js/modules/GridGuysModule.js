import { Module } from './Module.js';
import { gridguysSimulationFrag } from '../shaders/gridguys-simulation.js';
import { gridguysRenderFrag } from '../shaders/gridguys-render.js';
import { registerModule } from '../moduleRegistry.js';
import { gridguys3dSimulationFrag, gridguys3dRenderFrag } from '../shaders/gridguys-3d.js';
import { Target, Target3D } from './gridguys/target.js';
import { OrbitCamera } from './latk/OrbitCamera.js';

// 3D mode's grid sizes, cells a side, in Size's order. Patches save the index,
// so new sizes are appended, never inserted.
const SIZES = [32, 64, 96, 128, 256];
const ORBIT_RATE = 0.01;     // Latk's drag rate, radians per pixel
const ZOOM_RATE = 0.001;     // and its wheel: distance x exp(delta x ZOOM_RATE)
const HOME_YAW = 35;
const HOME_PITCH = 25;
const MAX_DT = 0.1;          // so a stalled tab doesn't jump Spin

const PATTERNS = [
  { odds: [0, 0.5, 0, 0.5, 0.5, 0, 0.5, 0], randomize: [] },
  { odds: [null, 1, 1, null, 0, 1, 0, null], randomize: [0, 3, 7] },
  { odds: [0, 0, null, null, null, null, 0, 0], randomize: [2, 3, 4, 5], scale: [1, 1, 0.1, 1, 1, 0.1, 1, 1] },
  { odds: [0, 0.1, 0, 0, 0, null, 0.5, null], randomize: [5, 7] },
  { odds: [0, 0, 0, 0, 0, null, 1, null], randomize: [5, 7], scale: [1, 1, 1, 1, 1, 0.1, 1, 0.1] },
  { odds: [null, 1, null, 0, 0, 0, 0, 0], randomize: [0, 2], scale: [0.1, 1, 0.1, 1, 1, 1, 1, 1] },
  { odds: [null, null, null, null, null, null, null, null], randomize: [0, 1, 2, 3, 4, 5, 6, 7] }
];

export class GridGuysModule extends Module {
  static uid = '4b57bbb0';

  constructor(glCanvas, id) {
    super('GridGuys', glCanvas, id);
    this.inputs = [];
    this.outputs = [{ id: '3616', name: 'out', type: 'video' }];
    this.historicalInfo = "GridGuys";
    this.params = {
      mode: {
        id: 'd2ed', value: 0, min: 0, max: 1, step: 1, label: 'Mode',
        widget: 'dropdown', valueLabels: ['2D', '3D'],
      },
      blend: { id: '3947', value: 1.0, min: 0, max: 1, step: 0.01, label: 'Blend' },
      delay: { id: '6789', value: 1, min: 0, max: 60, step: 1, label: 'Delay' },
      life: { id: 'b05d', value: 40, min: 1, max: 120, step: 1, label: 'Life' },
      respawn: { id: '0a47', value: 50, min: 1, max: 120, step: 1, label: 'Respawn' },
      chaos: { id: '61ca', value: 0.03, min: 0, max: 1, step: 0.01, label: 'Chaos' },
      // 3D mode only: the grid, and Latk's orbit camera
      size: {
        id: '0986', value: 1, min: 0, max: SIZES.length - 1, step: 1, label: 'Size',
        widget: 'dropdown', valueLabels: SIZES.map((n) => `${n}³`),
      },
      yaw: { id: 'ba53', value: HOME_YAW, min: -180, max: 180, step: 1, label: 'Yaw' },
      pitch: { id: '0ce3', value: HOME_PITCH, min: -89, max: 89, step: 1, label: 'Pitch' },
      // In radii of the grid's cube, as Latk's is in radii of its drawing
      distance: {
        id: '6dfc', value: OrbitCamera.HOME_DISTANCE, min: OrbitCamera.MIN_DISTANCE, max: OrbitCamera.MAX_DISTANCE, step: 0.01,
        label: 'Distance',
      },
      spin: { id: '450d', value: 0, min: -90, max: 90, step: 1, label: 'Spin' }
    };

    // Create both shaders
    this.simulationShader = glCanvas.createShader(
      this._getVertSrc(),
      gridguysSimulationFrag
    );
    this.renderShader = glCanvas.createShader(
      this._getVertSrc(),
      gridguysRenderFrag
    );

    // Create ping-pong framebuffers for simulation state
    this.fboA = this.createFramebuffer();
    this.fboB = this.createFramebuffer();
    this.currentBuffer = 0;

    // Clear both FBOs
    this._clearFBO(this.fboA, glCanvas);
    this._clearFBO(this.fboB, glCanvas);

    this.createOutputFBO();

    // Autonomous target cursor
    this.target = new Target(glCanvas.width, glCanvas.height);

    // Propagation odds: NW, N, NE, W, E, SW, S, SE
    this.odds = [0, 0.5, 0, 0.5, 0.5, 0, 0.5, 0];
    this.setupPattern();

    this.startTime = performance.now();

    // 3D mode's buffers, shaders and cursor are made the first time it runs,
    // so a 2D node holds and draws from Math.random() just what it always did
    this.sim3d = null;
    this.cam = new OrbitCamera();
    this.cam.radius = Math.sqrt(3);   // the grid is the cube -1..1
    this.spinYaw = 0;
    this.dragX = null;
    this.dragY = null;
    this.lastTime = performance.now() / 1000;
  }

  is3D() {
    return Math.round(this.params.mode.value) === 1;
  }

  _gridSize() {
    const k = Math.max(0, Math.min(SIZES.length - 1, Math.round(this.params.size.value)));
    return SIZES[k];
  }

  _getVertSrc() {
    return `
      precision highp float;
      attribute vec3 aPosition;
      attribute vec2 aTexCoord;
      varying vec2 vTexCoord;
      void main() {
        vTexCoord = aTexCoord;
        vec4 positionVec4 = vec4(aPosition, 1.0);
        positionVec4.xy = positionVec4.xy * 2.0 - 1.0;
        gl_Position = positionVec4;
      }
    `;
  }

  _clearFBO(fbo, glCanvas) {
    fbo.begin();
    glCanvas.clear();
    fbo.end();
  }

  setupPattern() {
    const choose = Math.floor(Math.random() * PATTERNS.length);
    const pattern = PATTERNS[choose];

    for (let i = 0; i < 8; i++) {
      if (pattern.odds[i] === null || pattern.randomize.includes(i)) {
        let val = Math.random();
        if (pattern.scale && pattern.scale[i]) {
          val *= pattern.scale[i];
        }
        this.odds[i] = val;
      } else {
        this.odds[i] = pattern.odds[i];
      }
    }
  }

  resetAll(glCanvas) {
    this._clearFBO(this.fboA, glCanvas);
    this._clearFBO(this.fboB, glCanvas);
    this.setupPattern();
  }

  process(graph, glCanvas) {
    const now = performance.now() / 1000;
    const dt = Math.min(Math.max(now - this.lastTime, 0), MAX_DT);
    this.lastTime = now;
    if (this.is3D()) {
      this.spinYaw = wrapDegrees(this.spinYaw + dt * this.params.spin.value);
      this._process3D(glCanvas);
      return;
    }

    // Update target dimensions and run autonomous movement
    this.target.width = glCanvas.width;
    this.target.height = glCanvas.height;
    this.target.run();

    if (this.target.armResetAll) {
      this.setupPattern();
      this.target.armResetAll = false;
    }

    const time = (performance.now() - this.startTime) / 1000.0;
    const readFBO = this.currentBuffer === 0 ? this.fboA : this.fboB;
    const writeFBO = this.currentBuffer === 0 ? this.fboB : this.fboA;

    // --- SIMULATION PASS ---
    writeFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.simulationShader);
    this.simulationShader.setUniform('u_state', readFBO);
    // The neighbour taps are texel steps off u_resolution and the target is in
    // the same pixel space, so both follow the framebuffer's physical size
    const density = this.pixelDensity;
    this.simulationShader.setUniform('u_resolution', this.fragResolution());
    this.simulationShader.setUniform('u_target', [this.target.posX * density, -this.target.posY * density]);
    this.simulationShader.setUniform('u_targetClicked', this.target.clicked ? 1.0 : 0.0);
    this.simulationShader.setUniform('u_time', time);
    this.simulationShader.setUniform('u_oddsNW', this.odds[0]);
    this.simulationShader.setUniform('u_oddsN', this.odds[1]);
    this.simulationShader.setUniform('u_oddsNE', this.odds[2]);
    this.simulationShader.setUniform('u_oddsW', this.odds[3]);
    this.simulationShader.setUniform('u_oddsE', this.odds[4]);
    this.simulationShader.setUniform('u_oddsSW', this.odds[5]);
    this.simulationShader.setUniform('u_oddsS', this.odds[6]);
    this.simulationShader.setUniform('u_oddsSE', this.odds[7]);
    this.simulationShader.setUniform('u_delayFrames', this.params.delay.value);
    this.simulationShader.setUniform('u_lifeFrames', this.params.life.value);
    this.simulationShader.setUniform('u_respawnFrames', this.params.respawn.value);
    this.simulationShader.setUniform('u_chaos', this.params.chaos.value);
    this.renderQuad();
    writeFBO.end();

    // Swap buffers
    this.currentBuffer = 1 - this.currentBuffer;

    // --- RENDER PASS ---
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.renderShader);
    this.renderShader.setUniform('u_state', writeFBO);
    this.renderShader.setUniform('u_resolution', this.fragResolution());
    this.renderShader.setUniform('u_time', time);
    this.renderShader.setUniform('u_blend', this.params.blend.value);
    this.renderQuad();
    this.outputFBO.end();
  }

  // ------------------------------------------------------------------ 3D mode

  // Size's grid as an atlas of N slices, cols to a row, and a ping-pong pair of it
  _ensure3D(glCanvas) {
    const n = this._gridSize();
    if (this.sim3d && this.sim3d.n === n) return this.sim3d;
    if (!this.sim3d) {
      this.sim3d = {
        simShader: glCanvas.createShader(this._getVertSrc(), gridguys3dSimulationFrag),
        renderShader: glCanvas.createShader(this._getVertSrc(), gridguys3dRenderFrag),
        target: null,
        oddsFront: 0, oddsBack: 0, zSpread: 0,
        current: 0,
      };
      this._setupDepthOdds();
    } else {
      this.sim3d.fboA.remove();
      this.sim3d.fboB.remove();
    }
    const s = this.sim3d;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const opts = { width: cols * n, height: rows * n, density: 1, textureFiltering: glCanvas.NEAREST };
    s.n = n;
    s.cols = cols;
    s.atlas = [cols * n, rows * n];
    s.fboA = this.createFramebuffer(opts);
    s.fboB = this.createFramebuffer(opts);
    this._clearFBO(s.fboA, glCanvas);
    this._clearFBO(s.fboB, glCanvas);
    s.target = new Target3D(n);
    return s;
  }

  // The odds of spreading along Z, drawn with each new pattern. A third of
  // the time each way along Z is shut, as the 2D patterns shut directions.
  _setupDepthOdds() {
    const s = this.sim3d;
    s.oddsFront = Math.random() < 1 / 3 ? 0 : Math.random();
    s.oddsBack = Math.random() < 1 / 3 ? 0 : Math.random();
    s.zSpread = Math.random();
  }

  _setAtlasUniforms(shader, s) {
    shader.setUniform('u_N', s.n);
    shader.setUniform('u_cols', s.cols);
    shader.setUniform('u_atlas', s.atlas);
  }

  _process3D(glCanvas) {
    const s = this._ensure3D(glCanvas);
    s.target.run();
    if (s.target.armResetAll) {
      this.setupPattern();
      this._setupDepthOdds();
      s.target.armResetAll = false;
    }

    const time = (performance.now() - this.startTime) / 1000.0;
    const readFBO = s.current === 0 ? s.fboA : s.fboB;
    const writeFBO = s.current === 0 ? s.fboB : s.fboA;

    // --- SIMULATION PASS ---
    const sim = s.simShader;
    writeFBO.begin();
    glCanvas.clear();
    glCanvas.shader(sim);
    sim.setUniform('u_state', readFBO);
    this._setAtlasUniforms(sim, s);
    sim.setUniform('u_target', s.target.pos);
    sim.setUniform('u_targetClicked', s.target.clicked ? 1.0 : 0.0);
    sim.setUniform('u_time', time);
    sim.setUniform('u_oddsNW', this.odds[0]);
    sim.setUniform('u_oddsN', this.odds[1]);
    sim.setUniform('u_oddsNE', this.odds[2]);
    sim.setUniform('u_oddsW', this.odds[3]);
    sim.setUniform('u_oddsE', this.odds[4]);
    sim.setUniform('u_oddsSW', this.odds[5]);
    sim.setUniform('u_oddsS', this.odds[6]);
    sim.setUniform('u_oddsSE', this.odds[7]);
    sim.setUniform('u_oddsFront', s.oddsFront);
    sim.setUniform('u_oddsBack', s.oddsBack);
    sim.setUniform('u_zSpread', s.zSpread);
    sim.setUniform('u_delayFrames', this.params.delay.value);
    sim.setUniform('u_lifeFrames', this.params.life.value);
    sim.setUniform('u_respawnFrames', this.params.respawn.value);
    sim.setUniform('u_chaos', this.params.chaos.value);
    this.renderQuad();
    writeFBO.end();
    s.current = 1 - s.current;

    // --- RENDER PASS ---
    // Latk's orbit camera round the cube -1..1, its eye and axes taken into
    // cell space for the ray
    const cam = this.cam;
    cam.yaw = wrapDegrees(this.params.yaw.value + this.spinYaw) * Math.PI / 180;
    cam.pitch = this.params.pitch.value * Math.PI / 180;
    cam.distance = this.params.distance.value * cam.radius;
    const eye = cam.getEye();
    const fwd = normalize([-eye[0], -eye[1], -eye[2]]);
    const right = normalize(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    const toCells = (v) => (v + 1) * 0.5 * s.n;

    const ren = s.renderShader;
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(ren);
    ren.setUniform('u_state', writeFBO);
    this._setAtlasUniforms(ren, s);
    ren.setUniform('u_eye', eye.map(toCells));
    ren.setUniform('u_right', right);
    ren.setUniform('u_up', up);
    ren.setUniform('u_fwd', fwd);
    ren.setUniform('u_tanHalfFov', Math.tan(cam.fov / 2));
    ren.setUniform('u_aspect', glCanvas.width / glCanvas.height);
    ren.setUniform('u_blend', this.params.blend.value);
    this.renderQuad();
    this.outputFBO.end();
  }

  // ---------------------------------------------------------------- fullscreen
  // In 3D mode, as on Latk: dragging orbits by turning Yaw and Pitch, the
  // wheel zooms by turning Distance, and a double-click goes back home.
  // js/ui.js only routes these while is3D().

  handleMouseDown(mx, my) {
    this.dragX = mx;
    this.dragY = my;
  }

  handleMouseDrag(mx, my) {
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

  handleWheel(delta) {
    this.setParam('distance', this.params.distance.value * Math.exp(delta * ZOOM_RATE));
  }

  handleDoubleClick() {
    this.setParam('yaw', HOME_YAW);
    this.setParam('pitch', HOME_PITCH);
    this.setParam('distance', OrbitCamera.HOME_DISTANCE);
    this.spinYaw = 0;
  }

  dispose() {
    if (this.sim3d) {
      this.sim3d.fboA.remove();
      this.sim3d.fboB.remove();
      this.sim3d = null;
    }
    this.fboA = null;
    this.fboB = null;
    this.simulationShader = null;
    this.renderShader = null;
    super.dispose();
  }
}

function wrapDegrees(deg) {
  return ((deg + 180) % 360 + 360) % 360 - 180;
}

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

registerModule('GridGuys', GridGuysModule);
