const fs = require('fs');
const content = fs.readFileSync('/tmp/yt_main.js', 'utf8');

// We need to extract Vec3f, Polygon, Gesture
let gestureCode = content.match(/class Gesture {[\s\S]*?class Polygon/)[0].replace('class Polygon', '');
let polygonCode = content.match(/class Polygon {[\s\S]*?class Vec3f/)[0].replace('class Vec3f', '');
let vec3fCode = content.match(/class Vec3f {[\s\S]*}/)[0];

gestureCode = gestureCode.replace(/TWO_PI/g, '(Math.PI * 2)');
gestureCode = gestureCode.replace(/max\(/g, 'Math.max(');
gestureCode = gestureCode.replace(/min\(/g, 'Math.min(');
gestureCode = gestureCode.replace(/pow\(/g, 'Math.pow(');
gestureCode = gestureCode.replace(/floor\(/g, 'Math.floor(');
gestureCode = gestureCode.replace(/sqrt\(/g, 'Math.sqrt(');
gestureCode = gestureCode.replace(/cos\(/g, 'Math.cos(');
gestureCode = gestureCode.replace(/mag\(/g, '(function(a,b){return Math.sqrt(a*a+b*b);})(');

// Mag requires two args, so mag(dx, dy) => (function(a,b){return Math.sqrt(a*a+b*b);})(dx, dy)

const template = `import { Module } from './Module.js';
import { passthroughFrag } from '../shaders/passthrough.js';
import { registerModule } from '../moduleRegistry.js';

${vec3fCode}

${polygonCode}

${gestureCode}

export class YellowtailModule extends Module {
  constructor(glCanvas, id) {
    super('Yellowtail', glCanvas, id);
    this.outputs = [{ name: 'out', type: 'video' }];
    this.historicalInfo = "Yellowtail";

    this.params = {
      thickness: { value: 14, min: 2, max: 96, step: 1, label: 'Thickness' }
    };

    this.createShader(passthroughFrag);
    this.createOutputFBO();

    const p = this.glCanvas._pInst;
    this.w = this.glCanvas.width;
    this.h = this.glCanvas.height;
    this.pg = p.createGraphics(this.w, this.h);

    this.nGestures = 36;
    this.minMove = 3;
    this.currentGestureID = -1;
    this.gestureArray = [];
    for (let i = 0; i < this.nGestures; i++) {
      this.gestureArray[i] = new Gesture(this.w, this.h);
    }
    
    this.mouseIsDown = false;

    this._createFullscreenUI();
  }

  _createFullscreenUI() {
    this._uiContainer = document.createElement('div');
    this._uiContainer.id = \`yellowtail-ui-\${this.id}\`;
    this._uiContainer.style.cssText = \`
      position: fixed;
      top: 12px;
      left: 170px;
      z-index: 1000;
      display: none;
      flex-direction: column;
      gap: 6px;
    \`;

    const btnStyle = \`
      background: #222;
      color: #eee;
      border: 1px solid #444;
      padding: 6px 14px;
      font: 13px monospace;
      cursor: pointer;
      border-radius: 4px;
    \`;

    const createBtn = (label, onClick) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = btnStyle;
      btn.onmouseenter = () => btn.style.background = '#333';
      btn.onmouseleave = () => btn.style.background = '#222';
      btn.onclick = (e) => { e.stopPropagation(); onClick(); };
      return btn;
    };

    this._btnClear = createBtn('Clear', () => this.clearGestures());

    this._uiContainer.appendChild(this._btnClear);

    this._infoEl = document.createElement('div');
    this._infoEl.style.cssText = \`
      position: fixed;
      bottom: 12px;
      left: 170px;
      z-index: 1000;
      color: #888;
      font: 12px monospace;
      display: none;
    \`;
    this._infoEl.textContent = 'Click and drag to draw · ESC to exit';

    document.body.appendChild(this._uiContainer);
    document.body.appendChild(this._infoEl);
  }

  showFullscreenUI() {
    if (this._uiContainer) this._uiContainer.style.display = 'flex';
    if (this._infoEl) this._infoEl.style.display = 'block';
  }

  hideFullscreenUI() {
    if (this._uiContainer) this._uiContainer.style.display = 'none';
    if (this._infoEl) this._infoEl.style.display = 'none';
  }

  clearGestures() {
    for (let i = 0; i < this.nGestures; i++) {
      this.gestureArray[i].clear();
    }
  }

  getPixelPos(canvasX, canvasY, canvasW, canvasH) {
    const aspect = this.w / this.h;
    let dw = canvasW;
    let dh = canvasW / aspect;
    if (dh > canvasH) {
      dh = canvasH;
      dw = canvasH * aspect;
    }
    const dx = (canvasW - dw) / 2;
    const dy = (canvasH - dh) / 2;

    const relX = (canvasX - dx) / dw;
    const relY = (canvasY - dy) / dh;

    return [relX * this.w, relY * this.h];
  }

  handleMouseDown(mx, my, canvasW, canvasH, button) {
    const [px, py] = this.getPixelPos(mx, my, canvasW, canvasH);
    this.mouseIsDown = true;
    this.currentGestureID = (this.currentGestureID + 1) % this.nGestures;
    const G = this.gestureArray[this.currentGestureID];
    G.clear();
    G.clearPolys();
    G.addPoint(px, py);
  }

  handleMouseDrag(mx, my, canvasW, canvasH) {
    if (this.currentGestureID >= 0) {
      const [px, py] = this.getPixelPos(mx, my, canvasW, canvasH);
      const G = this.gestureArray[this.currentGestureID];
      if (G.distToLast(px, py) > this.minMove) {
        G.addPoint(px, py);
        G.smooth();
        G.compile();
      }
    }
  }

  handleMouseUp() {
    this.mouseIsDown = false;
  }

  handleKey(key, keyCode, p) {
    if (key === 'c' || key === 'C' || key === ' ') {
      this.clearGestures();
    }
  }

  advanceGesture(gesture) {
    if (gesture.exists) {
      const nPts = gesture.nPoints;
      const nPts1 = nPts - 1;
      let path = [];
      const jx = gesture.jumpDx;
      const jy = gesture.jumpDy;

      if (nPts > 0) {
        path = gesture.path;
        for (let i = nPts1; i > 0; i--) {
          path[i].x = path[i - 1].x;
          path[i].y = path[i - 1].y;
        }
        path[0].x = path[nPts1].x - jx;
        path[0].y = path[nPts1].y - jy;
        gesture.compile();
      }
    }
  }

  updateGeometry() {
    for (let g = 0; g < this.nGestures; g++) {
      const J = this.gestureArray[g];
      // Sync thickness with parameter
      J.thickness = this.params.thickness.value;
      
      if (J.exists) {
        if (g !== this.currentGestureID) {
          this.advanceGesture(J);
        } else if (!this.mouseIsDown) {
          this.advanceGesture(J);
        }
      }
    }
  }

  process(graph, glCanvas) {
    const p = glCanvas._pInst;
    const pg = this.pg;
    
    this.updateGeometry();

    pg.background(0);
    pg.noStroke();
    pg.fill(255, 255, 245);

    for (let i = 0; i < this.nGestures; i++) {
      const gesture = this.gestureArray[i];
      if (gesture.exists && gesture.nPolys > 0) {
        const polygons = gesture.polygons;
        const crosses = gesture.crosses;
        const gnp = gesture.nPolys;

        pg.beginShape(p.QUADS);
        for (let j = 0; j < gnp; j++) {
          const poly = polygons[j];
          const xpts = poly.xpoints;
          const ypts = poly.ypoints;

          pg.vertex(xpts[0], ypts[0]);
          pg.vertex(xpts[1], ypts[1]);
          pg.vertex(xpts[2], ypts[2]);
          pg.vertex(xpts[3], ypts[3]);

          const cr = crosses[j];
          if (cr > 0) {
            if ((cr & 3) > 0) {
              pg.vertex(xpts[0] + this.w, ypts[0]);
              pg.vertex(xpts[1] + this.w, ypts[1]);
              pg.vertex(xpts[2] + this.w, ypts[2]);
              pg.vertex(xpts[3] + this.w, ypts[3]);

              pg.vertex(xpts[0] - this.w, ypts[0]);
              pg.vertex(xpts[1] - this.w, ypts[1]);
              pg.vertex(xpts[2] - this.w, ypts[2]);
              pg.vertex(xpts[3] - this.w, ypts[3]);
            }
            if ((cr & 12) > 0) {
              pg.vertex(xpts[0], ypts[0] + this.h);
              pg.vertex(xpts[1], ypts[1] + this.h);
              pg.vertex(xpts[2], ypts[2] + this.h);
              pg.vertex(xpts[3], ypts[3] + this.h);

              pg.vertex(xpts[0], ypts[0] - this.h);
              pg.vertex(xpts[1], ypts[1] - this.h);
              pg.vertex(xpts[2], ypts[2] - this.h);
              pg.vertex(xpts[3], ypts[3] - this.h);
            }
          }
        }
        pg.endShape();
      }
    }

    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', pg);
    this.renderQuad();
    this.outputFBO.end();
  }

  dispose() {
    if (this._uiContainer && this._uiContainer.parentNode) {
      this._uiContainer.parentNode.removeChild(this._uiContainer);
    }
    if (this._infoEl && this._infoEl.parentNode) {
      this._infoEl.parentNode.removeChild(this._infoEl);
    }
    if (this.pg) this.pg.remove();
    super.dispose();
  }
}

registerModule('Yellowtail', YellowtailModule);
`;

fs.writeFileSync('js/modules/YellowtailModule.js', template);
