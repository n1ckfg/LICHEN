import { Module } from './Module.js';
import { gridguysSimulationFrag } from '../shaders/gridguys-simulation.js';
import { gridguysRenderFrag } from '../shaders/gridguys-render.js';
import { registerModule } from '../moduleRegistry.js';
import { Target } from './gridguys/target.js';

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
  constructor(glCanvas, id) {
    super('GridGuys', glCanvas, id);
    this.inputs = [];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      blend: { value: 1.0, min: 0, max: 1, step: 0.01 },
      delay: { value: 1, min: 0, max: 60, step: 1 },
      life: { value: 40, min: 1, max: 120, step: 1 },
      respawn: { value: 50, min: 1, max: 120, step: 1 },
      chaos: { value: 0.03, min: 0, max: 1, step: 0.01 }
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
    this.fboA = glCanvas.createFramebuffer();
    this.fboB = glCanvas.createFramebuffer();
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
    this.simulationShader.setUniform('u_resolution', [glCanvas.width, glCanvas.height]);
    this.simulationShader.setUniform('u_target', [this.target.posX, -this.target.posY]);
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
    this.renderShader.setUniform('u_resolution', [glCanvas.width, glCanvas.height]);
    this.renderShader.setUniform('u_time', time);
    this.renderShader.setUniform('u_blend', this.params.blend.value);
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

registerModule('GridGuys', GridGuysModule);
