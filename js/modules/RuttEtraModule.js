import { Module } from './Module.js';
import { vertSrc } from '../shaders/vert.js';
import { passthroughFrag } from '../shaders/passthrough.js';
import { registerModule } from '../moduleRegistry.js';
import { PixelReadback } from './slowscanjam/PixelReadback.js';
import { polylinePieces, XYOutputs } from './latk/strokes.js';

const SAMPLE_RATE = 44100;   // of the X and Y outputs, as Latk's
const MAX_DT = 0.1;          // clamp long stalls so a tab switch doesn't jump the beam
// Points per scan line on X and Y. Below a Line Separation of 4 a line has more
// vertices than this, and every few are used: the loop's samples are far sparser
const XY_MAX_COLS = 160;

let nextGeometryId = 0;

// Vertex shader that samples input texture for displacement
const ruttEtraVert = `
precision highp float;

attribute vec3 aPosition;
attribute vec2 aTexCoord;

uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;

uniform sampler2D uInputTex;
uniform float uDepth;
uniform float uHalfWidth;    // half of Line Thickness, in px

varying vec3 vColor;

void main() {
  // Sample input texture for displacement
  vec4 texColor = texture2D(uInputTex, aTexCoord);

  // Calculate brightness
  float brightness = 0.34 * texColor.r + 0.5 * texColor.g + 0.16 * texColor.b;

  // Z displacement
  float z = -brightness * uDepth + uDepth * 0.5;

  // A vertex sits on its line's centre, and its z says which edge of the
  // ribbon it belongs to: -1 the top, 1 the bottom
  vec3 pos = vec3(aPosition.x, aPosition.y + aPosition.z * uHalfWidth, z);

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

// The brightness each vertex reads, one texel a vertex, for X and Y. Texel
// (col, row) samples the input where ruttEtraVert's vertex does, at
// (col, row) x Line Separation / canvas size. Its buffer has density 1, so
// gl_FragCoord counts texels, and row 0 is read back first, as is the top line.
const ruttEtraGridFrag = `
precision highp float;

uniform sampler2D uInputTex;
uniform vec2 uStep;          // Line Separation across the canvas, in uv

void main() {
  vec4 texColor = texture2D(uInputTex, floor(gl_FragCoord.xy) * uStep);
  float brightness = 0.34 * texColor.r + 0.5 * texColor.g + 0.16 * texColor.b;
  gl_FragColor = vec4(vec3(brightness), 1.0);
}
`;

// a x b, both 4 x 4 and column-major
function mat4Mult(a, b) {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

// Rutt-Etra scan lines: each row of the input is a line, pushed back by its
// brightness and seen in 3D. Its X and Y outputs carry the lines as one loop of
// XY audio, as Latk's do, to drive Twoscilloscope. That takes most of its time
// on the CPU, so it is done only while X or Y is cabled to something.
export class RuttEtraModule extends Module {
  static uid = '4bc92c10';

  constructor(glCanvas, id) {
    super('RuttEtra', glCanvas, id);
    this.inputs = [{ id: '870d', name: 'in', type: 'video' }];
    this.outputs = [
      { id: '0f5b', name: 'out', type: 'video' },
      { id: 'e4df', name: 'x', type: 'control' },
      { id: '2a4e', name: 'y', type: 'control' },
    ];
    this.params = {
      scale: { id: '9dbc', value: 1.0, min: 0.1, max: 4, step: 0.1, label: 'Scale' },
      scanStep: { id: '0515', value: 4, min: 1, max: 20, step: 1, label: 'Line Separation' },
      lineThickness: { id: 'b956', value: 2.0, min: 0.5, max: 10, step: 0.5, label: 'Line Thickness' },
      opacity: { id: '48fe', value: 1.0, min: 0, max: 1, step: 0.05, label: 'Brightness' },
      depth: { id: '74b6', value: 80, min: 0, max: 300, step: 1, label: 'Max Line Depth' },
      rotationX: { id: 'dab3', value: 0.3, min: -1.5, max: 1.5, step: 0.05, label: 'Rotation X' },
      rotationY: { id: 'aea2', value: 0, min: -1.5, max: 1.5, step: 0.05, label: 'Rotation Y' },
      // Loops a second on X and Y. A lower rate gives the lines more samples
      loopHz: { id: '48b1', value: 5, min: 1, max: 100, step: 0.1, label: 'Loop Hz' },
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
    // The scan lines are geometry, so the output keeps p5's MSAA and depth (see Framebuffers in ARCHITECTURE.md)
    this.outputFBO = glCanvas.createFramebuffer();

    // Geometry cache
    this.lastScanStep = -1;
    this.geometry = null;

    // X and Y: the vertices' brightness is read back from the GPU, so the
    // lines on X and Y are a frame or two behind the video's
    this.gridShader = glCanvas.createShader(vertSrc, ruttEtraGridFrag);
    this.gridFBO = null;
    this.readback = new PixelReadback(glCanvas);
    this.reading = null;      // the grid being read back
    this.grid = null;         // the latest grid read: { cols, rows, step, pixels }
    this.xy = new XYOutputs(SAMPLE_RATE);
    this.lastTime = performance.now() / 1000;
  }

  _buildGeometry(scanStep) {
    const w = this.width;
    const h = this.height;
    const halfW = w / 2;
    const halfH = h / 2;

    const cols = Math.floor(w / scanStep);
    const rows = Math.floor(h / scanStep);

    // model() caches GPU buffers under a geometry's gid (see Development
    // Conventions), so the geometry this replaces is freed
    if (this.geometry) this.glCanvas.freeGeometry(this.geometry);

    // Build as a p5.Geometry with triangle strips for each row
    // Each row is a ribbon: top and bottom vertices alternating. Both sit on
    // the line's centre, and ruttEtraVert moves them apart by Line Thickness,
    // so turning it needs no rebuild. Their z, which the shader replaces with
    // the brightness displacement, says which edge each is
    this.geometry = new p5.Geometry(1, 1, function() {
      for (let row = 0; row < rows; row++) {
        const y = row * scanStep - halfH;

        for (let col = 0; col < cols; col++) {
          const x = col * scanStep - halfW;
          const u = (col * scanStep) / w;
          const v = (row * scanStep) / h;

          // Top vertex of ribbon
          this.vertices.push(new p5.Vector(x, y, -1));
          this.uvs.push([u, v]);

          // Bottom vertex of ribbon
          this.vertices.push(new p5.Vector(x, y, 1));
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
    this.geometry.gid = `RuttEtra|${nextGeometryId++}`;
    // On a geometry's first draw, model() finds every edge and turns them all
    // into stroke geometry, though the lines are drawn with noStroke(). Given
    // one edge of its own, it doesn't look for the rest
    this.geometry.edges = [[0, 1]];

    this.cols = cols;
    this.rows = rows;
    this.lastScanStep = scanStep;
  }

  process(graph, glCanvas) {
    const now = performance.now() / 1000;
    const dt = Math.min(Math.max(now - this.lastTime, 0), MAX_DT);
    this.lastTime = now;

    if (this.reading) this._pollReadback();
    const inputFBO = this.getInput(graph, 0);
    const mvp = this._draw(inputFBO, glCanvas);
    const xy = this._xyCabled(graph);
    // Uncabled, nothing is read back, and the grid goes, so cabling X or Y
    // again starts from a blank loop rather than an old picture
    if (!mvp || !xy) this.grid = null;
    else if (!this.reading) this._startGrid(inputFBO, glCanvas);
    if (!xy) return;
    // With no lines, the loop is all blank, so the beam rests unlit in the middle
    const pieces = mvp ? this._linePieces(mvp) : [];
    this.xy.publish(this, pieces, this.width, this.height, dt, this.params.loopHz.value);
  }

  // X or Y cabled to a pin or a knob
  _xyCabled(graph) {
    const fromXY = (c) => c.fromId === this.id && this.outputs[c.fromPort]?.type === 'control';
    return graph.connections.some(fromXY) || graph.controlConnections.some(fromXY);
  }

  // Draws the scan lines into the output, and returns the matrix they were
  // drawn through (projection x model-view, column-major), or null if none were
  _draw(inputFBO, glCanvas) {
    if (!inputFBO) {
      this.outputFBO.begin();
      glCanvas.clear();
      this.outputFBO.end();
      return null;
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
      return null;
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
    this.ruttShader.setUniform('uHalfWidth', this.getParam('lineThickness') * 0.5);
    this.ruttShader.setUniform('uOpacity', opacity);

    // Enable additive blending
    glCanvas.blendMode(glCanvas.ADD);
    glCanvas.noStroke();

    // The matrices model() draws through, framebuffer camera included
    const renderer = glCanvas._renderer;
    const mvp = mat4Mult(renderer.uPMatrix.mat4, renderer.uMVMatrix.mat4);

    // Draw the geometry
    glCanvas.model(this.geometry);

    glCanvas.blendMode(glCanvas.BLEND);
    glCanvas.pop();

    this.outputFBO.end();
    return mvp;
  }

  // Read the brightness under every vertex back from the GPU
  _startGrid(input, glCanvas) {
    const { cols, rows } = this;
    const step = this.lastScanStep;
    if (!this.gridFBO) {
      this.gridFBO = this.createFramebuffer({ width: cols, height: rows, density: 1 });
    } else if (this.gridFBO.width !== cols || this.gridFBO.height !== rows) {
      this.gridFBO.resize(cols, rows);
    }
    this.gridFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.gridShader);
    this.gridShader.setUniform('uInputTex', input);
    this.gridShader.setUniform('uStep', [step / this.width, step / this.height]);
    this.renderQuad();
    this.gridFBO.end();

    // WebGL1 reads at once
    const grid = { cols, rows, step };
    const pixels = this.readback.start(this.gridFBO, cols, rows);
    if (pixels) this.grid = { ...grid, pixels };
    else this.reading = grid;
  }

  // Once a frame, until the grid is in
  _pollReadback() {
    const pixels = this.readback.poll();
    if (pixels === null) return;
    const grid = this.reading;
    this.reading = null;
    if (pixels) this.grid = { ...grid, pixels };
  }

  // Each scan line through its vertices' centres, as pieces in px of the canvas
  // for the X and Y outputs (see latk/strokes.js). Each vertex is pushed back
  // as ruttEtraVert pushes it, by the latest grid's brightness and the current
  // Max Line Depth, then goes through mvp. Clip space y = -1 is the top of the
  // output, since p5's framebuffer camera flips y. A line breaks where it goes
  // behind the camera or past its depth range, and is cut at the canvas edge.
  _linePieces(m) {
    if (!this.grid) return [];
    const { cols, rows, step, pixels } = this.grid;
    const w = this.width, h = this.height;
    const depth = this.getParam('depth');
    const stride = Math.ceil(cols / XY_MAX_COLS);
    const pieces = [];
    const flush = (run) => {
      if (run.length > 1) for (const piece of polylinePieces(run, null, w, h)) pieces.push(piece);
    };

    for (let row = 0; row < rows; row++) {
      const y = row * step - h / 2;
      let run = [];
      for (let c = 0; c < cols + stride - 1; c += stride) {
        const col = Math.min(c, cols - 1);
        const x = col * step - w / 2;
        const z = -pixels[(row * cols + col) * 4] / 255 * depth + depth * 0.5;
        const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
        const cz = m[2] * x + m[6] * y + m[10] * z + m[14];
        const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
        if (cw > 0 && cz >= -cw && cz <= cw) {
          run.push({ x: (cx / cw + 1) * 0.5 * w, y: (cy / cw + 1) * 0.5 * h });
        } else {
          flush(run);
          run = [];
        }
      }
      flush(run);
    }
    return pieces;
  }

  dispose() {
    if (this.geometry) this.glCanvas.freeGeometry(this.geometry);
    this.geometry = null;
    this.readback.dispose();
    if (this.gridFBO) this.gridFBO.remove();
    this.gridFBO = null;
    super.dispose();
  }
}

registerModule('RuttEtra', RuttEtraModule);
