import { Module } from './Module.js';
import { registerModule } from '../moduleRegistry.js';
import { passthroughFrag } from '../shaders/passthrough.js';

import { FB_WIDTH, FB_HEIGHT } from './grass/framebuffer.js';
import { GrassSession } from './grass/session.js';
import { serializeWorkspace } from './grass/script.js';

// The .grass scripts bundled in files/grass, in drop-down order after option 0.
// Patches save the preset as its index, so new files are appended, never inserted.
const PRESET_DIR = new URL('../../files/grass/', import.meta.url);
const PRESETS = [
  'lesson_01.grass',
  'lesson_02.grass',
  'lesson_03.grass',
  'lesson_04.grass',
  'lesson_05.grass',
  'lesson_06.grass',
  'lesson_07.grass',
  'lesson_08.grass',
  'lesson_09.grass',
  'lesson_10.grass',
  'lesson_11.grass',
];
const NO_FILE_LABEL = 'None';

// Preset index -> promise of its script text. Shared by every GRASS node.
const presetCache = new Map();
const presetAlerted = new Set();

function loadPreset(k) {
  if (!presetCache.has(k)) {
    const file = PRESETS[k];
    presetCache.set(k, fetch(new URL(file, PRESET_DIR))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .catch((err) => {
        presetCache.delete(k);
        throw err;
      }));
  }
  return presetCache.get(k);
}

export class GRASSModule extends Module {
  static uid = 'ca2234bc';

  constructor(glCanvas, id) {
    super('GRASS', glCanvas, id);
    this.inputs = [];
    this.outputs = [{ id: '0a9c', name: 'out', type: 'video' }];
    this.historicalInfo = 'GRASS';
    // Option 0 is the script loaded with the Load button, named after it once
    // there is one; the rest are the bundled lessons.
    this.params = {
      preset: {
        id: '0d9e', value: 0, min: 0, max: PRESETS.length, step: 1, label: 'File',
        widget: 'dropdown', valueLabels: [NO_FILE_LABEL, ...PRESETS],
      },
      // Lines a middleground macro runs a frame; .B macros share as many
      speed: { id: '1adf', value: 8, min: 1, max: 1000, step: 1, label: 'Speed' },
    };

    // p5.Image used to transfer framebuffer pixels to WebGL as a texture
    const p = glCanvas._pInst;
    this.fbImage = p.createImage(FB_WIDTH, FB_HEIGHT);
    this.fileName = '';      // the script loaded with the button, shown on it
    this.fileScript = null;  // { text, name } kept for option 0
    this._shownPreset = 0;   // the option the active session belongs to
    this._loadToken = 0;     // so a slow preset can't land after a newer choice
    this._disposed = false;

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

  _resetSession() {
    this.session.breakAll();
    this._startSession();
  }

  // Reset button: back to the state the module starts in. Every macro stops,
  // and the screen, terminal, prompt history, workspace (macros, variables,
  // arrays, snaps), palette and clock start over. The Speed knob, a patch
  // setting, stays where it is
  reset() {
    this._loadToken++;
    this._resetSession();
  }

  // BEEP: a tenth of a second of a soft square wave. Several BEEPs in one
  // frame sound as one. Silent where the page has no sound, or the browser
  // hasn't let it start yet
  _beep() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = this._audio || (this._audio = new AC());
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 880;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch (e) {
      // no sound
    }
  }

  // Follow the drop-down, whether a click or a cable moved it. Presets load
  // asynchronously; the previous session stays on until the new script arrives.
  _syncPreset() {
    const k = Math.max(0, Math.min(PRESETS.length, Math.round(this.params.preset.value)));
    if (k === this._shownPreset) return;
    this._shownPreset = k;
    const token = ++this._loadToken;
    if (k === 0) {
      this._resetSession();
      if (this.fileScript) this.loadScript(this.fileScript.text, this.fileScript.name);
      return;
    }
    const file = PRESETS[k - 1];
    loadPreset(k - 1).then(
      (text) => {
        if (!this._disposed && token === this._loadToken) {
          this._resetSession();
          this.loadScript(text, file);
        }
      },
      (e) => {
        console.error(`Could not load GRASS preset ${file}:`, e);
        // Once per preset, so a cable sweeping the menu can't stack alerts
        if (!presetAlerted.has(k)) {
          presetAlerted.add(k);
          alert(`Could not load ${file}: ${e.message}`);
        }
      },
    );
  }

  // Called every frame by the pipeline (always, regardless of fullscreen state)
  process(graph, glCanvas) {
    this._syncPreset();
    this.session.speed = Math.max(1, Math.round(this.params.speed.value));
    this.session.frame();
    if (this.terminal.beeps) {
      this.terminal.beeps = 0;
      this._beep();
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

  // Load button: pick a .grass script, store it in option 0, switch the menu
  // to it, reset the module (as the Reset button does), and run the script on
  // the fresh machine. Cancelling the file dialog changes nothing
  pickScript() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.grass,.GRASS,.txt';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) this.loadScriptFile(file);
    };
    input.click();
  }

  async loadScriptFile(file) {
    const token = ++this._loadToken;
    try {
      const text = await file.text();
      if (this._disposed || token !== this._loadToken) return;
      this.fileScript = { text, name: file.name };
      this.fileName = file.name;
      this.params.preset.valueLabels[0] = file.name || NO_FILE_LABEL;
      this.setParam('preset', 0);
      this._shownPreset = 0;
      this._loadToken++;
      this._resetSession();
      this.loadScript(text, file.name);
    } catch (e) {
      // Keep whatever session was running before
      alert(`Could not load ${file.name}: ${e.message}`);
    }
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

  // Is a macro holding the prompt?
  isBusy() {
    return this.session.isBusy();
  }

  // Stop button: break every running macro, keeping its place for Play
  stop() {
    this.session.stop();
  }

  // Play button: carry on with what Stop stopped
  play() {
    this.session.play();
  }

  // Route keyboard events when this module is fullscreened.
  // ESC exits fullscreen, and macros carry on running (main.js handles it
  // before this is called), except inside the EDIT macro editor, where ESC
  // saves the macro. CTRL+C stops every macro, .B and .F too, for good
  handleKey(key, keyCode, p) {
    // $CH is the last key typed: a character's code, or ENTER, BACKSPACE,
    // TAB and ESC's
    const typed = typeof key === 'string' && key.length === 1 ? key.charCodeAt(0)
      : ([8, 9, 13, 27].includes(keyCode) ? keyCode : null);
    if (typed !== null) this.session.keyTyped(typed);
    if (this.editor.active) {
      this.editor.handleKey(key, keyCode, p);
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
    this._disposed = true;
    this._loadToken++;
    this.fileScript = null;
    this.scheduler.killAll();
    this.fbImage = null;
    if (this._audio) this._audio.close().catch(() => {});
    this._audio = null;
    super.dispose();
  }
}

registerModule('GRASS', GRASSModule);
