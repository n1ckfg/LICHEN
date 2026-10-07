// Draws the segments of a point stream (see strokes.js) in LICHEN's own GL
// context: the Latk module's lines, and Twoscilloscope's lines and beams.
import { latkSegmentVert, latkLineFrag, LATK_BATCH } from '../../shaders/latk.js';

const POINT_TEX_W = 2048;    // point stream texels per row

let nextGeometryId = 0;

export class SegmentRenderer {

  // name labels the geometry's gid and any warning, as the module's type
  constructor(glCanvas, name) {
    this.glCanvas = glCanvas;
    this.name = name;
    this.lineShader = glCanvas.createShader(latkSegmentVert, latkLineFrag);
    this.geometry = this._buildGeometry();
    // The point stream, one point per texel. Float, since it holds positions and
    // 24-bit colours, and sized up on demand.
    this.pointFBO = glCanvas.createFramebuffer({
      width: POINT_TEX_W, height: 8, density: 1, depth: false,
      format: glCanvas.FLOAT, textureFiltering: glCanvas.NEAREST,
    });
    this.warnedNoFloat = false;
  }

  // One quad per segment in a batch. The vertex shader places every quad, so
  // this is built once and never re-uploaded.
  _buildGeometry() {
    const geometry = new p5.Geometry(1, 1, function () {
      for (let q = 0; q < LATK_BATCH; q++) {
        const base = this.vertices.length;
        this.vertices.push(
          new p5.Vector(-1, -1, q), new p5.Vector(1, -1, q),
          new p5.Vector(1, 1, q), new p5.Vector(-1, 1, q));
        this.faces.push([base, base + 1, base + 2], [base, base + 2, base + 3]);
      }
    });
    // p5 caches a geometry's GPU buffers under its gid (see Development Conventions)
    geometry.gid = `${this.name}|${nextGeometryId++}`;
    return geometry;
  }

  // A point stream's segments as lines width output pixels wide, round-ended.
  // density is the target framebuffer's pixel density.
  drawLines(stream, width, density) {
    const g = this.glCanvas;
    const pxToScope = 2 / g.height;   // one output pixel, in scope units
    const halfWidth = width / 2 * pxToScope;
    const feather = pxToScope / density;
    this.drawSegments(this.lineShader, stream, g.BLEND, (s) => {
      s.setUniform('uSize', halfWidth + feather);
      s.setUniform('uHalfWidth', halfWidth);
      s.setUniform('uFeather', feather);
    });
  }

  // Every segment of a point stream through shader s, which uses latkSegmentVert.
  // setUniforms sets the uniforms of s's own.
  drawSegments(s, stream, blend, setUniforms) {
    const g = this.glCanvas;
    const n = stream.count;
    if (n < 2 || !this._upload(stream.data, n)) return;

    g.noStroke();
    g.shader(s);
    s.setUniform('uTexSize', [this.pointFBO.width, this.pointFBO.height]);
    s.setUniform('uLast', n - 1);
    s.setUniform('uAspect', g.width / g.height);
    setUniforms(s);
    g.blendMode(blend);
    for (let base = 0; base < n - 1; base += LATK_BATCH) {
      // p5 points every sampler at an empty texture after each draw, so this
      // has to be set again for every batch
      s.setUniform('uPoints', this.pointFBO);
      s.setUniform('uBase', base);
      g.model(this.geometry);
    }
    g.blendMode(g.BLEND);
  }

  // p5 has no way to fill a texture from an array, so this writes straight into
  // pointFBO's colour texture, putting back the binding and unpack state it
  // touches, as SlowscanJam does
  _upload(data, n) {
    const g = this.glCanvas;
    const fbo = this.pointFBO;
    // Without float textures p5 falls back to 8 bits, which can't hold the stream
    if (fbo.format === g.UNSIGNED_BYTE) {
      if (!this.warnedNoFloat) console.warn(`${this.name}: this browser has no float framebuffers`);
      this.warnedNoFloat = true;
      return false;
    }
    const rows = Math.ceil(n / POINT_TEX_W);
    if (rows > fbo.height) fbo.resize(POINT_TEX_W, 1 << Math.ceil(Math.log2(rows)));

    const gl = g.drawingContext;
    const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const prevFlip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    const prevPremul = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, fbo.colorTexture);
    const full = Math.floor(n / POINT_TEX_W);
    const rest = n - full * POINT_TEX_W;
    if (full > 0) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, POINT_TEX_W, full, gl.RGBA, gl.FLOAT,
        data.subarray(0, full * POINT_TEX_W * 4));
    }
    if (rest > 0) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, full, rest, 1, gl.RGBA, gl.FLOAT,
        data.subarray(full * POINT_TEX_W * 4, n * 4));
    }
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlip);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, prevPremul);
    return true;
  }

  dispose() {
    if (this.geometry) this.glCanvas.freeGeometry(this.geometry);
    if (this.pointFBO) this.pointFBO.remove();
    this.geometry = null;
    this.pointFBO = null;
  }

}
