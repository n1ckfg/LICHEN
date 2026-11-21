// Swarm: a port of a Flash piece (build.as, by way of a p5.js port). A leader
// wanders around a hidden rectangle and a swarm of agents chases it, twitching
// as they go. Every frame each agent paints a short segment onto a canvas that
// is never cleared, coloured from the input under it, and every so often the
// whole canvas gets a very slight blur.
//
// The logic runs in the original 1024x728 stage, scaled to cover the frame, so
// speeds, widths and the area are in stage pixels. The motion steps once a
// frame, as the SWF did; only the blur runs on the clock.
import { Module } from './Module.js';
import { vertSrc } from '../shaders/vert.js';
import { passthroughFrag } from '../shaders/passthrough.js';
import { swarmSegmentVert, swarmSegmentFrag, swarmBlurFrag, SWARM_MAX } from '../shaders/swarm.js';
import { registerModule } from '../moduleRegistry.js';

const STAGE_W = 1024;
const STAGE_H = 728;
const TEX_W = 2048;            // agent texels: two an agent, in one row
const OUTLINE_EXTRA = 3;       // the outline is this much wider than the line

let nextGeometryId = 0;

// AS2 random(n): an integer in [0, n)
const random_ = (n) => Math.floor(Math.random() * n);
const dCos = (a) => Math.cos((a * Math.PI) / 180);
const dSin = (a) => Math.sin((a * Math.PI) / 180);

function fixAngle(angle) {
  if (angle > 360) angle %= 360;
  while (angle < 0) angle += 360;
  return angle;
}

// Flash keeps _rotation in [-180, 180]
function wrapRotation(r) {
  r %= 360;
  if (r > 180) r -= 360;
  else if (r < -180) r += 360;
  return r;
}

// Turn toward (goalX, goalY) by rotSpeed degrees
function steer(agent, goalX, goalY, rotSpeed) {
  let goalAngle = (Math.atan2(goalY - agent.y, goalX - agent.x) * 180) / Math.PI;
  goalAngle = fixAngle(goalAngle - agent.rotation);
  agent.rotation += goalAngle < 180 ? rotSpeed : -rotSpeed;
}

// The 3x3 weights of a box blur b pixels wide (see swarmBlurFrag)
function boxWeights(b) {
  b = Math.max(1, Math.min(3, b));
  const side = (b - 1) / 2 / b;
  return [side, 1 / b, side];
}

export class SwarmModule extends Module {
  static uid = 'd4651ad4';

  constructor(glCanvas, id) {
    super('Swarm', glCanvas, id);
    this.inputs = [{ id: 'a2f5', name: 'in', type: 'video' }];
    this.outputs = [{ id: '7ecc', name: 'out', type: 'video' }];
    // Defaults are build.as's constants. `random` ranges keep a fresh seed away
    // from a swarm that can't move or turn, an area too thin to wander in, and
    // a blur that washes the painting out faster than it is laid down.
    this.params = {
      count: { id: '0d22', value: 80, min: 1, max: SWARM_MAX, step: 1, label: 'Swarm', random: [20, 300] },
      speed: { id: '3260', value: 10, min: 0, max: 40, step: 0.5, label: 'Speed', random: [4, 20] },
      turn: { id: '3e0d', value: 10, min: 0, max: 90, step: 0.5, label: 'Turn', random: [3, 30] },
      twitch: { id: '3fbf', value: 100, min: 0, max: 360, step: 1, label: 'Twitch', random: [10, 200] },
      weight: { id: '4082', value: 10, min: 0, max: 40, step: 1, label: 'Weight', random: [2, 24] },
      outline: { id: '471c', value: 0.5, min: 0, max: 1, step: 0.01, label: 'Outline', random: [0.15, 0.8] },
      jitter: { id: '6102', value: 10, min: 0, max: 100, step: 1, label: 'Jitter', random: [0, 40] },
      leaderSpeed: { id: '665e', value: 20, min: 0, max: 60, step: 0.5, label: 'Lead Speed', random: [8, 35] },
      leaderTurn: { id: '742b', value: 20, min: 0, max: 90, step: 0.5, label: 'Lead Turn', random: [8, 45] },
      leaderRun: { id: '7fea', value: 20, min: 1, max: 120, step: 1, label: 'Lead Run', random: [8, 60] },
      areaW: { id: '8323', value: 650, min: 0, max: STAGE_W, step: 2, label: 'Area W', random: [200, 1000] },
      areaH: { id: '9441', value: 300, min: 0, max: STAGE_H, step: 2, label: 'Area H', random: [100, 700] },
      blurX: { id: 'a577', value: 1.05, min: 1, max: 3, step: 0.01, label: 'Blur X', random: [1, 1.3] },
      blurY: { id: 'a999', value: 1.05, min: 1, max: 3, step: 0.01, label: 'Blur Y', random: [1, 1.3] },
      blurEvery: { id: 'a9e1', value: 200, min: 0, max: 2000, step: 10, label: 'Blur Every', random: [50, 600] },
      reseed: { id: 'b526', value: 0, min: 0, max: 1, step: 1, label: 'Seed', widget: 'trigger' },
    };

    // The canvas the swarm paints on is the output. The blur reads it whole,
    // so it goes through blurFBO and is copied back.
    this.createOutputFBO();
    this.blurFBO = this.createFramebuffer();
    this.segmentShader = glCanvas.createShader(swarmSegmentVert, swarmSegmentFrag);
    this.blurShader = glCanvas.createShader(vertSrc, swarmBlurFrag);
    this.copyShader = glCanvas.createShader(vertSrc, passthroughFrag);
    this.geometry = this._buildGeometry();
    this.agentFBO = glCanvas.createFramebuffer({
      width: TEX_W, height: 1, density: 1, depth: false, antialias: false,
      format: glCanvas.FLOAT, textureFiltering: glCanvas.NEAREST,
    });
    this.agentData = new Float32Array(TEX_W * 4);
    this.warnedNoFloat = false;

    this.leader = null;
    this.swarm = [];
    this.leaderTime = 0;
    this.lastBlur = 0;

    // Every new swarm starts from its own seed. Patch loads and duplicates
    // then restore the saved params and seed over this one.
    this.randomize();
    this._reset();
  }

  // Two quads an agent, placed by the vertex shader, so this is built once
  _buildGeometry() {
    const geometry = new p5.Geometry(1, 1, function () {
      for (let q = 0; q < SWARM_MAX * 2; q++) {
        const base = this.vertices.length;
        this.vertices.push(
          new p5.Vector(-1, -1, q), new p5.Vector(1, -1, q),
          new p5.Vector(1, 1, q), new p5.Vector(-1, 1, q));
        this.faces.push([base, base + 1, base + 2], [base, base + 2, base + 3]);
      }
    });
    // p5 caches a geometry's GPU buffers under its gid (see Development Conventions)
    geometry.gid = `Swarm|${nextGeometryId++}`;
    return geometry;
  }

  // A fresh leader and swarm, and a blank canvas on the next frame
  _reset() {
    this.leaderTime = 0;
    const [ax, ay, aw, ah] = this._area();
    this.leader = {
      x: random_(aw) + ax, y: random_(ah) + ay, rotation: 0, goalX: 0, goalY: 0,
    };
    this.swarm = [];
    this._fillSwarm();
    this.pendingClear = true;
    this.lastBlur = performance.now();
  }

  // The hidden rectangle the leader wanders in, centred on the stage as
  // myCanvas was: x, y, width, height
  _area() {
    const w = Math.max(1, Math.round(this.params.areaW.value));
    const h = Math.max(1, Math.round(this.params.areaH.value));
    return [Math.round((STAGE_W - w) / 2), Math.round((STAGE_H - h) / 2), w, h];
  }

  _count() {
    return Math.max(1, Math.min(SWARM_MAX, Math.round(this.params.count.value)));
  }

  // Grow the swarm to Swarm from the leader, or cut it down. One agent in
  // four draws a thick line; the rest draw hairlines. Each keeps where in
  // Weight's range its line falls, so turning Weight rescales it live.
  _fillSwarm() {
    const n = this._count();
    if (this.swarm.length > n) this.swarm.length = n;
    while (this.swarm.length < n) {
      this.swarm.push({
        x: this.leader.x, y: this.leader.y, rotation: 0,
        thick: random_(4) === 0 ? Math.random() : -1,
      });
    }
  }

  _updateLeader() {
    const L = this.leader;
    if (this.leaderTime <= 0) {
      const [ax, ay, aw, ah] = this._area();
      L.goalX = random_(aw) + ax;
      L.goalY = random_(ah) + ay;
      this.leaderTime = Math.max(1, Math.round(this.params.leaderRun.value));
    }
    steer(L, L.goalX, L.goalY, this.params.leaderTurn.value);
    L.rotation = wrapRotation(L.rotation);
    L.x += dCos(L.rotation) * this.params.leaderSpeed.value;
    L.y += dSin(L.rotation) * this.params.leaderSpeed.value;
    this.leaderTime--;
  }

  // Move every agent and write its segment into agentData, in frame pixels
  _updateSwarm(glCanvas) {
    const W = glCanvas.width;
    const H = glCanvas.height;
    const scale = Math.max(W / STAGE_W, H / STAGE_H);
    const sx = (x) => (x - STAGE_W / 2) * scale + W / 2;
    const sy = (y) => (y - STAGE_H / 2) * scale + H / 2;
    const twitch = Math.max(0, Math.round(this.params.twitch.value));
    const speed = this.params.speed.value;
    const turn = this.params.turn.value;
    const maxWeight = Math.max(0, Math.round(this.params.weight.value));
    const jitter = this.params.jitter.value;   // colour is read up to this far off
    const d = this.agentData;

    this.swarm.forEach((s, i) => {
      const startX = s.x;
      const startY = s.y;
      steer(s, this.leader.x, this.leader.y, turn);
      s.rotation += random_(twitch) - Math.floor(twitch / 2);
      s.rotation = wrapRotation(s.rotation);
      s.x += dCos(s.rotation) * speed;
      s.y += dSin(s.rotation) * speed;

      // Flash lineStyle thickness 0 is a 1px hairline that ignores scaling.
      // The original's "swarm_shadow" line is never drawn in Flash, since that
      // clip is never created, so only the outline and the line are.
      const w = s.thick < 0 ? 0 : Math.floor(s.thick * maxWeight) + 2;
      const lineW = w === 0 ? 1 : w * scale;
      const outlineW = (w + OUTLINE_EXTRA) * scale;
      const tx = s.x + (Math.random() * 2 - 1) * jitter;
      const ty = s.y + (Math.random() * 2 - 1) * jitter;

      const o = i * 8;
      d[o] = sx(startX); d[o + 1] = sy(startY);
      d[o + 2] = sx(s.x); d[o + 3] = sy(s.y);
      d[o + 4] = lineW; d[o + 5] = outlineW;
      d[o + 6] = sx(tx) / W; d[o + 7] = sy(ty) / H;
    });
  }

  // p5 has no way to fill a texture from an array, so this writes straight into
  // agentFBO's colour texture, putting back the state it touches, as
  // SegmentRenderer does
  _upload(n) {
    const g = this.glCanvas;
    const fbo = this.agentFBO;
    if (fbo.format === g.UNSIGNED_BYTE) {
      if (!this.warnedNoFloat) console.warn('Swarm: this browser has no float framebuffers');
      this.warnedNoFloat = true;
      return false;
    }
    const gl = g.drawingContext;
    const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const prevFlip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    const prevPremul = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, fbo.colorTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n * 2, 1, gl.RGBA, gl.FLOAT,
      this.agentData.subarray(0, n * 8));
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlip);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, prevPremul);
    return true;
  }

  process(graph, glCanvas) {
    const input = this.getInput(graph, 0);

    if (this.pendingClear) {
      this.outputFBO.begin();
      glCanvas.background(255);
      this.outputFBO.end();
      this.pendingClear = false;
    }

    this._fillSwarm();
    this._updateLeader();
    this._updateSwarm(glCanvas);
    const n = this.swarm.length;

    if (this._upload(n)) {
      const s = this.segmentShader;
      this.outputFBO.begin();
      glCanvas.noStroke();
      glCanvas.shader(s);
      s.setUniform('uAgents', this.agentFBO);
      // Every sampler gets a texture, so with nothing plugged in the agent
      // data stands in for the input (see Development Conventions)
      s.setUniform('uInput', input || this.agentFBO);
      s.setUniform('uHasInput', input ? 1 : 0);
      s.setUniform('uTexW', TEX_W);
      s.setUniform('uCount', n);
      s.setUniform('uFrame', [glCanvas.width, glCanvas.height]);
      s.setUniform('uFeather', 1 / this.pixelDensity);
      s.setUniform('uOutline', this.params.outline.value);
      glCanvas.blendMode(glCanvas.BLEND);
      glCanvas.model(this.geometry);
      this.outputFBO.end();
    }

    const now = performance.now();
    if (now - this.lastBlur >= this.params.blurEvery.value) {
      this.lastBlur = now;
      this._blur(glCanvas);
    }
  }

  _blur(glCanvas) {
    const [rw, rh] = this.fragResolution();
    this.blurFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.blurShader);
    this.blurShader.setUniform('tex0', this.outputFBO);
    this.blurShader.setUniform('texelSize', [1 / rw, 1 / rh]);
    this.blurShader.setUniform('wx', boxWeights(this.params.blurX.value));
    this.blurShader.setUniform('wy', boxWeights(this.params.blurY.value));
    this.renderQuad();
    this.blurFBO.end();

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.copyShader);
    this.copyShader.setUniform('tex0', this.blurFBO);
    this.renderQuad();
    this.outputFBO.end();
  }

  // The stage's scale follows the frame, and the canvas came back cleared
  frameResized(w, h) {
    this._reset();
  }

  onTrigger(name) {
    if (name === 'reseed') {
      this.randomize();
      this._reset();
    }
  }

  triggerText(name) {
    return name === 'reseed' ? this.seed : '';
  }

  dispose() {
    if (this.geometry) this.glCanvas.freeGeometry(this.geometry);
    if (this.agentFBO) this.agentFBO.remove();
    if (this.blurFBO) this.blurFBO.remove();
    this.geometry = null;
    this.agentFBO = null;
    this.blurFBO = null;
    super.dispose();
  }
}

registerModule('Swarm', SwarmModule);
