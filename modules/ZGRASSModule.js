import { Module } from './Module.js';
import { registerModule } from '../moduleRegistry.js';
import { passthroughFrag } from '../shaders/passthrough.js';

import { Framebuffer, FB_WIDTH, FB_HEIGHT } from './zgrass/framebuffer.js';
import { Palette } from './zgrass/palette.js';
import { SpriteStore } from './zgrass/sprites.js';
import { Terminal } from './zgrass/terminal.js';
import { REPL } from './zgrass/repl.js';
import { Editor } from './zgrass/editor.js';
import { Environment } from './zgrass/environment.js';
import { Interpreter } from './zgrass/interpreter.js';
import { Scheduler } from './zgrass/scheduler.js';

export class ZGRASSModule extends Module {
  constructor(glCanvas, id) {
    super('ZGRASS', glCanvas, id);
    this.inputs = [];
    this.outputs = [{ name: 'out', type: 'video' }];

    // FakeGRASS subsystem
    this.framebuffer = new Framebuffer();
    this.palette = new Palette();
    this.spriteStore = new SpriteStore();
    this.terminal = new Terminal();
    this.repl = new REPL(this.terminal);
    this.editor = new Editor(this.terminal);
    this.env = new Environment();
    this.scheduler = new Scheduler();
    this.interpreter = new Interpreter(
      this.env, this.framebuffer, this.palette,
      this.spriteStore, this.terminal, this.repl, this.scheduler
    );
    this.interpreter._editor = this.editor;

    this.repl.onSubmit = (line) => {
      try {
        this.interpreter.execLine(line);
      } catch (e) {
        this.terminal.println('ERROR: ' + e.message);
      }
    };

    // p5.Image used to transfer framebuffer pixels to WebGL as a texture
    const p = glCanvas._pInst;
    this.fbImage = p.createImage(FB_WIDTH, FB_HEIGHT);

    this.createShader(passthroughFrag);
    this.createOutputFBO();

    this.terminal.println('ZGRASS — UV-1 Emulator');
    this.terminal.println('Double-click to enter. ESC to exit.');
    this.terminal.println('');
  }

  // Called every frame by the pipeline (always, regardless of fullscreen state)
  process(graph, glCanvas) {
    this.env.updateClock();
    try {
      this.scheduler.tick(this.interpreter);
    } catch (e) {
      this.terminal.println('ERROR: ' + e.message);
      this.scheduler.killCurrent();
    }

    // Build p5.Image from framebuffer + palette lookup
    this._updateFBImage();

    // Render the clean image to this module's outputFBO
    this.outputFBO.begin();
    glCanvas.clear();
    glCanvas.shader(this.shader);
    this.shader.setUniform('tex0', this.fbImage);
    this.renderQuad();
    this.outputFBO.end();
  }

  // Transfer ZGRASS 2-bit framebuffer pixels into a p5.Image via palette lookup
  _updateFBImage() {
    const img = this.fbImage;
    const fb = this.framebuffer;
    const pal = this.palette;

    img.loadPixels();
    const d = img.pixels;

    for (let by = 0; by < FB_HEIGHT; by++) {
      for (let bx = 0; bx < FB_WIDTH; bx++) {
        const fbIdx = by * FB_WIDTH + bx;
        const colorVal = fb.pixels[fbIdx] & 3;
        const rgba = pal.getColor(colorVal, bx);
        const pIdx = fbIdx * 4;
        d[pIdx]     = rgba[0];
        d[pIdx + 1] = rgba[1];
        d[pIdx + 2] = rgba[2];
        d[pIdx + 3] = 255;
      }
    }

    img.updatePixels();
  }

  // Route keyboard events when this module is fullscreened.
  // ESC when editor is inactive exits fullscreen (handled by sketch.js before this is called).
  // ESC when editor is active saves the macro (handled here by forwarding to editor).
  handleKey(key, keyCode, p) {
    if (this.editor.active) {
      this.editor.handleKey(key, keyCode, p);
      return;
    }
    // ESC with no active editor: kill running tasks (fullscreen exit handled by sketch.js)
    if (keyCode === p.ESCAPE || keyCode === 27) {
      this.scheduler.killAll();
      this.terminal.println('[BREAK]');
      return;
    }
    // Track last key in $K1 device variable
    if (key && key.length === 1) {
      this.env.setDevice('$K1', key.charCodeAt(0));
    }
    this.repl.handleKey(key, keyCode, p);
  }

  // Render terminal + REPL overlays on the main p5 canvas.
  // Called from ui.js when this module is in fullscreen mode.
  renderOverlays(p) {
    if (this.editor.active) {
      this.editor.render(p, p.width, p.height);
    } else {
      const layout = this.terminal.render(p, p.width, p.height);
      this.repl.render(p, layout, p.width, p.height);
    }
  }

  // Convert main canvas mouse coordinates to ZGRASS coordinate space and update device vars.
  // Called from ui.js when this module is fullscreened.
  updateMouseFromCanvas(mx, my, canvasW, canvasH) {
    const scaleX = canvasW / FB_WIDTH;
    const scaleY = canvasH / FB_HEIGHT;
    const scale = Math.min(scaleX, scaleY);
    const w = Math.floor(FB_WIDTH * scale);
    const h = Math.floor(FB_HEIGHT * scale);
    const ox = Math.floor((canvasW - w) / 2);
    const oy = Math.floor((canvasH - h) / 2);

    const bx = Math.floor((mx - ox) / scale);
    const by = Math.floor((my - oy) / scale);
    const zx = Math.max(-160, Math.min(159, bx - 160));
    const zy = Math.max(-100, Math.min(100, 100 - by));

    this.env.setDevice('$X1', zx);
    this.env.setDevice('$Y1', zy);
  }

  dispose() {
    this.scheduler.killAll();
    this.fbImage = null;
    super.dispose();
  }
}

registerModule('ZGRASS', ZGRASSModule);
