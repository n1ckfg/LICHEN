// scheduler.js — FG/MG/BG cooperative task scheduling
// Foreground (.F): runs through once a frame, or once every TIMEOUT frames
// Middleground (a macro typed at the prompt): runs `budget` lines a frame,
//   holds the prompt until it ends, and suspends .B macros meanwhile
// Background (.B): `budget` lines a frame in all, one line each in turn

export class Scheduler {
  constructor() {
    // Task queues
    this.foreground = [];
    this.middleground = [];
    this.background = [];
    this.bgIndex = 0;        // Round-robin index for background

    // Lines a middleground macro runs a frame, and background ones share,
    // unless tick() is given another budget
    this.mgLinesPerFrame = 8;
    // A .F task's TIMEOUT n sets its own task.timeout, in frames

    // Called as onError(error, task) when a task fails; the task stops and
    // the rest carry on. Without it the error is thrown out of tick()
    this.onError = null;

    // Flags
    this.breakRequested = false;
  }

  // Add a task. mib is the task's own macro frame, which holds its locals,
  // its arguments for INPUT and its ONERROR label, and lasts as long as it
  // runs, so a .B macro's locals carry over each time it starts again
  addTask(type, name, lines, args, mib = null) {
    const task = {
      name,
      lines,
      pc: 0,
      args: args || [],
      mib,
      done: false,
      loop: (type === 'FG' || type === 'BG'), // FG/BG tasks loop
      labels: this.parseLabels(lines),
      sleep: 0,        // frames still to wait (WAIT)
      yielded: false,  // WAIT ends this frame's lines
    };

    switch (type) {
      case 'FG': this.foreground.push(task); break;
      case 'BG': this.background.push(task); break;
      default:   this.middleground.push(task); break;
    }
    return task;
  }

  // Parse labels from lines (label is a number prefix on a line)
  parseLabels(lines) {
    const labels = new Map();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const match = line.match(/^(\d+\w*)(\s|$)/);
      if (match) {
        labels.set(match[1].toUpperCase(), i);
      }
    }
    return labels;
  }

  // Is a middleground macro running (or waiting for INPUT)?
  isBusy() {
    return this.middleground.length > 0;
  }

  // A task sleeping off a WAIT skips the frame
  _sleeping(task) {
    if (task.sleep > 0) { task.sleep--; return true; }
    return false;
  }

  // Run fn for task, stopping only that task if it fails
  _guard(task, fn) {
    try {
      fn();
    } catch (e) {
      task.done = true;
      if (this.onError) this.onError(e, task);
      else throw e;
    }
  }

  // Main tick — called each frame
  tick(interpreter, budget = this.mgLinesPerFrame) {
    this.breakRequested = false;
    budget = Math.max(1, Math.floor(budget));

    // Run all foreground tasks through once, or once every TIMEOUT frames
    for (let i = this.foreground.length - 1; i >= 0; i--) {
      if (this.breakRequested) break;
      const task = this.foreground[i];
      if (this._sleeping(task)) continue;
      if (task.cooldown > 0) { task.cooldown--; continue; }
      this._guard(task, () => this.runTaskFully(task, interpreter));
      if (task.timeout) task.cooldown = task.timeout - 1;
      if (task.done) this.foreground.splice(i, 1);
    }

    // A middleground macro has the machine; .B macros wait until it ends
    if (this.middleground.length > 0) {
      const task = this.middleground[0];
      if (!this.breakRequested && !this._sleeping(task)) {
        this._guard(task, () => this.runTaskLines(task, interpreter, budget));
      }
      if (task.done && this.middleground[0] === task) this.middleground.shift();
      return;
    }

    // Background: budget lines in all, one line from each task in turn
    const bg = this.background;
    const ready = new Set(bg.filter(t => !this._sleeping(t)));
    let lines = 0;
    let idle = 0;
    while (bg.length > 0 && lines < budget && idle < bg.length && !this.breakRequested) {
      const i = this.bgIndex % bg.length;
      const task = bg[i];
      this.bgIndex++;
      if (!ready.has(task) || task._waitingForInput || task.yielded || task.done) {
        idle++;
        continue;
      }
      idle = 0;
      this._guard(task, () => this.runTaskLines(task, interpreter, 1, false));
      lines++;
      if (task.done) bg.splice(i, 1);
    }
    for (const t of bg) t.yielded = false;
    for (let i = bg.length - 1; i >= 0; i--) {
      if (bg[i].done) bg.splice(i, 1);
    }
  }

  // Run a task through to the end of its lines once
  runTaskFully(task, interpreter) {
    const maxSteps = 10000; // Safety limit
    let steps = 0;
    while (task.pc < task.lines.length && !task.done && !this.breakRequested && steps < maxSteps &&
           !task._waitingForInput && !task.yielded) {
      this.executeTaskLine(task, interpreter);
      steps++;
    }
    const paused = task._waitingForInput || task.yielded || task.sleep > 0;
    task.yielded = false;
    // FG tasks loop for next frame
    if (task.pc >= task.lines.length && task.loop) {
      task.pc = 0;
    } else if (task.pc >= task.lines.length && !paused) {
      task.done = true;
    }
  }

  // Run up to n lines of a task. A WAIT, or waiting for INPUT, ends them
  // early. clearYield false leaves a WAIT's yield set until the frame's end
  runTaskLines(task, interpreter, n, clearYield = true) {
    for (let i = 0; i < n && !task.done && !this.breakRequested; i++) {
      if (task._waitingForInput || task.yielded) break;
      if (task.pc >= task.lines.length) {
        // Background and foreground tasks loop — restart when reaching end
        if (task.loop) task.pc = 0;
        else break;
      }
      this.executeTaskLine(task, interpreter);
    }
    // A task paused on its last line (WAIT, INPUT) ends only after the pause
    const paused = task._waitingForInput || task.yielded || task.sleep > 0;
    if (clearYield) task.yielded = false;
    if (!paused && task.pc >= task.lines.length && !task.loop) task.done = true;
  }

  // Execute one line of a task
  executeTaskLine(task, interpreter) {
    // Paused waiting for user input
    if (task._waitingForInput) return;

    if (task.pc >= task.lines.length) {
      task.done = true;
      return;
    }

    const line = task.lines[task.pc].trim();
    task.pc++;

    // In GRASS, lines starting with . are comments
    if (line === '' || line.startsWith('.')) return;

    // Strip label prefix for execution (a label may stand alone on its line)
    const execLine = line.replace(/^\d+\w*(\s+|$)/, '');
    if (execLine.trim() === '') return;

    const env = interpreter.env;
    if (task.mib) env.mibStack.push(task.mib);
    try {
      interpreter.execLine(execLine, task);
    } catch (e) {
      if (e.message === 'RETURN' || e.message === 'BREAK') {
        task.done = true;
      } else if (e.message === 'GOTO' || e.message === 'SKIP' || e.message === 'INPUT_WAIT') {
        // pc was already modified by the control command
      } else if (task.mib && task.mib.onErrorLabel && task.labels.has(task.mib.onErrorLabel.toUpperCase())) {
        // ONERROR label: branch there once, instead of stopping
        task.pc = task.labels.get(task.mib.onErrorLabel.toUpperCase());
        task.mib.onErrorLabel = null;
      } else {
        throw e;
      }
    } finally {
      if (task.mib) env.mibStack.pop();
    }
  }

  // Handle GOTO — set task pc to label
  gotoLabel(task, label) {
    const upper = label.toUpperCase();
    if (task.labels.has(upper)) {
      task.pc = task.labels.get(upper);
    } else {
      throw new Error(`Label not found: ${label}`);
    }
  }

  // Handle SKIP — relative jump
  skip(task, offset) {
    task.pc = task.pc - 1 + offset; // -1 because pc was already advanced
  }

  // Kill all running tasks
  killAll() {
    this.foreground = [];
    this.middleground = [];
    this.background = [];
    this.breakRequested = true;
  }

  // Stop the middleground macro (ESC), leaving .B and .F macros running
  killMiddleground() {
    this.middleground = [];
    this.breakRequested = true;
  }

  // Remove tasks waiting for INPUT (their prompt was cancelled)
  killWaiting() {
    const keep = (t) => !t._waitingForInput;
    this.foreground = this.foreground.filter(keep);
    this.middleground = this.middleground.filter(keep);
    this.background = this.background.filter(keep);
  }

  // Check if any tasks are running
  isRunning() {
    return this.foreground.length > 0 || this.middleground.length > 0 || this.background.length > 0;
  }
}
