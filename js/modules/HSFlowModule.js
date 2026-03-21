import { Module } from './Module.js';
import { 
  hsflowCalcFrag, 
  hsflowSlideFrag, 
  hsflowReposFrag, 
  hsflowCompositeFrag 
} from '../shaders/hsflow.js';
import { passthroughFrag } from '../shaders/passthrough.js';
import { vertSrc } from '../shaders/vert.js';
import { registerModule } from '../moduleRegistry.js';

export class HSFlowModule extends Module {
  constructor(glCanvas, id) {
    super('HSFlow', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      lambda: { value: 0.01, min: 0.001, max: 0.5, step: 0.001, label: 'Lambda' },
      flowScale: { value: 1.0, min: 0.1, max: 5.0, step: 0.01, label: 'Flow' },
      offset: { value: 1.0, min: 0.5, max: 5.0, step: 0.1, label: 'Offset' },
      distortAmt: { value: 1.0, min: 0.0, max: 10.0, step: 0.1, label: 'Distort' },
      slide: { value: 0.8, min: 0.0, max: 0.99, step: 0.01, label: 'Slide' },
      lumaThresh: { value: 0.5, min: 0.0, max: 1.0, step: 0.01, label: 'Luma Thr' },
      lumaTol: { value: 0.2, min: 0.0, max: 1.0, step: 0.01, label: 'Luma Tol' }
    };
    
    this.createOutputFBO();
    
    this.calcShader = glCanvas.createShader(vertSrc, hsflowCalcFrag);
    this.slideShader = glCanvas.createShader(vertSrc, hsflowSlideFrag);
    this.reposShader = glCanvas.createShader(vertSrc, hsflowReposFrag);
    this.compositeShader = glCanvas.createShader(vertSrc, hsflowCompositeFrag);
    this.copyShader = glCanvas.createShader(vertSrc, passthroughFrag);

    // FBOs for multi-pass video feedback pipeline
    this.prevFrameFBO = glCanvas.createFramebuffer();
    this.flowVectorFBO = glCanvas.createFramebuffer();
    this.smoothedFlowFBO = glCanvas.createFramebuffer();
    this.prevSmoothedFlowFBO = glCanvas.createFramebuffer();
    this.feedbackFBO = glCanvas.createFramebuffer();
    this.tempReposFBO = glCanvas.createFramebuffer();
    
    // Initialize FBOs to prevent undefined behavior on first frame
    [this.prevFrameFBO, this.flowVectorFBO, this.smoothedFlowFBO, this.prevSmoothedFlowFBO, this.feedbackFBO, this.tempReposFBO].forEach(fbo => {
      fbo.begin();
      glCanvas.clear();
      fbo.end();
    });
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) return;

    // 1. Calculate raw flow
    this.flowVectorFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.calcShader);
    this.calcShader.setUniform('tex0', inputFBO);
    this.calcShader.setUniform('tex1', this.prevFrameFBO);
    this.calcShader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
    this.calcShader.setUniform('lambda', this.params.lambda.value);
    this.calcShader.setUniform('flowScale', this.params.flowScale.value);
    this.calcShader.setUniform('offset', this.params.offset.value);
    this.renderQuad();
    this.flowVectorFBO.end();

    // 2. Smooth flow temporally
    this.smoothedFlowFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.slideShader);
    this.slideShader.setUniform('tex0', this.flowVectorFBO);
    this.slideShader.setUniform('tex1', this.prevSmoothedFlowFBO);
    this.slideShader.setUniform('slide', this.params.slide.value);
    this.renderQuad();
    this.smoothedFlowFBO.end();

    // 3. Displacement Pass 1 (feedback -> temp)
    this.tempReposFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.reposShader);
    this.reposShader.setUniform('tex0', this.feedbackFBO);
    this.reposShader.setUniform('tex1', this.smoothedFlowFBO);
    this.reposShader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
    this.reposShader.setUniform('distortAmt', this.params.distortAmt.value);
    this.renderQuad();
    this.tempReposFBO.end();

    // 4. Displacement Pass 2 (temp -> feedback)
    this.feedbackFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.reposShader);
    this.reposShader.setUniform('tex0', this.tempReposFBO);
    this.reposShader.setUniform('tex1', this.smoothedFlowFBO);
    this.reposShader.setUniform('uResolution', [glCanvas.width, glCanvas.height]);
    this.reposShader.setUniform('distortAmt', this.params.distortAmt.value);
    this.renderQuad();
    this.feedbackFBO.end();

    // 5. Composite Pass (Luma Key live over feedback)
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.compositeShader);
    this.compositeShader.setUniform('tex0', inputFBO);
    this.compositeShader.setUniform('tex1', this.feedbackFBO);
    this.compositeShader.setUniform('lumaThresh', this.params.lumaThresh.value);
    this.compositeShader.setUniform('lumaTol', this.params.lumaTol.value);
    this.renderQuad();
    this.outputFBO.end();

    // 6. Update History
    
    // Store current frame for next flow calculation
    this.prevFrameFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.copyShader);
    this.copyShader.setUniform('tex0', inputFBO);
    this.renderQuad();
    this.prevFrameFBO.end();

    // Store smoothed flow for next smoothing
    this.prevSmoothedFlowFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.copyShader);
    this.copyShader.setUniform('tex0', this.smoothedFlowFBO);
    this.renderQuad();
    this.prevSmoothedFlowFBO.end();
    
    // Store final composite back to feedback FBO for next frame's distortion
    this.feedbackFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.copyShader);
    this.copyShader.setUniform('tex0', this.outputFBO);
    this.renderQuad();
    this.feedbackFBO.end();
  }

  dispose() {
    this.prevFrameFBO = null;
    this.flowVectorFBO = null;
    this.smoothedFlowFBO = null;
    this.prevSmoothedFlowFBO = null;
    this.feedbackFBO = null;
    this.tempReposFBO = null;
    
    this.calcShader = null;
    this.slideShader = null;
    this.reposShader = null;
    this.compositeShader = null;
    this.copyShader = null;
    
    super.dispose();
  }
}

registerModule('HSFlow', HSFlowModule);
