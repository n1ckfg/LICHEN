import { Module } from './Module.js';
import { registerModule } from '../moduleRegistry.js';
import { passthroughFrag } from '../shaders/passthrough.js';

import { FB_WIDTH, FB_HEIGHT } from './grass/framebuffer.js';
import { GrassSession } from './grass/session.js';
import { serializeWorkspace } from './grass/script.js';

export class GRASSModule extends Module {
  static uid = 'ca2234bc';

  constructor(glCanvas, id) {
    super('GRASS', glCanvas, id);
    this.inputs = [];
    this.outputs = [{ id: '0a9c', name: 'out', type: 'video' }];
    this.historicalInfo = 'GRASS';
    this.params = {
      // Lines a middleground macro runs a frame; .B macros share as many
      speed: { id: '1adf', value: 8, min: 1, max: 1000, step: 1, label: 'Speed' },
    };

    // p5.Image used to transfer framebuffer pixels to WebGL as a texture
    const p = glCanvas._pInst;
    this.fbImage = p.createImage(FB_WIDTH, FB_HEIGHT);

    this.createShader(passthroughFrag);
    this.createOutputFBO();

    this._startSession();
  }

  // A fresh GRASS machine, with its parts under the names the UI uses
  _startSession() {
    this.session = new GrassSession();
    this.framebuffer = this.session.framebuffer;
    this.palette = this.session.palette;
    this.terminal = this.session.terminal;
    this.repl = this.session.repl;
    this.editor = this.session.editor;
    this.env = this.session.env;
    this.scheduler = this.session.scheduler;
    this.interpreter = this.session.interpreter;

    this.terminal.println('GRASS — UV-1 Emulator');
    this.terminal.println('Double-click to enter. ESC to exit.');
    this.terminal.println('');
  }

  // Reset button: back to the state the module starts in. Every macro stops,
  // and the screen, terminal, prompt history, workspace (macros, variables,
  // arrays, snaps), palette and clock start over. The Speed knob, a patch
  // setting, stays where it is
  reset() {
    this.session.breakAll();
    this._startSession();
  }

  // Called every frame by the pipeline (always, regardless of fullscreen state)
  process(graph, glCanvas) {
    this.session.speed = Math.max(1, Math.round(this.params.speed.value));
    this.session.frame();

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

  // Transfer what the TV shows this frame (framebuffer.shown) into a p5.Image
  // via palette lookup
  _updateFBImage() {
    const img = this.fbImage;
    const shown = this.framebuffer.shown;
    const pal = this.palette;

    img.loadPixels();
    const d = img.pixels;

    for (let by = 0; by < FB_HEIGHT; by++) {
      for (let bx = 0; bx < FB_WIDTH; bx++) {
        const fbIdx = by * FB_WIDTH + bx;
        const colorVal = shown[fbIdx] & 3;
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

  // Load button: pick a .grass script, reset the module (as the Reset button
  // does), and run the script on the fresh machine. Cancelling the file
  // dialog changes nothing
  pickScript() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.grass,.GRASS,.txt';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) file.text().then(text => {
        this.reset();
        this.loadScript(text, file.name);
      });
    };
    input.click();
  }

  // Queue a script's commands, to run in order as if each were typed at the
  // prompt (see GrassSession). Adds to what is there; the Load button resets
  // first
  loadScript(text, name = 'script') {
    this.session.load(text, name);
  }

  // Save button: download the workspace (macros, variables and arrays) as a
  // .grass script, which Load runs to define them all again
  saveScript() {
    const { text, skipped } = serializeWorkspace(this.env);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = `lichen-grass_${timestamp}.grass`;
    a.click();
    URL.revokeObjectURL(url);
    const count = this.env.globals.size + this.env.arrays.size - skipped.length;
    this.terminal.println(`Saved ${count} names to ${a.download}`);
    if (skipped.length) this.terminal.println(`Not saved (no delimiter fits): ${skipped.join(', ')}`);
  }

  // Is a macro holding the prompt? ESC then stops it instead of leaving
  isBusy() {
    return this.session.isBusy();
  }

  // Route keyboard events when this module is fullscreened.
  // ESC with nothing running exits fullscreen (handled by main.js before this
  // is called). ESC inside the EDIT macro editor saves the macro, and ESC
  // while a macro runs stops it. CTRL+C stops every macro, .B and .F too
  handleKey(key, keyCode, p) {
    if (this.editor.active) {
      this.editor.handleKey(key, keyCode, p);
      return;
    }
    if (keyCode === p.ESCAPE || keyCode === 27) {
      this.session.breakMacro();
      return;
    }
    if ((key === 'c' || key === 'C') && p.keyIsDown(p.CONTROL)) {
      this.session.breakAll();
      return;
    }
    // While a macro runs, the arrow keys are only the joystick
    const arrow = keyCode === p.LEFT_ARROW || keyCode === p.RIGHT_ARROW ||
      keyCode === p.UP_ARROW || keyCode === p.DOWN_ARROW;
    if (arrow && this.repl.busy) return;
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

  // Joystick 1, from the keyboard and mouse. Called from ui.js every frame
  // this module is fullscreened; out of fullscreen the stick is let go.
  // The arrow keys push it ($X1, $Y1: -1, 0 or 1), the mouse button is the
  // trigger ($T1), and the mouse's position across the screen turns the knob
  // ($K1: -128 at the left edge to 127 at the right)
  updateJoystick(p) {
    const x = (p.keyIsDown(p.RIGHT_ARROW) ? 1 : 0) - (p.keyIsDown(p.LEFT_ARROW) ? 1 : 0);
    const y = (p.keyIsDown(p.UP_ARROW) ? 1 : 0) - (p.keyIsDown(p.DOWN_ARROW) ? 1 : 0);
    const trigger = p.mouseIsPressed ? 1 : 0;
    const t = p.width > 0 ? Math.max(0, Math.min(1, p.mouseX / p.width)) : 0.5;
    const knob = Math.max(-128, Math.min(127, Math.round(t * 255 - 128))) || 0; // no -0
    this.session.setJoystick(x, y, trigger, knob);
  }

  dispose() {
    this.scheduler.killAll();
    this.fbImage = null;
    super.dispose();
  }
}

registerModule('GRASS', GRASSModule);
