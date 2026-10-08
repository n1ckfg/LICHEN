import { Module } from './Module.js';
import { passthroughFrag } from '../shaders/passthrough.js';
import { registerModule } from '../moduleRegistry.js';
import { NapDecoder } from './naplps/naplps.js';
import { polylinePieces, XYOutputs } from './latk/strokes.js';

const SAMPLE_RATE = 44100;   // of the X and Y outputs, as Latk's
const MAX_DT = 0.1;          // clamp long stalls so a tab switch doesn't jump the beam
const ARC_SEGMENTS = 72;     // a circle's sides on X and Y

// Plays back a NAPLPS (.nap) file, revealing each command's points in turn. Its
// X and Y outputs carry what is drawn as one loop of XY audio, as Latk's do,
// to drive Twoscilloscope.
export class NAPLPSModule extends Module {
  static uid = '3fd67525';

  constructor(glCanvas, id) {
    super('NAPLPS', glCanvas, id);
    this.outputs = [
      { id: '5a97', name: 'out', type: 'video' },
      { id: 'c7e5', name: 'x', type: 'control' },
      { id: '4e53', name: 'y', type: 'control' },
    ];
    this.historicalInfo = "NAPLPS";
    this.params = {
      speed: { id: '9a2d', value: 1, min: 0.1, max: 10, step: 0.1, label: 'Speed' },
      // Loops a second on X and Y. A lower rate gives the drawing more samples
      loopHz: { id: '48f2', value: 5, min: 1, max: 100, step: 0.1, label: 'Loop Hz' },
    };
    this.decoder = null;
    this.drawCmds = [];
    this.pg = null;
    this.napReady = false;
    this.xy = new XYOutputs(SAMPLE_RATE);
    this.lastTime = performance.now() / 1000;
    this.createShader(passthroughFrag);
    this.createOutputFBO();
    this._createFileInput();
  }

  _createFileInput() {
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.nap,.NAP';
    this.fileInput.style.display = 'none';
    document.body.appendChild(this.fileInput);
    this.fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.loadNAPFile(file);
    });
  }

  pickFile() {
    this.fileInput.click();
  }

  loadNAPFile(file) {
    const p = this.glCanvas._pInst;
    const reader = new FileReader();

    reader.onload = (e) => {
      const content = e.target.result;
      const w = this.glCanvas.width;
      const h = this.glCanvas.height;

      if (this.pg) this.pg.remove();
      this.pg = p.createGraphics(w, h);

      // Use NapDecoder directly (it expects input[0] to be the raw content)
      this.decoder = new NapDecoder([content]);

      // Create our own draw command state for each decoded command
      this.drawCmds = this.decoder.cmds.map(cmd => ({
        cmd: cmd,
        points: [],
        pointsIndex: 0,
        finished: false,
        markTime: 0,
        progressiveDrawInterval: 66
      }));

      this.napReady = true;
    };

    reader.readAsText(file);
  }

  process(graph, glCanvas) {
    const now = performance.now() / 1000;
    const dt = Math.min(Math.max(now - this.lastTime, 0), MAX_DT);
    this.lastTime = now;

    let pieces = [];
    if (this.decoder && this.napReady && this.pg) {
      // Adjust progressive draw speed based on param
      const interval = Math.max(1, Math.round(66 / this.params.speed.value));
      for (let dc of this.drawCmds) {
        dc.progressiveDrawInterval = interval;
      }

      // Draw NAPLPS content to the 2D graphics buffer
      pieces = this._drawToGraphics();

      // Render the 2D buffer to the WebGL output FBO
      this.outputFBO.begin();
      glCanvas.clear();
      glCanvas.shader(this.shader);
      this.shader.setUniform('tex0', this.pg);
      this.renderQuad();
      this.outputFBO.end();
    }

    // What was drawn as one loop of XY audio on the X and Y outputs. Before a
    // file is in, the loop is all blank, so the beam rests unlit in the middle.
    this.xy.publish(this, pieces, glCanvas.width, glCanvas.height, dt, this.params.loopHz.value);
  }

  // Draws every command into the 2D buffer, and returns the outlines of what it
  // drew as pieces for the X and Y outputs (see latk/strokes.js). The beam can't
  // fill, so filled shapes are traced as outlines, and text is left out.
  _drawToGraphics() {
    const pg = this.pg;
    const p = this.glCanvas._pInst;
    const w = this.glCanvas.width;
    const h = this.glCanvas.height;
    const now = performance.now();

    pg.background(0);
    pg.strokeWeight(1);

    // Track current color state
    let currentColor = pg.color(255, 255, 255);
    const pieces = [];

    // Process each draw command
    for (let i = 0; i < this.drawCmds.length; i++) {
      const dc = this.drawCmds[i];

      // Progressive point reveal (update)
      if (now > dc.markTime + dc.progressiveDrawInterval) {
        if (dc.pointsIndex < dc.cmd.points.length) {
          const point = dc.cmd.points[dc.pointsIndex];
          if (point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1) {
            dc.points.push(point);
          }
          dc.pointsIndex++;
          dc.markTime = now;
        } else if (!dc.finished) {
          dc.finished = true;
        }
      }

      currentColor = this._drawCmd(pg, dc, w, h, currentColor, p, pieces);
    }
    return pieces;
  }

  // Draws one command, adding its outline to pieces in the current colour
  _drawCmd(pg, dc, w, h, currentColor, p, pieces) {
    const cmd = dc.cmd;
    const points = dc.points;

    // Apply current color
    pg.fill(currentColor);
    pg.stroke(currentColor);
    const [r, g, b] = currentColor.levels;
    const outline = (pts) => {
      for (const piece of polylinePieces(pts, [r, g, b], w, h)) pieces.push(piece);
    };

    switch (cmd.opcode.id) {
      case 'Shift-In':
        pg.fill(255);
        pg.text(cmd.text, w * 0.0625, h * 0.1);
        break;

      case 'POINT SET ABS':
      case 'POINT SET REL':
      case 'POINT ABS':
      case 'POINT REL':
      case 'LINE ABS':
      case 'LINE REL':
      case 'SET & LINE ABS':
      case 'SET & LINE REL':
      case 'POLY OUTLINED':
      case 'SET & POLY OUTLINED':
        this._drawPoints(pg, points, w, h, false, p, outline);
        break;

      case 'POLY FILLED':
      case 'SET & POLY FILLED':
        this._drawPoints(pg, points, w, h, true, p, outline);
        break;

      case 'ARC OUTLINED':
      case 'SET & ARC OUTLINED':
        this._drawArc(pg, cmd.points, w, h, false, p, outline);
        break;

      case 'ARC FILLED':
      case 'SET & ARC FILLED':
        this._drawArc(pg, cmd.points, w, h, true, p, outline);
        break;

      case 'RECT OUTLINED':
      case 'SET & RECT OUTLINED':
        this._drawRect(pg, cmd.points, w, h, false, p, outline);
        break;

      case 'RECT FILLED':
      case 'SET & RECT FILLED':
        this._drawRect(pg, cmd.points, w, h, true, p, outline);
        break;

      case 'SET COLOR':
      case 'SELECT COLOR':
        if (cmd.col) {
          currentColor = pg.color(cmd.col.x, cmd.col.y, cmd.col.z);
        }
        break;

      default:
        break;
    }

    return currentColor;
  }

  _drawPoints(pg, points, w, h, isFill, p, outline) {
    if (points.length === 0) return;

    if (!isFill) {
      pg.noFill();
    }

    pg.beginShape();
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      pg.vertex(pt.x * w, pt.y * h);
    }
    if (points.length > 0) {
      pg.vertex(points[0].x * w, points[0].y * h);
    }
    pg.endShape(p.CLOSE);

    // The shape's outline, closed back to its first point as drawn
    const pts = points.map((pt) => ({ x: pt.x * w, y: pt.y * h }));
    pts.push(pts[0]);
    outline(pts);
  }

  _drawRect(pg, points, w, h, isFill, p, outline) {
    if (!isFill) {
      pg.noFill();
    }

    if (points.length >= 2) {
      const x1 = points[0].x * w;
      const y1 = points[0].y * h;
      const x2 = points[1].x * w;
      const y2 = points[1].y * h;
      pg.rectMode(p.CORNER);
      pg.rect(x1, y1, x2 - x1, y2 - y1);
      outline([{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }, { x: x1, y: y1 }]);
    }
  }

  _drawArc(pg, points, w, h, isFill, p, outline) {
    if (!isFill) {
      pg.noFill();
    }

    if (points.length >= 2) {
      const x1 = points[0].x * w;
      const y1 = points[0].y * h;
      const x2 = points[1].x * w;
      const y2 = points[1].y * h;
      pg.ellipseMode(p.CORNER);
      pg.ellipse(x1, y1, x2 - x1, x2 - x1);

      // p5 takes a negative size as positive, so the circle is always the
      // box from (x1, y1) down and to the right
      const r = Math.abs(x2 - x1) / 2;
      const cx = x1 + r, cy = y1 + r;
      const pts = [];
      for (let i = 0; i <= ARC_SEGMENTS; i++) {
        const a = i / ARC_SEGMENTS * 2 * Math.PI;
        pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
      outline(pts);
    }
  }

  dispose() {
    if (this.pg) this.pg.remove();
    if (this.fileInput) this.fileInput.remove();
    super.dispose();
  }
}

registerModule('NAPLPS', NAPLPSModule);
