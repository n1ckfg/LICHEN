import { Module } from './Module.js';
import { atlasWriteFrag } from '../shaders/atlas-write.js';
import { slitscanFrag } from '../shaders/slitscan.js';
import { vertSrc } from '../shaders/vert.js';
import { registerModule } from '../moduleRegistry.js';

const HISTORY = 64;
const COLS = 8;
const ROWS = 8;

export class SlitscanModule extends Module {
  static uid = 'a1091c0c';

  constructor(glCanvas, id) {
    super('Slitscan', glCanvas, id);
    this.inputs = [{ id: '5188', name: 'in', type: 'video' }];
    this.outputs = [{ id: 'b658', name: 'out', type: 'video' }];
    this.params = {
      strips: { id: 'c76f', value: 1.0, min: 0, max: 1, step: 0.001, label: 'Strips' },
      delay: { id: '04c3', value: 0.0, min: 0, max: 1, step: 0.001, label: 'Delay' },
      axis: { id: 'b3ed', value: 0, min: 0, max: 1, step: 1, label: 'Axis', widget: 'dropdown', valueLabels: ['Y', 'X'] },
      mirror: { id: '44fd', value: 1, min: 0, max: 1, step: 1, label: 'Mirror' },
    };

    this.createShader(slitscanFrag);
    this.createOutputFBO();
    this.writeShader = glCanvas.createShader(vertSrc, atlasWriteFrag);

    this.atlasA = this.createFramebuffer({ width: 1, height: 1 });
    this.atlasB = this.createFramebuffer({ width: 1, height: 1 });
    this._sizeAtlas(glCanvas.width, glCanvas.height);
  }

  // Tiles a quarter of the frame a side, so the atlas follows the frame's size
  _sizeAtlas(w, h) {
    const tileW = Math.max(1, Math.floor(w / 4));
    const tileH = Math.max(1, Math.floor(h / 4));
    for (const fbo of [this.atlasA, this.atlasB]) {
      fbo.resize(tileW * COLS, tileH * ROWS);
      fbo.begin(); this.glCanvas.clear(); fbo.end();
    }
    this.frameOffset = 0;
  }

  frameResized(w, h) {
    this._sizeAtlas(w, h);
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
    this.shader.setUniform('u_x1', this.params.strips.value);
    this.shader.setUniform('u_y1', this.params.delay.value);
    this.shader.setUniform('u_axis', this.params.axis.value >= 0.5 ? 1.0 : 0.0);
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

registerModule('Slitscan', SlitscanModule);
