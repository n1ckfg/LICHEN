import { Module } from './Module.js';
import { vertSrc } from '../shaders/vert.js';
import {
  inkMarkersPaperFrag, inkMarkersStrokeVert, inkMarkersStrokeFrag, inkMarkersBlendFrag,
} from '../shaders/inkmarkers.js';
import { InkMarkersPanel } from './inkmarkers/panel.js';
import { registerModule } from '../moduleRegistry.js';

// Ink Markers Studio's widths per tip, as multiples of Size, and pressure curves
const TIP_WIDTH = [1.5, 1.0, 1.2, 0.4];
const TIP_CURVE = [0.8, 0.7, 0.5, 1.2];
// The sketch's canvas was 1200 px wide. Its shaders' pixel offsets (spread,
// blur, paper grain) are kept as the same share of the frame by giving them
// a resolution of this width.
const SKETCH_WIDTH = 1200;

// Copic-style alcohol markers on paper, from the Ink Markers Studio sketch.
// Strokes are drawn in fullscreen with the mouse or a pen; its toolbar there
// sets the params, as the dials do.
export class InkMarkersModule extends Module {
  static uid = 'eec28b11';

  constructor(glCanvas, id) {
    super('InkMarkers', glCanvas, id);
    this.outputs = [{ id: 'b227', name: 'out', type: 'video' }];
    this.params = {
      tip: { id: '822b', value: 0, min: 0, max: 3, step: 1, label: 'Tip', widget: 'dropdown',
             valueLabels: ['Chisel', 'Bullet', 'Brush', 'Fine'], random: true },
      size: { id: '04de', value: 13, min: 1, max: 48, step: 1, label: 'Size', random: [3, 40] },
      flow: { id: '2ae9', value: 0.5, min: 0.1, max: 1, step: 0.01, label: 'Flow', random: [0.3, 1] },
      bleed: { id: 'c73d', value: 0.6, min: 0, max: 1, step: 0.01, label: 'Bleed', random: true },
      // Changing the paper starts a fresh sheet, as in the sketch, so Seed leaves it be
      paper: { id: '31e4', value: 2, min: 0, max: 3, step: 1, label: 'Paper', widget: 'dropdown',
               valueLabels: ['Smooth', 'Cold Press', 'Marker Pad', 'Kraft'] },
      r: { id: '48a6', value: 0, min: 0, max: 255, step: 1, label: 'R', random: true },
      g: { id: '577a', value: 0, min: 0, max: 255, step: 1, label: 'G', random: true },
      b: { id: 'f39a', value: 0, min: 0, max: 255, step: 1, label: 'B', random: true },
      clear: { id: '3736', value: 0, min: 0, max: 1, step: 1, label: 'Clear', widget: 'trigger' },
      reseed: { id: 'debd', value: 0, min: 0, max: 1, step: 1, label: 'Seed', widget: 'trigger' },
    };

    this.paperShader = glCanvas.createShader(vertSrc, inkMarkersPaperFrag);
    this.strokeShader = glCanvas.createShader(inkMarkersStrokeVert, inkMarkersStrokeFrag);
    this.blendShader = glCanvas.createShader(vertSrc, inkMarkersBlendFrag);

    this.paperFBO = this.createFramebuffer();
    // The wet stroke, built up from triangle strips, which MSAA smooths
    this.strokeFBO = glCanvas.createFramebuffer({ depth: false });
    // The sheet: finished strokes over paper, ping-ponged as each is baked in.
    // Alpha 0 is bare paper.
    this.accumA = this.createFramebuffer();
    this.accumB = this.createFramebuffer();
    this.createOutputFBO();

    this.w = glCanvas.width;
    this.h = glCanvas.height;

    // Strokes not yet baked, oldest first; only the last can still be drawing.
    // Each is { points, flow, bleed, lastRenderedIndex, ended }.
    this.strokes = [];
    this.active = null;
    this.lastX = 0;
    this.lastY = 0;
    this.lastPressure = 0.5;
    this._paperType = -1;
    this._pendingClear = true;
    this._dirty = true;
    this._bleed = this.params.bleed.value;

    // Pen pressure, from pointer events, which p5's mouse events don't carry.
    // Captured on window so the panel's stopPropagation doesn't hide them.
    this.pressure = 0.5;
    this.hasPressure = false;
    this._onPointer = (e) => {
      if (e.type === 'pointerdown') this.hasPressure = e.pressure !== 0.5 && e.pressure !== 0;
      this.pressure = this.hasPressure ? e.pressure : 0.5;
    };
    window.addEventListener('pointerdown', this._onPointer, true);
    window.addEventListener('pointermove', this._onPointer, true);

    this.panel = new InkMarkersPanel(this);
    this._frame = 0;
    this._shownAt = -1;
  }

  color255() {
    return [this.params.r.value, this.params.g.value, this.params.b.value];
  }

  // ui.js calls this every frame while the node is fullscreen
  showFullscreenUI() {
    this._shownAt = this._frame;
    this.panel.show();
  }

  hideFullscreenUI() {
    this.panel.hide();
    this.endStroke();
  }

  // Frame pixels under a point on the fullscreen canvas, letterboxed to 4:3 as ui.js draws it
  framePos(mx, my, canvasW, canvasH) {
    const aspect = this.w / this.h;
    let dw = canvasW, dh = canvasW / aspect;
    if (dh > canvasH) { dh = canvasH; dw = canvasH * aspect; }
    const dx = (canvasW - dw) / 2, dy = (canvasH - dh) / 2;
    return [(mx - dx) / dw * this.w, (my - dy) / dh * this.h];
  }

  _tip() {
    return Math.max(0, Math.min(3, Math.round(this.params.tip.value)));
  }

  _applyPressureCurve(p) {
    return Math.pow(p, TIP_CURVE[this._tip()]);
  }

  _pointSize(pressure) {
    return this.params.size.value * pressure * TIP_WIDTH[this._tip()];
  }

  // Flow and bleed are taken when a stroke starts, as in the sketch; tip and
  // colour are read as it is drawn
  startStroke(x, y, pressure) {
    this.endStroke();
    this.lastX = x;
    this.lastY = y;
    this.lastPressure = this._applyPressureCurve(pressure);
    this.active = {
      points: [{ x, y, pressure: this.lastPressure, size: this._pointSize(this.lastPressure) }],
      flow: this.params.flow.value,
      bleed: this.params.bleed.value,
      lastRenderedIndex: 0,
      ended: false,
    };
    this._bleed = this.active.bleed;
    this.strokes.push(this.active);
  }

  continueStroke(x, y, pressure) {
    const s = this.active;
    if (!s) return;
    const p = this._applyPressureCurve(pressure);
    const dx = x - this.lastX, dy = y - this.lastY;
    const dist = Math.hypot(dx, dy);
    // The sketch's 2 px spacing, at this frame's scale
    const minSpacing = 2 * this.w / SKETCH_WIDTH;
    if (dist > minSpacing) {
      const steps = Math.ceil(dist / minSpacing);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const pp = this.lastPressure + (p - this.lastPressure) * t;
        s.points.push({ x: this.lastX + dx * t, y: this.lastY + dy * t, pressure: pp, size: this._pointSize(pp) });
      }
    }
    this.lastX = x;
    this.lastY = y;
    this.lastPressure = p;
  }

  endStroke() {
    if (!this.active) return;
    this.active.ended = true;
    this.active = null;
  }

  handleMouseDown(mx, my, canvasW, canvasH, button) {
    if (button !== 'left') return;
    const [x, y] = this.framePos(mx, my, canvasW, canvasH);
    this.startStroke(x, y, this.pressure);
  }

  handleMouseDrag(mx, my, canvasW, canvasH) {
    const [x, y] = this.framePos(mx, my, canvasW, canvasH);
    this.continueStroke(x, y, this.pressure);
  }

  handleMouseUp() {
    this.endStroke();
  }

  handleWheel(delta) {
    this.setParam('size', this.params.size.value + (delta > 0 ? -1 : 1));
  }

  handleKey(key, keyCode, p) {
    const mod = p && (p.keyIsDown(p.CONTROL) || p.keyIsDown(91) || p.keyIsDown(93));
    if (key >= '1' && key <= '4') this.setParam('tip', parseInt(key) - 1);
    else if (key === '[') this.setParam('size', this.params.size.value - 2);
    else if (key === ']') this.setParam('size', this.params.size.value + 2);
    else if ((key === 's' || key === 'S') && mod) this.saveImage();
    else if ((key === 'c' || key === 'C') && !mod) this.clear();
  }

  clear() {
    this.strokes = this.active ? [this.active] : [];
    if (this.active) {
      this.active.points = [{ x: this.lastX, y: this.lastY, pressure: this.lastPressure, size: this._pointSize(this.lastPressure) }];
      this.active.lastRenderedIndex = 0;
    }
    this._pendingClear = true;
  }

  onTrigger(name) {
    if (name === 'reseed') this.randomize();
    else if (name === 'clear') this.clear();
  }

  triggerText(name) {
    return name === 'reseed' ? this.seed : '';
  }

  // The picture as a PNG, at the framebuffer's full size
  saveImage() {
    const fbo = this.outputFBO;
    fbo.loadPixels();
    const w = Math.round(fbo.width * fbo.density), h = Math.round(fbo.height * fbo.density);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Row 0 is already the top of the picture as the UI shows it
    ctx.putImageData(new ImageData(new Uint8ClampedArray(fbo.pixels), w, h), 0, 0);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `ink-markers-${stamp}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  }

  _sketchResolution() {
    return [SKETCH_WIDTH, SKETCH_WIDTH * this.h / this.w];
  }

  _renderPaper(g) {
    this.paperFBO.begin();
    g.blendMode(g.REPLACE);
    g.shader(this.paperShader);
    this.paperShader.setUniform('uResolution', this._sketchResolution());
    this.paperShader.setUniform('uSeed', Math.random() * 100);
    this.paperShader.setUniform('uPaperType', this._paperType);
    this.renderQuad();
    this.paperFBO.end();
  }

  _clearFBO(fbo, g) {
    fbo.begin();
    g.clear();
    fbo.end();
  }

  // One pass of a stroke's strip from startIdx, jittered by `jitter` of each
  // point's size for the sketch's second, organic pass
  _strokePass(g, s, startIdx, jitter) {
    const pts = s.points;
    g.beginShape(g.TRIANGLE_STRIP);
    for (let i = startIdx; i < pts.length; i++) {
      const pt = pts[i];
      const jx = jitter > 0 ? (Math.random() - 0.5) * jitter * pt.size : 0;
      const jy = jitter > 0 ? (Math.random() - 0.5) * jitter * pt.size : 0;
      const px = pt.x + jx, py = pt.y + jy;
      const half = pt.size * 0.5;
      const a = pts[i === 0 ? 0 : i - 1], b = pts[i === pts.length - 1 ? i : i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.001) continue;
      const nx = -dy / len, ny = dx / len;
      g.vertex(px + nx * half, py + ny * half, 0, 0, -1);
      g.vertex(px - nx * half, py - ny * half, 0, 0, 1);
    }
    g.endShape();
  }

  // Draws the points added since last time into the wet stroke
  _renderStroke(g, s) {
    if (s.points.length < 2) return;
    const startIdx = Math.max(0, s.lastRenderedIndex - 1);
    if (startIdx >= s.points.length - 1) return;
    this.strokeFBO.begin();
    g.blendMode(g.BLEND);
    g.noStroke();
    g.shader(this.strokeShader);
    this.strokeShader.setUniform('uSize', [this.w, this.h]);
    this.strokeShader.setUniform('uColor', this.color255().map(c => c / 255));
    this.strokeShader.setUniform('uFlow', s.flow);
    this.strokeShader.setUniform('uTipType', this._tip());
    this._strokePass(g, s, startIdx, 0);
    this._strokePass(g, s, startIdx, 0.3);
    this.strokeFBO.end();
    s.lastRenderedIndex = s.points.length;
    this._dirty = true;
  }

  _composite(g, target, accum, bleed) {
    target.begin();
    g.blendMode(g.REPLACE);
    g.shader(this.blendShader);
    this.blendShader.setUniform('uAccumulated', accum);
    this.blendShader.setUniform('uCurrentStroke', this.strokeFBO);
    this.blendShader.setUniform('uPaper', this.paperFBO);
    this.blendShader.setUniform('uBleedAmount', bleed);
    this.blendShader.setUniform('uResolution', this._sketchResolution());
    this.renderQuad();
    target.end();
  }

  // A finished stroke goes into the sheet, and the wet layer is wiped
  _bake(g, s) {
    this._composite(g, this.accumB, this.accumA, s.bleed);
    [this.accumA, this.accumB] = [this.accumB, this.accumA];
    this._clearFBO(this.strokeFBO, g);
    this._dirty = true;
  }

  process(graph, glCanvas) {
    const g = glCanvas;
    this._frame++;
    // Leaving fullscreen any way but ESC (a patch loaded over it, say) still hides the toolbar
    if (this.panel.visible && this._shownAt < this._frame - 1) this.hideFullscreenUI();

    const paper = Math.max(0, Math.min(3, Math.round(this.params.paper.value)));
    if (paper !== this._paperType) {
      this._paperType = paper;
      this._renderPaper(g);
      this.clear();
    }
    if (this._pendingClear) {
      this._pendingClear = false;
      this._clearFBO(this.strokeFBO, g);
      this._clearFBO(this.accumA, g);
      this._dirty = true;
    }

    while (this.strokes.length > 0) {
      const s = this.strokes[0];
      this._renderStroke(g, s);
      if (!s.ended) break;
      // A click with no drag leaves nothing to bake
      if (s.lastRenderedIndex > 0) this._bake(g, s);
      this.strokes.shift();
    }

    if (!this._dirty) return;
    this._dirty = false;
    this._composite(g, this.outputFBO, this.accumA, this._bleed);
  }

  dispose() {
    window.removeEventListener('pointerdown', this._onPointer, true);
    window.removeEventListener('pointermove', this._onPointer, true);
    this.panel.dispose();
    this.paperFBO = this.strokeFBO = this.accumA = this.accumB = null;
    this.paperShader = this.strokeShader = this.blendShader = null;
    super.dispose();
  }
}

registerModule('InkMarkers', InkMarkersModule);
