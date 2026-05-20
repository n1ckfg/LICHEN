import { Module } from './Module.js';
import { conwaySimulationFrag, conwayRenderFrag } from '../shaders/conway.js';
import { registerModule } from '../moduleRegistry.js';

const PATTERNS = {
  glider: [[0,0],[1,0],[2,0],[2,-1],[1,-2]],
  lwss: [[0,0],[0,2],[1,-1],[2,-1],[3,-1],[3,2],[4,-1],[4,0],[4,1]],
  blinker: [[0,0],[1,0],[2,0]],
  block: [[0,0],[0,1],[1,0],[1,1]],
  beacon: [[0,0],[0,1],[1,0],[2,3],[3,2],[3,3]],
  toad: [[0,1],[0,2],[0,3],[1,0],[1,1],[1,2]],
  pulsar: [[-1,-2],[-1,-3],[-1,-4],[-2,-1],[-3,-1],[-4,-1],[-2,-6],[-3,-6],[-4,-6],[-1,-7],[-1,-8],[-1,-9],[-6,-2],[-6,-3],[-6,-4],[-7,-1],[-8,-1],[-9,-1],[-6,-7],[-6,-8],[-6,-9],[-7,-6],[-8,-6],[-9,-6],[1,-2],[1,-3],[1,-4],[2,-1],[3,-1],[4,-1],[2,-6],[3,-6],[4,-6],[1,-7],[1,-8],[1,-9],[6,-2],[6,-3],[6,-4],[7,-1],[8,-1],[9,-1],[6,-7],[6,-8],[6,-9],[7,-6],[8,-6],[9,-6],[-1,2],[-1,3],[-1,4],[-2,1],[-3,1],[-4,1],[-2,6],[-3,6],[-4,6],[-1,7],[-1,8],[-1,9],[-6,2],[-6,3],[-6,4],[-7,1],[-8,1],[-9,1],[-6,7],[-6,8],[-6,9],[-7,6],[-8,6],[-9,6],[1,2],[1,3],[1,4],[2,1],[3,1],[4,1],[2,6],[3,6],[4,6],[1,7],[1,8],[1,9],[6,2],[6,3],[6,4],[7,1],[8,1],[9,1],[6,7],[6,8],[6,9],[7,6],[8,6],[9,6]],
};
const PATTERN_NAMES = Object.keys(PATTERNS);

export class ConwayModule extends Module {
  constructor(glCanvas, id) {
    super('Conway', glCanvas, id);
    this.inputs = [];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      cellSize: { value: 4, min: 1, max: 16, step: 1 },
      speed: { value: 1, min: 1, max: 16, step: 1 },
      running: { value: 1, min: 0, max: 1, step: 1 }
    };

    this.simulationShader = glCanvas.createShader(this._getVertSrc(), conwaySimulationFrag);
    this.renderShader = glCanvas.createShader(this._getVertSrc(), conwayRenderFrag);

    this.fboA = glCanvas.createFramebuffer();
    this.fboB = glCanvas.createFramebuffer();
    this.currentBuffer = 0;

    this._clearFBO(this.fboA, glCanvas);
    this._clearFBO(this.fboB, glCanvas);

    this.createOutputFBO();

    this.currentPattern = 0;
    this.drawing = false;
    this.drawValue = 1;
    this.lastDrawX = -1;
    this.lastDrawY = -1;

    this.pendingSpawns = [];
    this.pendingClear = false;
    this.pendingRandomize = true;

    this.deadColor = [0.06, 0.06, 0.08];
    this.aliveColor = [0.15, 0.85, 0.45];
    this.startTime = performance.now();
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

  randomize() {
    this.pendingRandomize = true;
  }

  clear() {
    this.pendingClear = true;
  }

  spawnAt(px, py, value, radius = 2) {
    this.pendingSpawns.push({ x: px, y: py, value, radius });
  }

  spawnPattern(px, py, patternName) {
    const p = PATTERNS[patternName];
    if (!p) return;
    const cellSize = this.params.cellSize.value;
    for (const [dx, dy] of p) {
      this.spawnAt(px + dx * cellSize, py + dy * cellSize, 1, cellSize * 0.4);
    }
  }

  getPixelPos(canvasX, canvasY, canvasW, canvasH) {
    const aspect = 640 / 480;
    let dw = canvasW;
    let dh = canvasW / aspect;
    if (dh > canvasH) {
      dh = canvasH;
      dw = canvasH * aspect;
    }
    const dx = (canvasW - dw) / 2;
    const dy = (canvasH - dh) / 2;

    const relX = (canvasX - dx) / dw;
    const relY = (canvasY - dy) / dh;

    return [relX * this.glCanvas.width, relY * this.glCanvas.height];
  }

  handleMouseDown(mx, my, canvasW, canvasH, button) {
    const [px, py] = this.getPixelPos(mx, my, canvasW, canvasH);
    if (button === 'right') {
      this.spawnPattern(px, py, PATTERN_NAMES[this.currentPattern]);
      return;
    }
    this.drawing = true;
    this.drawValue = 1;
    this.spawnAt(px, py, this.drawValue, this.params.cellSize.value);
    this.lastDrawX = px;
    this.lastDrawY = py;
  }

  handleMouseDrag(mx, my, canvasW, canvasH) {
    if (!this.drawing) return;
    const [px, py] = this.getPixelPos(mx, my, canvasW, canvasH);
    const cellSize = this.params.cellSize.value;
    if (this.lastDrawX >= 0) {
      const dx = px - this.lastDrawX;
      const dy = py - this.lastDrawY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const steps = Math.max(1, Math.floor(dist / cellSize));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = this.lastDrawX + dx * t;
        const y = this.lastDrawY + dy * t;
        this.spawnAt(x, y, this.drawValue, cellSize);
      }
    }
    this.lastDrawX = px;
    this.lastDrawY = py;
  }

  handleMouseUp() {
    this.drawing = false;
    this.lastDrawX = -1;
    this.lastDrawY = -1;
  }

  handleWheel(delta) {
    const newSize = Math.max(1, Math.min(16, this.params.cellSize.value + (delta > 0 ? -1 : 1)));
    this.params.cellSize.value = newSize;
  }

  handleKey(key, keyCode, p) {
    if (key === ' ') {
      this.params.running.value = this.params.running.value > 0.5 ? 0 : 1;
    } else if (key === 'r' || key === 'R') {
      this.randomize();
    } else if (key === 'c' || key === 'C') {
      this.clear();
    } else if (key === 'p' || key === 'P') {
      this.currentPattern = (this.currentPattern + 1) % PATTERN_NAMES.length;
    } else if (key === '+' || key === '=') {
      this.params.speed.value = Math.min(16, this.params.speed.value * 2);
    } else if (key === '-' || key === '_') {
      this.params.speed.value = Math.max(1, Math.floor(this.params.speed.value / 2));
    }
  }

  getCurrentPatternName() {
    return PATTERN_NAMES[this.currentPattern];
  }

  process(graph, glCanvas) {
    const running = this.params.running.value > 0.5;
    const speed = Math.floor(this.params.speed.value);
    const time = (performance.now() - this.startTime) / 1000.0;

    const doSimStep = (spawn, spawnPos, spawnRadius, spawnValue, clear, randomize) => {
      const readFBO = this.currentBuffer === 0 ? this.fboA : this.fboB;
      const writeFBO = this.currentBuffer === 0 ? this.fboB : this.fboA;

      writeFBO.begin();
      glCanvas.clear();
      glCanvas.shader(this.simulationShader);
      this.simulationShader.setUniform('u_state', readFBO);
      this.simulationShader.setUniform('u_resolution', [glCanvas.width, glCanvas.height]);
      this.simulationShader.setUniform('u_spawn', spawn ? 1.0 : 0.0);
      this.simulationShader.setUniform('u_spawnPos', spawnPos);
      this.simulationShader.setUniform('u_spawnRadius', spawnRadius);
      this.simulationShader.setUniform('u_spawnValue', spawnValue);
      this.simulationShader.setUniform('u_clear', clear ? 1.0 : 0.0);
      this.simulationShader.setUniform('u_randomize', randomize ? 1.0 : 0.0);
      this.simulationShader.setUniform('u_time', time);
      this.renderQuad();
      writeFBO.end();

      this.currentBuffer = 1 - this.currentBuffer;
    };

    if (this.pendingClear) {
      doSimStep(false, [0, 0], 0, 0, true, false);
      this.pendingClear = false;
    }

    if (this.pendingRandomize) {
      doSimStep(false, [0, 0], 0, 0, false, true);
      this.pendingRandomize = false;
    }

    while (this.pendingSpawns.length > 0) {
      const spawn = this.pendingSpawns.shift();
      doSimStep(true, [spawn.x, spawn.y], spawn.radius, spawn.value, false, false);
    }

    if (running) {
      for (let i = 0; i < speed; i++) {
        doSimStep(false, [0, 0], 0, 0, false, false);
      }
    }

    const stateFBO = this.currentBuffer === 0 ? this.fboA : this.fboB;

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.renderShader);
    this.renderShader.setUniform('u_state', stateFBO);
    this.renderShader.setUniform('u_resolution', [glCanvas.width, glCanvas.height]);
    this.renderShader.setUniform('u_cellSize', this.params.cellSize.value);
    this.renderShader.setUniform('u_deadColor', this.deadColor);
    this.renderShader.setUniform('u_aliveColor', this.aliveColor);
    this.renderQuad();
    this.outputFBO.end();
  }

  dispose() {
    this.fboA = null;
    this.fboB = null;
    this.simulationShader = null;
    this.renderShader = null;
    super.dispose();
  }
}

registerModule('Conway', ConwayModule);
