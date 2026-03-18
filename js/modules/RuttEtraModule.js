import { Module } from './Module.js';
import { passthroughFrag } from '../shaders/passthrough.js';
import { registerModule } from '../moduleRegistry.js';

// Vertex shader that samples input texture for displacement
const ruttEtraVert = `
precision highp float;

attribute vec3 aPosition;
attribute vec2 aTexCoord;

uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;

uniform sampler2D uInputTex;
uniform float uDepth;

varying vec3 vColor;

void main() {
  // Sample input texture for displacement
  vec4 texColor = texture2D(uInputTex, aTexCoord);

  // Calculate brightness
  float brightness = 0.34 * texColor.r + 0.5 * texColor.g + 0.16 * texColor.b;

  // Z displacement
  float z = -brightness * uDepth + uDepth * 0.5;

  vec3 pos = aPosition;
  pos.z = z;

  vColor = texColor.rgb;

  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(pos, 1.0);
}
`;

const ruttEtraFrag = `
precision highp float;

varying vec3 vColor;
uniform float uOpacity;

void main() {
  gl_FragColor = vec4(vColor * uOpacity, 1.0);
}
`;

export class RuttEtraModule extends Module {
  constructor(glCanvas, id) {
    super('RuttEtra', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.outputs = [{ name: 'out', type: 'video' }];
    this.params = {
      scale: { value: 1.0, min: 0.1, max: 4, step: 0.1, label: 'Scale' },
      scanStep: { value: 4, min: 1, max: 20, step: 1, label: 'Line Separation' },
      lineThickness: { value: 2.0, min: 0.5, max: 10, step: 0.5, label: 'Line Thickness' },
      opacity: { value: 1.0, min: 0, max: 1, step: 0.05, label: 'Brightness' },
      depth: { value: 80, min: 0, max: 300, step: 1, label: 'Max Line Depth' },
      rotationX: { value: 0.3, min: -1.5, max: 1.5, step: 0.05, label: 'Rotation X' },
      rotationY: { value: 0, min: -1.5, max: 1.5, step: 0.05, label: 'Rotation Y' },
    };

    this.width = glCanvas.width;
    this.height = glCanvas.height;

    // Create p5 shader using our custom vertex shader
    try {
      this.ruttShader = glCanvas.createShader(ruttEtraVert, ruttEtraFrag);
      this.gpuMode = true;
    } catch (e) {
      console.error('RuttEtra: Failed to create GPU shader, using fallback', e);
      this.gpuMode = false;
    }

    // Create passthrough shader and FBO
    this.createShader(passthroughFrag);
    this.createOutputFBO();

    // Geometry cache
    this.lastScanStep = -1;
    this.geometry = null;
  }

  _buildGeometry(scanStep) {
    const w = this.width;
    const h = this.height;
    const halfW = w / 2;
    const halfH = h / 2;
    const thickness = this.getParam('lineThickness') * 0.5;

    const cols = Math.floor(w / scanStep);
    const rows = Math.floor(h / scanStep);

    // Build as a p5.Geometry with triangle strips for each row
    // Each row is a ribbon: top and bottom vertices alternating
    this.geometry = new p5.Geometry(1, 1, function() {
      for (let row = 0; row < rows; row++) {
        const y = row * scanStep - halfH;

        for (let col = 0; col < cols; col++) {
          const x = col * scanStep - halfW;
          const u = (col * scanStep) / w;
          const v = (row * scanStep) / h;

          // Top vertex of ribbon
          this.vertices.push(new p5.Vector(x, y - thickness, 0));
          this.uvs.push([u, v]);

          // Bottom vertex of ribbon
          this.vertices.push(new p5.Vector(x, y + thickness, 0));
          this.uvs.push([u, v]);
        }
      }

      // Build triangle strip faces for each row
      for (let row = 0; row < rows; row++) {
        const rowStart = row * cols * 2;
        for (let col = 0; col < cols - 1; col++) {
          const i = rowStart + col * 2;
          // Two triangles per quad
          this.faces.push([i, i + 1, i + 2]);
          this.faces.push([i + 1, i + 3, i + 2]);
        }
      }

      this.computeNormals();
    });

    this.cols = cols;
    this.rows = rows;
    this.lastScanStep = scanStep;
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    if (!inputFBO) {
      this.outputFBO.begin();
      glCanvas.clear();
      this.outputFBO.end();
      return;
    }

    const scanStep = Math.round(this.getParam('scanStep'));

    // Rebuild geometry if needed
    if (scanStep !== this.lastScanStep) {
      this._buildGeometry(scanStep);
    }

    if (!this.geometry || !this.gpuMode) {
      // Fallback: passthrough
      this.outputFBO.begin();
      glCanvas.clear();
      glCanvas.shader(this.shader);
      this.shader.setUniform('tex0', inputFBO);
      this.renderQuad();
      this.outputFBO.end();
      return;
    }

    const scale = this.getParam('scale');
    const depth = this.getParam('depth');
    const opacity = this.getParam('opacity');
    const rotX = this.getParam('rotationX');
    const rotY = this.getParam('rotationY');

    // Render to output FBO
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.background(0);

    glCanvas.push();
    glCanvas.scale(scale);
    glCanvas.rotateX(rotX);
    glCanvas.rotateY(rotY);

    // Use our displacement shader
    glCanvas.shader(this.ruttShader);
    this.ruttShader.setUniform('uInputTex', inputFBO);
    this.ruttShader.setUniform('uDepth', depth);
    this.ruttShader.setUniform('uOpacity', opacity);

    // Enable additive blending
    glCanvas.blendMode(glCanvas.ADD);
    glCanvas.noStroke();

    // Draw the geometry
    glCanvas.model(this.geometry);

    glCanvas.blendMode(glCanvas.BLEND);
    glCanvas.pop();

    this.outputFBO.end();
  }

  dispose() {
    this.geometry = null;
    super.dispose();
  }
}

registerModule('RuttEtra', RuttEtraModule);
