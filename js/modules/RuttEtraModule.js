import { Module } from './Module.js';
import { vertSrc } from '../shaders/vert.js';
import { passthroughFrag } from '../shaders/passthrough.js';
import { turboToDepthFrag } from '../shaders/depth-anything.js';
import { registerModule } from '../moduleRegistry.js';
import { PixelReadback } from './slowscanjam/PixelReadback.js';
import { polylinePieces, XYOutputs } from './latk/strokes.js';

const SAMPLE_RATE = 44100;   // of the X and Y outputs, as Latk's
const MAX_DT = 0.1;          // clamp long stalls so a tab switch doesn't jump the beam
// Points per scan line on X and Y. Below a Line Separation of 4 a line has more
// vertices than this, and every few are used: the loop's samples are far sparser
const XY_MAX_COLS = 160;
// Depth Method's options
const LINEAR = 0;
const KINECT = 1;
const DEPTH_ANYTHING = 2;
// Depth Method Kinect's focal length: the Kinect v1 SDK's nominal depth focal
// length (NUI_CAMERA_DEPTH_NOMINAL_FOCAL_LENGTH_IN_PIXELS), which is for a
// 320 x 240 depth image, a horizontal FOV of 58.5 degrees. The buffer that
// displaces is the frame's size, so it is scaled to it on each axis
const KINECT_FOCAL = 285.63;
const KINECT_SIZE = [320, 240];
const ORBIT_RATE = 0.01;     // Latk's and Mesh's drag rate, radians per pixel
const ZOOM_RATE = 0.001;     // and their wheel: Scale x exp(-delta x ZOOM_RATE)

let nextGeometryId = 0;

// The pinhole camera a Depth Method unprojects the buffer that displaces
// through, as [cx, cy, fx, fy] in that buffer's px, with the principal point at
// its centre. Kinect's is the Kinect v1's, scaled to the buffer. DepthAnything's
// is the camera the input came from, whose horizontal FOV is the FOV knob: the
// depth model keeps no trace of it. Its pixels are taken as square
export function depthIntrinsics(method, [dw, dh], hfovDeg) {
  if (method === KINECT) {
    return [dw / 2, dh / 2, KINECT_FOCAL * dw / KINECT_SIZE[0], KINECT_FOCAL * dh / KINECT_SIZE[1]];
  }
  const f = (dw / 2) / Math.tan(hfovDeg * Math.PI / 360);
  return [dw / 2, dh / 2, f, f];
}

// How far along its ray a vertex is unprojected, from the brightness that
// displaces it. Kinect's brightness is raw depth. DepthAnything's is inverse
// depth, normalized so the frame's farthest point is 0 and its nearest 1, so
// depth is 1 / (brightness + shift), scaled here so the farthest point is at
// Max Line Depth. The shift is 1 / (Far/Near - 1): the map's normalizing
// leaves no other trace of how much farther the far end is than the near
export function depthDistance(method, brightness, maxDepth, shift) {
  return method === DEPTH_ANYTHING ? maxDepth * shift / (brightness + shift) : brightness * maxDepth;
}

// Far/Near to the shift above. A ratio of 1 or less would make it infinite
// or negative, so it is held just above 1
function disparityShift(farNear) {
  return 1 / Math.max(farNear - 1, 1e-3);
}

// Vertex shader that samples input texture for displacement. With withD, the
// brightness that displaces comes from the d input (uDTex) instead, and the
// colour still from the input. Uncabled d uses its own program, with no
// branch, so the input's lines come out as they did before d existed: a
// select between the two in one shader moved a few edge pixels in Chrome.
// With method Kinect, the brightness is raw depth, and each vertex is
// unprojected through a pinhole camera's intrinsics, as a Kinect's depth is,
// instead of being pushed straight back. With DepthAnything, the brightness is
// inverse depth (see depthDistance()), unprojected the same way. With Linear,
// the source is as it was before either
const ruttEtraVert = (withD, method) => {
  const kinect = method !== LINEAR;
  return `
precision highp float;

attribute vec3 aPosition;
attribute vec2 aTexCoord;

uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;

uniform sampler2D uInputTex;
${withD ? 'uniform sampler2D uDTex;' : ''}${kinect ? `
uniform vec2 uResolution;    // the displacing buffer's size, in px
uniform vec4 uIntrinsics;    // principal point (x, y) and focal lengths (z, w), in px
uniform float uFrameHeight;  // the frame's height, in px` : ''}${method === DEPTH_ANYTHING ? `
uniform float uShift;        // 1 / (Far/Near - 1)` : ''}
uniform float uDepth;
uniform float uHalfWidth;    // half of Line Thickness, in px

varying vec3 vColor;

void main() {
  // Sample input texture for colour, and for displacement without d
  vec4 texColor = texture2D(uInputTex, aTexCoord);
  vec4 dispColor = ${withD ? 'texture2D(uDTex, aTexCoord)' : 'texColor'};

  // Calculate brightness
  float brightness = 0.34 * dispColor.r + 0.5 * dispColor.g + 0.16 * dispColor.b;

${kinect ? `${method === KINECT ? `  // Kinect: the brightness is raw depth, scaled by Max Line Depth, and the
  // vertex's pixel is unprojected through the intrinsics. p5's y runs down,
  // as the texture's rows do, so y isn't flipped
  float zk = brightness * uDepth;` : `  // DepthAnything: the brightness is inverse depth, nearest 1 and farthest 0,
  // so the farthest is at Max Line Depth, and the vertex's pixel is unprojected
  // through the intrinsics. p5's y runs down, as the texture's rows do, so y
  // isn't flipped
  float zk = uDepth * uShift / (brightness + uShift);`}
  vec2 pixelCoord = aTexCoord * uResolution;
  float x = (pixelCoord.x - uIntrinsics.x) * zk / uIntrinsics.z;
  // The vertex's z says which edge of the ribbon it belongs to: -1 the top, 1
  // the bottom. Each edge is unprojected from its own row, half of Line
  // Thickness of the frame from the line's, so the line is that thick from the front
  float edgeV = aTexCoord.y + aPosition.z * uHalfWidth / uFrameHeight;
  float y = (edgeV * uResolution.y - uIntrinsics.y) * zk / uIntrinsics.w;

  // Further is further back, centred on z = 0 as Linear's lines are
  vec3 pos = vec3(x, y, -zk + uDepth * 0.5);` : `  // Z displacement
  float z = -brightness * uDepth + uDepth * 0.5;

  // A vertex sits on its line's centre, and its z says which edge of the
  // ribbon it belongs to: -1 the top, 1 the bottom
  vec3 pos = vec3(aPosition.x, aPosition.y + aPosition.z * uHalfWidth, z);`}

  vColor = texColor.rgb;

  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(pos, 1.0);
}
`;
};

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
// A second input, d, displaces the lines by its brightness instead of the
// input's, so DepthAnything's depth can push them back. Depth Format reads
// what displaces as DepthAnything's Grey or Turbo, and Depth Method pushes the
// lines straight back (Linear), or unprojects them as a Kinect's depth (Kinect)
// or as DepthAnything's inverse depth (DepthAnything).
export class RuttEtraModule extends Module {
  static uid = '4bc92c10';

  constructor(glCanvas, id) {
    super('RuttEtra', glCanvas, id);
    this.inputs = [
      { id: '870d', name: 'in', type: 'video' },
      { id: 'f6de', name: 'd', type: 'video' },
    ];
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
      // How what displaces holds depth: as brightness (Grey), or in
      // DepthAnything's Turbo colours, which are read back to depth first
      format: {
        id: 'ed57', value: 0, min: 0, max: 1, step: 1, label: 'Depth Format',
        widget: 'dropdown', valueLabels: ['Grey', 'Turbo'],
      },
      // Linear pushes each vertex straight back. Kinect unprojects it through
      // a pinhole camera, so further things spread wider, and DepthAnything
      // does too, reading the brightness as inverse depth
      method: {
        id: '5ed1', value: 0, min: 0, max: 2, step: 1, label: 'Depth Method',
        widget: 'dropdown', valueLabels: ['Linear', 'Kinect', 'DepthAnything'],
      },
      // Depth Method DepthAnything: the horizontal FOV of the camera the input
      // came from, and how many times farther its farthest point is than its nearest
      fov: { id: '2c59', value: 60, min: 20, max: 120, step: 1, label: 'FOV' },
      farNear: { id: '19b5', value: 4, min: 1.1, max: 20, step: 0.1, label: 'Far/Near' },
      rotationX: { id: 'dab3', value: 0.3, min: -1.5, max: 1.5, step: 0.05, label: 'Rotation X' },
      rotationY: { id: 'aea2', value: 0, min: -1.5, max: 1.5, step: 0.05, label: 'Rotation Y' },
      // Loops a second on X and Y. A lower rate gives the lines more samples
      loopHz: { id: '48b1', value: 5, min: 1, max: 100, step: 0.1, label: 'Loop Hz' },
    };

    this.width = glCanvas.width;
    this.height = glCanvas.height;

    // Create p5 shader using our custom vertex shader
    try {
      // [withD][method]. p5 compiles each the first time it is bound
      this.ruttShaders = [false, true].map((withD) => [LINEAR, KINECT, DEPTH_ANYTHING].map((method) =>
        glCanvas.createShader(ruttEtraVert(withD, method), ruttEtraFrag)));
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

    // Depth Format Turbo: what displaces, read back to depth as grey
    this.turboShader = glCanvas.createShader(vertSrc, turboToDepthFrag);
    this.turboFBO = null;
    // The displacing buffer's size, which Kinect and DepthAnything unproject with
    this.dispSize = [this.width, this.height];

    // X and Y: the vertices' brightness is read back from the GPU, so the
    // lines on X and Y are a frame or two behind the video's
    this.gridShader = glCanvas.createShader(vertSrc, ruttEtraGridFrag);
    this.gridFBO = null;
    this.readback = new PixelReadback(glCanvas);
    this.reading = null;      // the grid being read back
    this.grid = null;         // the latest grid read: { cols, rows, step, pixels }
    this.xy = new XYOutputs(SAMPLE_RATE);
    this.lastTime = performance.now() / 1000;

    // The last pointer position of a fullscreen drag, or null
    this.dragX = null;
    this.dragY = null;
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
    // What the lines are displaced by: d when it is cabled, else the input,
    // read back to depth first if it is in Turbo
    let dispFBO = this.getInput(graph, 1) || inputFBO;
    if (inputFBO && this.gpuMode && Math.round(this.getParam('format')) === 1) {
      dispFBO = this._turboToDepth(dispFBO, glCanvas);
    }
    const mvp = this._draw(inputFBO, dispFBO, glCanvas);
    const xy = this._xyCabled(graph);
    // Uncabled, nothing is read back, and the grid goes, so cabling X or Y
    // again starts from a blank loop rather than an old picture
    if (!mvp || !xy) this.grid = null;
    else if (!this.reading) this._startGrid(dispFBO, glCanvas);
    if (!xy) return;
    // With no lines, the loop is all blank, so the beam rests unlit in the middle
    const pieces = mvp ? this._linePieces(mvp) : [];
    this.xy.publish(this, pieces, this.width, this.height, dt, this.params.loopHz.value);
  }

  // Depth Method, rounded to an option as the menu's box does
  _method() {
    return Math.min(DEPTH_ANYTHING, Math.max(LINEAR, Math.round(this.getParam('method'))));
  }

  // X or Y cabled to a pin or a knob
  _xyCabled(graph) {
    const fromXY = (c) => c.fromId === this.id && this.outputs[c.fromPort]?.type === 'control';
    return graph.connections.some(fromXY) || graph.controlConnections.some(fromXY);
  }

  // Turbo colours to grey depth, in a buffer the size of the one they came in
  _turboToDepth(src, glCanvas) {
    const { width, height, density } = src;
    if (!this.turboFBO) {
      this.turboFBO = this.createFramebuffer({ width, height, density });
    } else if (this.turboFBO.width !== width || this.turboFBO.height !== height) {
      this.turboFBO.resize(width, height);
    }
    if (this.turboFBO.density !== density) this.turboFBO.pixelDensity(density);
    this.turboFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.turboShader);
    this.turboShader.setUniform('tex0', src);
    this.renderQuad();
    this.turboFBO.end();
    return this.turboFBO;
  }

  // Draws the scan lines into the output, and returns the matrix they were
  // drawn through (projection x model-view, column-major), or null if none were.
  // The lines are displaced by dispFBO's brightness: the input's, d's, or
  // either read back from Turbo
  _draw(inputFBO, dispFBO, glCanvas) {
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

    // The buffer's size in px, as X and Y unproject with it too
    this.dispSize = [dispFBO.width, dispFBO.height];
    const method = this._method();
    const intrinsics = method === LINEAR ? null : depthIntrinsics(method, this.dispSize, this.getParam('fov'));

    // Render to output FBO
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.background(0);

    // Kinect and DepthAnything are seen through the camera they unproject
    // with, from p5's eye, so from the front each line lies over its own pixels
    // at any depth. The shader puts a line at z = Max Line Depth / 2 - zk,
    // around its middle, so moving it Max Line Depth / 2 short of the eye puts
    // the unprojecting camera at the eye, and the knobs below turn and scale the
    // lines about their middle. The framebuffer's camera keeps its projection
    // between frames, so p5's is put back after drawing
    let eyeZ = 0;
    if (intrinsics) {
      const [, , fx, fy] = intrinsics;
      const [dw, dh] = this.dispSize;
      eyeZ = glCanvas._renderer._curCamera.eyeZ;
      // Unturned, a line zk away is zk x Scale + Max Line Depth / 2 x (1 - Scale)
      // from the eye, so the near plane is a thousandth of the nearest a line
      // can be. Turned, none is farther than the middle plus Scale times the
      // farthest corner of the depth range from it
      const tx = dw / 2 / fx, ty = dh / 2 / fy;
      const near = Math.max(1e-3 * Math.abs(scale * depth), 0.01);
      const far = Math.max(depth / 2 + Math.abs(scale * depth) * Math.sqrt(0.25 + tx * tx + ty * ty), near) * 1.01 + 1;
      glCanvas.perspective(2 * Math.atan(ty), tx / ty, near, far);
    }

    glCanvas.push();
    if (intrinsics) glCanvas.translate(0, 0, eyeZ - depth / 2);
    glCanvas.scale(scale);
    glCanvas.rotateX(rotX);
    glCanvas.rotateY(rotY);

    // Use our displacement shader, displaced by d when it is cabled
    const withD = dispFBO !== inputFBO;
    const shader = this.ruttShaders[+withD][method];
    glCanvas.shader(shader);
    shader.setUniform('uInputTex', inputFBO);
    if (withD) shader.setUniform('uDTex', dispFBO);
    if (intrinsics) {
      shader.setUniform('uResolution', this.dispSize);
      shader.setUniform('uIntrinsics', intrinsics);
      shader.setUniform('uFrameHeight', this.height);
    }
    if (method === DEPTH_ANYTHING) shader.setUniform('uShift', disparityShift(this.getParam('farNear')));
    shader.setUniform('uDepth', depth);
    shader.setUniform('uHalfWidth', this.getParam('lineThickness') * 0.5);
    shader.setUniform('uOpacity', opacity);

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
    if (intrinsics) glCanvas.perspective();

    this.outputFBO.end();
    return mvp;
  }

  // Read the brightness under every vertex back from the GPU, from what the
  // lines are displaced by (d when it is cabled, read back from Turbo if need be)
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
  // Max Line Depth and Depth Method, then goes through mvp. Clip space y = -1 is the top of the
  // output, since p5's framebuffer camera flips y. A line breaks where it goes
  // behind the camera or past its depth range, and is cut at the canvas edge.
  _linePieces(m) {
    if (!this.grid) return [];
    const { cols, rows, step, pixels } = this.grid;
    const w = this.width, h = this.height;
    const depth = this.getParam('depth');
    const method = this._method();
    const [dw, dh] = this.dispSize;
    const intrinsics = method === LINEAR ? null : depthIntrinsics(method, this.dispSize, this.getParam('fov'));
    const shift = disparityShift(this.getParam('farNear'));
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
        let x = col * step - w / 2;
        let z = -pixels[(row * cols + col) * 4] / 255 * depth + depth * 0.5;
        let yv = y;
        if (intrinsics) {
          // As ruttEtraVert's Kinect and DepthAnything: unprojected through the intrinsics
          const [cx, cy, fx, fy] = intrinsics;
          const zk = depthDistance(method, pixels[(row * cols + col) * 4] / 255, depth, shift);
          x = ((col * step) / w * dw - cx) * zk / fx;
          yv = ((row * step) / h * dh - cy) * zk / fy;
          z = -zk + depth * 0.5;
        }
        const cx = m[0] * x + m[4] * yv + m[8] * z + m[12];
        const cy = m[1] * x + m[5] * yv + m[9] * z + m[13];
        const cz = m[2] * x + m[6] * yv + m[10] * z + m[14];
        const cw = m[3] * x + m[7] * yv + m[11] * z + m[15];
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

  // ---------------------------------------------------------------- fullscreen

  // Dragging orbits, as in Latk and Mesh, by turning the Rotation Y and
  // Rotation X knobs. The lines follow the pointer: dragging right pushes
  // their right side back, and dragging down brings their top forward
  handleMouseDown(mx, my, canvasW, canvasH, button) {
    this.dragX = mx;
    this.dragY = my;
  }

  handleMouseDrag(mx, my, canvasW, canvasH) {
    if (this.dragX === null) return;
    this.setParam('rotationY', this.params.rotationY.value + (mx - this.dragX) * ORBIT_RATE);
    this.setParam('rotationX', this.params.rotationX.value - (my - this.dragY) * ORBIT_RATE);
    this.dragX = mx;
    this.dragY = my;
  }

  handleMouseUp() {
    this.dragX = null;
    this.dragY = null;
  }

  // The wheel zooms by turning the Scale knob: down, as in Mesh, moves away
  handleWheel(delta) {
    this.setParam('scale', this.params.scale.value * Math.exp(-delta * ZOOM_RATE));
  }

  // A double-click goes back to the home view, the knobs' defaults
  handleDoubleClick() {
    this.setParam('scale', 1);
    this.setParam('rotationX', 0.3);
    this.setParam('rotationY', 0);
  }

  // The scan lines are a grid over the frame, so it is built again
  frameResized(w, h) {
    this.width = w;
    this.height = h;
    this.lastScanStep = -1;
  }

  dispose() {
    if (this.geometry) this.glCanvas.freeGeometry(this.geometry);
    this.geometry = null;
    this.readback.dispose();
    if (this.gridFBO) this.gridFBO.remove();
    this.gridFBO = null;
    if (this.turboFBO) this.turboFBO.remove();
    this.turboFBO = null;
    super.dispose();
  }
}

registerModule('RuttEtra', RuttEtraModule);
