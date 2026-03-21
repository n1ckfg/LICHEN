import { Module } from './Module.js';
import { 
  unrealbloomHighPassFrag,
  unrealbloomBlurFrag,
  unrealbloomCompositeFrag
} from '../shaders/unrealbloom.js';
import { vertSrc } from '../shaders/vert.js';
import { registerModule } from '../moduleRegistry.js';

export class UnrealBloomModule extends Module {
  constructor(glCanvas, id) {
    super('UnrealBloom', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      threshold: { value: 0.8, min: 0.0, max: 1.0, step: 0.01, label: 'Threshold' },
      strength: { value: 1.5, min: 0.0, max: 5.0, step: 0.01, label: 'Strength' },
      radius: { value: 0.5, min: 0.0, max: 1.0, step: 0.01, label: 'Radius' },
    };

    this.createOutputFBO();

    // Create shaders for the multi-pass pipeline
    this.highPassShader = glCanvas.createShader(vertSrc, unrealbloomHighPassFrag);
    this.blurShader = glCanvas.createShader(vertSrc, unrealbloomBlurFrag);
    this.compositeShader = glCanvas.createShader(vertSrc, unrealbloomCompositeFrag);

    // Mipmap FBO chain (5 levels)
    this.nMips = 5;
    this.renderTargetsHorizontal = [];
    this.renderTargetsVertical = [];
    
    // Level 0 is half res
    let resx = Math.round(glCanvas.width / 2);
    let resy = Math.round(glCanvas.height / 2);

    // Need to use the options object for createFramebuffer in p5.js
    this.renderTargetBright = glCanvas.createFramebuffer({ width: resx, height: resy });

    for (let i = 0; i < this.nMips; i++) {
      this.renderTargetsHorizontal.push(glCanvas.createFramebuffer({ width: resx, height: resy }));
      this.renderTargetsVertical.push(glCanvas.createFramebuffer({ width: resx, height: resy }));
      
      resx = Math.max(1, Math.round(resx / 2));
      resy = Math.max(1, Math.round(resy / 2));
    }
    
    // Clear FBOs initially
    this.renderTargetBright.begin(); glCanvas.clear(); this.renderTargetBright.end();
    for (let i = 0; i < this.nMips; i++) {
      this.renderTargetsHorizontal[i].begin(); glCanvas.clear(); this.renderTargetsHorizontal[i].end();
      this.renderTargetsVertical[i].begin(); glCanvas.clear(); this.renderTargetsVertical[i].end();
    }
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;

    // 1. High Pass: Extract bright areas from the input
    this.renderTargetBright.begin();
    glCanvas.clear();
    glCanvas.shader(this.highPassShader);
    this.highPassShader.setUniform('tex0', inputFBO);
    this.highPassShader.setUniform('threshold', this.params.threshold.value);
    this.renderQuad();
    this.renderTargetBright.end();

    // 2. Blur Mip Chain: Progressively downsample and blur
    let inputTarget = this.renderTargetBright;
    
    for (let i = 0; i < this.nMips; i++) {
      const hTarget = this.renderTargetsHorizontal[i];
      const vTarget = this.renderTargetsVertical[i];

      // Horizontal Pass
      hTarget.begin();
      glCanvas.clear();
      glCanvas.shader(this.blurShader);
      this.blurShader.setUniform('tex0', inputTarget);
      this.blurShader.setUniform('texelSize', [1.0 / hTarget.width, 1.0 / hTarget.height]);
      this.blurShader.setUniform('direction', [1.0, 0.0]);
      this.renderQuad();
      hTarget.end();

      // Vertical Pass
      vTarget.begin();
      glCanvas.clear();
      glCanvas.shader(this.blurShader);
      this.blurShader.setUniform('tex0', hTarget);
      this.blurShader.setUniform('texelSize', [1.0 / vTarget.width, 1.0 / vTarget.height]);
      this.blurShader.setUniform('direction', [0.0, 1.0]);
      this.renderQuad();
      vTarget.end();

      // Next level reads from this level's vertical output
      inputTarget = vTarget;
    }

    // 3. Composite: Combine all mips over the original input
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.compositeShader);
    this.compositeShader.setUniform('tex0', inputFBO);
    
    for (let i = 0; i < this.nMips; i++) {
      this.compositeShader.setUniform(`blur${i + 1}`, this.renderTargetsVertical[i]);
    }
    
    this.compositeShader.setUniform('strength', this.params.strength.value);
    this.compositeShader.setUniform('radius', this.params.radius.value);
    this.renderQuad();
    this.outputFBO.end();
  }

  dispose() {
    this.renderTargetBright = null;
    this.renderTargetsHorizontal = null;
    this.renderTargetsVertical = null;
    this.highPassShader = null;
    this.blurShader = null;
    this.compositeShader = null;
    super.dispose();
  }
}

registerModule('UnrealBloom', UnrealBloomModule);
