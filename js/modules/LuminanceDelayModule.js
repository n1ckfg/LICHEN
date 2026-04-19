import { Module } from './Module.js';
import { atlasWriteFrag } from '../shaders/atlas-write.js';
import { luminanceDelayFrag } from '../shaders/luminance-delay.js';
import { vertSrc } from '../shaders/vert.js';
import { registerModule } from '../moduleRegistry.js';

const HISTORY = 64;
const COLS = 8;
const ROWS = 8;

export class LuminanceDelayModule extends Module {
  constructor(glCanvas, id) {
    super('LuminanceDelay', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      divisions: { value: 8, min: -12, max: 12, step: 1, label: 'Segments' },
      framesPerDivision: { value: 4, min: 1, max: 10, step: 1, label: 'Delay' },
      mirror: { value: 1, min: 0, max: 1, step: 1, label: 'Mirror' },
    };

    this.createShader(luminanceDelayFrag);
    this.createOutputFBO();
    this.writeShader = glCanvas.createShader(vertSrc, atlasWriteFrag);

    const tileW = Math.max(1, Math.floor(glCanvas.width / 4));
    const tileH = Math.max(1, Math.floor(glCanvas.height / 4));
    const atlasW = tileW * COLS;
    const atlasH = tileH * ROWS;

    this.atlasA = glCanvas.createFramebuffer({ width: atlasW, height: atlasH });
    this.atlasB = glCanvas.createFramebuffer({ width: atlasW, height: atlasH });
    this.atlasA.begin(); glCanvas.clear(); this.atlasA.end();
    this.atlasB.begin(); glCanvas.clear(); this.atlasB.end();

    this.frameOffset = 0;
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;

    const col = this.frameOffset % COLS;
    const row = Math.floor(this.frameOffset / COLS);

    this.atlasB.begin();
    glCanvas.clear();
    glCanvas.shader(this.writeShader);
    this.writeShader.setUniform('u_atlas', this.atlasA);
    this.writeShader.setUniform('u_input', inputFBO);
    this.writeShader.setUniform('u_tileSize', [1.0 / COLS, 1.0 / ROWS]);
    this.writeShader.setUniform('u_writeOrigin', [col / COLS, row / ROWS]);
    this.renderQuad();
    this.atlasB.end();

    const tmp = this.atlasA;
    this.atlasA = this.atlasB;
    this.atlasB = tmp;

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('u_atlas', this.atlasA);
    this.shader.setUniform('u_frameOffset', this.frameOffset);
    this.shader.setUniform('u_historySize', HISTORY);
    this.shader.setUniform('u_cols', COLS);
    this.shader.setUniform('u_rows', ROWS);
    this.shader.setUniform('u_divisions', Math.round(this.params.divisions.value));
    this.shader.setUniform('u_framesPerDivision', Math.round(this.params.framesPerDivision.value));
    this.shader.setUniform('u_mirror', this.params.mirror.value >= 0.5 ? 1.0 : 0.0);
    this.renderQuad();
    this.outputFBO.end();

    this.frameOffset = (this.frameOffset + 1) % HISTORY;
  }

  dispose() {
    this.atlasA = null;
    this.atlasB = null;
    this.writeShader = null;
    super.dispose();
  }
}

registerModule('LuminanceDelay', LuminanceDelayModule);
