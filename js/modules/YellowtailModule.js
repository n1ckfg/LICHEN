import { Module } from './Module.js';
import { passthroughFrag } from '../shaders/passthrough.js';
import { registerModule } from '../moduleRegistry.js';

class Vec3f {

    constructor(ix, iy, ip) {
    		this.x = 0;
        	this.y = 0;
        	this.p = 0; // Pressure

        	this.set(ix, iy, ip);
    }

    set(ix, iy, ip) {
        this.x = ix;
        this.y = iy;
        this.p = ip;
    }

}

class Polygon {

	constructor(n) {
        this.npoints = n;
        this.xpoints = new Array(n);
        this.ypoints = new Array(n); 		
	}

}



class Gesture {

    constructor(mw, mh) {
       	this.damp = 5.0;
    	this.dampInv = 1.0 / this.damp;
    	this.damp1 = this.damp - 1;

    	this.w = mw;
        this.h = mh;
        this.capacity = 600;

        this.path = new Array(this.capacity); // Vec3f
        this.polygons = new Array(this.capacity); // Polygon
        this.crosses = new Array(this.capacity); // int
        
        for (let i = 0; i < this.capacity; i++) {
            this.polygons[i] = new Polygon(4);
            this.path[i] = new Vec3f(0,0,0);
            this.crosses[i] = 0;
        }
        
        this.nPoints = 0;
        this.nPolys = 0;

        this.exists = false;
        this.jumpDx = 0;
        this.jumpDy = 0;

        this.INIT_TH = 14;
    	this.thickness = this.INIT_TH;
    }

    clear() {
        this.nPoints = 0;
        this.exists = false;
        this.thickness = this.INIT_TH;
    }

    clearPolys() {
        this.nPolys = 0;
    }

    addPoint(x, y) { // float
        if (this.nPoints >= this.capacity) {
            // there are all sorts of possible solutions here,
            // but for abject simplicity, I don't do anything.
        } else {
            var v = this.distToLast(x, y);
            var p = this.getPressureFromVelocity(v);

            // ~ ~ ~ ~ ~ ~ ~ ~
            this.path[this.nPoints++].set(x,y,p);
            // ~ ~ ~ ~ ~ ~ ~ ~

            if (this.nPoints > 1) {
                this.exists = true;
                this.jumpDx = this.path[this.nPoints-1].x - this.path[0].x;
                this.jumpDy = this.path[this.nPoints-1].y - this.path[0].y;
            }
        }
    }

    getPressureFromVelocity(v) { // float
        var scale = 18;
        var minP = 0.02;
        var oldP = (this.nPoints > 0) ? this.path[this.nPoints-1].p : 0;
        return ((minP + Math.max(0, 1.0 - v/scale)) + (this.damp1 * oldP)) * this.dampInv;
	}

    setPressures() {
        // pressures vary from 0...1
        var pressure; //float
        var tmp; // vec3f
        var t = 0; // float
        var u = 1.0 / (this.nPoints - 1) * (Math.PI * 2);
        
        for (let i = 0; i < this.nPoints; i++) {
            pressure = Math.sqrt((1.0 - Math.cos(t)) * 0.5);
            this.path[i].p = pressure;
            t += u;
        }
    }

    distToLast(ix, iy) {
        if (this.nPoints > 0) {
            var v = this.path[this.nPoints-1];
            var dx = v.x - ix;
            var dy = v.y - iy;
            return (function(a,b){return Math.sqrt(a*a+b*b);})(dx, dy);
        } else {
            return 30;
        }
    }

    compile() {
        // compute the polygons from the path of Vec3f's
        if (this.exists) {
            this.clearPolys();

            var p0, p1, p2;
            var radius0, radius1;
            var ax, bx, cx, dx;
            var ay, by, cy, dy;
            var axi, bxi, cxi, dxi, axip, axid;
            var ayi, byi, cyi, dyi, ayip, ayid;
            var p1x, p1y;
            var dx01, dy01, hp01, si01, co01;
            var dx02, dy02, hp02, si02, co02;
            var dx13, dy13, hp13, si13, co13;
            var taper = 1.0;

            var nPathPoints = this.nPoints - 1;
            var lastPolyIndex = nPathPoints - 1;
            var npm1finv = 1.0 / Math.max(1, nPathPoints - 1);

            // handle the first point
            p0 = this.path[0];
            p1 = this.path[1];
            radius0 = p0.p * this.thickness;
            dx01 = p1.x - p0.x;
            dy01 = p1.y - p0.y;
            hp01 = Math.sqrt(dx01*dx01 + dy01*dy01);
            
            if (hp01 == 0) {
                hp02 = 0.0001;
            }

            co01 = radius0 * dx01 / hp01;
            si01 = radius0 * dy01 / hp01;
            ax = p0.x - si01; 
            ay = p0.y + co01;
            bx = p0.x + si01; 
            by = p0.y - co01;

            var xpts = [];
            var ypts = [];

            var LC = 20;
            var RC = this.w-LC;
            var TC = 20;
            var BC = this.h-TC;
            var mint = 0.618;
            var tapow = 0.4;

            // handle the middle points
            var i = 1;
            var apoly; // Polygon

            for (let i = 1; i < nPathPoints; i++) {
                taper = Math.pow((lastPolyIndex - i) * npm1finv, tapow);

                p0 = this.path[i-1];
                p1 = this.path[i];
                p2 = this.path[i+1];
                p1x = p1.x;
                p1y = p1.y;
                radius1 = Math.max(mint, taper * p1.p * this.thickness);

                // assumes all segments are roughly the same length...
                dx02 = p2.x - p0.x;
                dy02 = p2.y - p0.y;
                hp02 = Math.sqrt(dx02 * dx02 + dy02 * dy02);
                
                if (hp02 != 0) {
                    hp02 = radius1/hp02;
                }
                
                co02 = dx02 * hp02;
                si02 = dy02 * hp02;

                // translate the integer coordinates to the viewing rectangle
                axi = axip = Math.floor(ax);
                ayi = ayip = Math.floor(ay);
                axi=(axi < 0) ? (this.w - (( -axi) % this.w)) : axi % this.w;
                axid = axi-axip;
                ayi=(ayi < 0) ? (this.h - (( -ayi) % this.h)) : ayi % this.h;
                ayid = ayi-ayip;

                // set the vertices of the polygon

                // ~ ~ ~ ~ ~ ~ ~ ~
                apoly = this.polygons[this.nPolys++];
                // ~ ~ ~ ~ ~ ~ ~ ~

                xpts = apoly.xpoints;
                ypts = apoly.ypoints;
                xpts[0] = axi = axid + axip;
                xpts[1] = bxi = axid + Math.floor(bx);
                xpts[2] = cxi = axid + Math.floor((cx = p1x + si02));
                xpts[3] = dxi = axid + Math.floor((dx = p1x - si02));
                ypts[0] = ayi = ayid + ayip;
                ypts[1] = byi = ayid + Math.floor(by);
                ypts[2] = cyi = ayid + Math.floor(cy = p1y - co02);
                ypts[3] = dyi = ayid + Math.floor(dy = p1y + co02);

                // keep a record of where we cross the edge of the screen
                this.crosses[i] = 0;
                if ((axi<=LC)||(bxi<=LC)||(cxi<=LC)||(dxi<=LC)) { 
                    this.crosses[i]|=1; 
                }
                if ((axi>=RC)||(bxi>=RC)||(cxi>=RC)||(dxi>=RC)) { 
                    this.crosses[i]|=2; 
                }
                if ((ayi<=TC)||(byi<=TC)||(cyi<=TC)||(dyi<=TC)) { 
                    this.crosses[i]|=4; 
                }
                if ((ayi>=BC)||(byi>=BC)||(cyi>=BC)||(dyi>=BC)) { 
                    this.crosses[i]|=8; 
                }

                //swap data for next time
                ax = dx; 
                ay = dy;
                bx = cx; 
                by = cy;
        	}

            // handle the last point
            p2 = this.path[nPathPoints];

            // ~ ~ ~ ~ ~ ~ ~ ~
            apoly = this.polygons[this.nPolys++];
            // ~ ~ ~ ~ ~ ~ ~ ~
            
            xpts = apoly.xpoints;
            ypts = apoly.ypoints;

            xpts[0] = Math.floor(ax);
            xpts[1] = Math.floor(bx);
            xpts[2] = Math.floor((p2.x));
            xpts[3] = Math.floor((p2.x));

            ypts[0] = Math.floor(ay);
            ypts[1] = Math.floor(by);
            ypts[2] = Math.floor((p2.y));
            ypts[3] = Math.floor((p2.y));

    	}
	}

	smooth() {
        // average neighboring points
        var weight = 18;
        var scale = 1.0 / (weight + 2);
        var nPointsMinusTwo = this.nPoints - 2;
        var lower, upper, center;

        for (let i = 1; i < nPointsMinusTwo; i++) {
            lower = this.path[i-1];
            center = this.path[i];
            upper = this.path[i+1];

            center.x = (lower.x + weight * center.x + upper.x) * scale;
            center.y = (lower.y + weight * center.y + upper.y) * scale;
        }
    }

}



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
    this._uiContainer.id = `yellowtail-ui-${this.id}`;
    this._uiContainer.style.cssText = `
      position: fixed;
      top: 12px;
      left: 170px;
      z-index: 1000;
      display: none;
      flex-direction: column;
      gap: 6px;
    `;

    const btnStyle = `
      background: #222;
      color: #eee;
      border: 1px solid #444;
      padding: 6px 14px;
      font: 13px monospace;
      cursor: pointer;
      border-radius: 4px;
    `;

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
    this._infoEl.style.cssText = `
      position: fixed;
      bottom: 12px;
      left: 170px;
      z-index: 1000;
      color: #888;
      font: 12px monospace;
      display: none;
    `;
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
