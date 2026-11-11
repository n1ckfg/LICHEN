// session.js — one GRASS machine: screen, terminal, prompt, interpreter, and
// the queue of commands waiting to run. GRASSModule wraps it for p5; it needs
// no browser, so it can be driven a frame at a time anywhere.
//
// Commands typed at the prompt and commands read from a script go into one
// queue and run in order at the start of each frame. A command that starts a
// middleground macro (a line that is just a macro's name) holds the queue
// until the macro ends, as the UV-1 held the attention mark, so a script that
// runs a macro carries on only after it.

import { Framebuffer } from './framebuffer.js';
import { Palette } from './palette.js';
import { SpriteStore } from './sprites.js';
import { Terminal } from './terminal.js';
import { REPL } from './repl.js';
import { Editor } from './editor.js';
import { Environment } from './environment.js';
import { Interpreter } from './interpreter.js';
import { Scheduler } from './scheduler.js';
import { splitScript } from './script.js';

// Time a frame may spend starting queued commands, in ms
const QUEUE_BUDGET_MS = 8;

export class GrassSession {
  constructor() {
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

    // Lines a middleground macro runs a frame (background ones share as many)
    this.speed = 8;
    // Commands waiting to run: { text, line?, batch?, echo? } or { summary }
    this.queue = [];

    // Joystick 1, as the frame's caller last set it (setJoystick). A
    // joystick nobody touched this frame is let go: centred, trigger out.
    // The knob stays where it was turned
    this.joystick = { x: 0, y: 0, trigger: 0, knob: 0 };
    this._joystickHeld = false;

    // The REPL's echo of the line already showed it, so it isn't echoed again
    this.repl.onSubmit = (line) => this.queue.push({ text: line });
    this.scheduler.onError = (e, task) => this._report(e, task.origin, task.name);
  }

  // Is a middleground macro running, or a macro waiting for INPUT?
  isBusy() {
    return this.scheduler.isBusy() || this.repl.isWaitingForInput();
  }

  // Queue a script's commands, echoed as they run, then a summary line
  load(text, name = 'script') {
    const commands = splitScript(text);
    const batch = { name, count: commands.length, errors: 0 };
    this.terminal.println(`LOAD ${name}`);
    for (const { line, text: cmd } of commands) {
      this.queue.push({ text: cmd, line, batch, echo: true });
    }
    this.queue.push({ summary: batch });
  }

  // Set joystick 1 for this frame: x and y -1, 0 or 1, trigger 0 or 1, knob
  // -128..127
  setJoystick(x, y, trigger, knob) {
    this.joystick = { x, y, trigger, knob };
    this._joystickHeld = true;
  }

  // One frame (1/60 s): run what's queued, then the macros
  frame() {
    this.env.updateClock();

    if (!this._joystickHeld) {
      this.joystick = { ...this.joystick, x: 0, y: 0, trigger: 0 };
    }
    this._joystickHeld = false;
    const j = this.joystick;
    this.env.setDevice('$X1', j.x);
    this.env.setDevice('$Y1', j.y);
    this.env.setDevice('$T1', j.trigger);
    this.env.setDevice('$K1', j.knob);

    this.framebuffer.beginFrame();
    this._runQueue();
    try {
      this.scheduler.tick(this.interpreter, this.speed);
    } catch (e) {
      this.terminal.println('ERROR: ' + e.message);
    }
    this.framebuffer.endFrame();
    this.repl.busy = this.scheduler.isBusy() && !this.repl.isWaitingForInput();
  }

  // Start queued commands until one holds the queue, or the frame's time is up
  _runQueue() {
    const t0 = performance.now();
    while (this.queue.length > 0 && !this.isBusy() && !this.editor.active) {
      if (performance.now() - t0 > QUEUE_BUDGET_MS) break;
      const item = this.queue.shift();
      if (item.summary) {
        const b = item.summary;
        this.terminal.println(`Loaded ${b.name}: ${b.count} commands, ${b.errors} errors`);
        continue;
      }
      if (item.echo) {
        this.terminal.newline();
        const [first, ...more] = item.text.split('\n');
        this.terminal.println('> ' + first);
        for (const l of more) this.terminal.println('+ ' + l);
      }
      try {
        const task = this.interpreter.execTopLevel(item.text);
        if (task) task.origin = item;
      } catch (e) {
        this._report(e, item);
      }
    }
  }

  // Print an error with where it came from: its line in a script, and the
  // macro it was in
  _report(e, item, macroName) {
    const where = [];
    if (item && item.line) where.push(`line ${item.line}`);
    if (macroName) where.push(`in ${macroName}`);
    this.terminal.newline();
    this.terminal.println(`ERROR${where.length ? ` (${where.join(', ')})` : ''}: ${e.message}`);
    if (item && item.batch) item.batch.errors++;
  }

  // ESC: stop the middleground macro, or the macro waiting for INPUT. .B and
  // .F macros keep running, and queued commands carry on
  breakMacro() {
    if (this.repl.isWaitingForInput()) {
      this.repl.cancelInput();
      this.scheduler.killWaiting();
    }
    this.scheduler.killMiddleground();
    this.terminal.println('[BREAK]');
  }

  // CTRL+C: stop every macro, .B and .F too, and drop what's queued
  breakAll() {
    this.repl.cancelInput();
    this.scheduler.killAll();
    this.queue = [];
    this.terminal.println('[BREAK]');
  }
}
