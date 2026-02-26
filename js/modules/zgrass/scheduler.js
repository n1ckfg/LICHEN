// scheduler.js — FG/MG/BG cooperative task scheduling
// Foreground (.F): runs fully each frame (should be short, 1/60s)
// Middleground (default): runs N lines then yields
// Background (.B): 1 line per frame, round-robin interleaved

export class Scheduler {
  constructor() {
    // Task queues
    this.foreground = [];    // {name, lines, pc, mibSnapshot}
    this.middleground = [];  // {name, lines, pc, mibSnapshot}
    this.background = [];    // {name, lines, pc, mibSnapshot}
    this.bgIndex = 0;        // Round-robin index for background

    // Config
    this.mgLinesPerFrame = 50;  // How many MG lines to run per frame
    this.fgTimeout = 1000 / 60; // Target FG timing (ms)

    // Flags
    this.breakRequested = false;
  }

  // Add a task
  addTask(type, name, lines, args) {
    const task = {
      name,
      lines,
      pc: 0,
      args: args || [],
      done: false,
      loop: (type === 'FG' || type === 'BG'), // FG/BG tasks loop
      labels: this.parseLabels(lines),
    };

    switch (type) {
      case 'FG': this.foreground.push(task); break;
      case 'BG': this.background.push(task); break;
      default:   this.middleground.push(task); break;
    }
  }

  // Parse labels from lines (label is a number prefix on a line)
  parseLabels(lines) {
    const labels = new Map();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const match = line.match(/^(\d+\w*)\s/);
      if (match) {
        labels.set(match[1].toUpperCase(), i);
      }
    }
    return labels;
  }

  // Main tick — called each frame from draw()
  tick(interpreter) {
    this.breakRequested = false;

    // Run all foreground tasks fully
    for (let i = this.foreground.length - 1; i >= 0; i--) {
      if (this.breakRequested) break;
      const task = this.foreground[i];
      this.runTaskFully(task, interpreter);
      if (task.done) this.foreground.splice(i, 1);
    }

    // Run middleground tasks (N lines then yield)
    for (let i = this.middleground.length - 1; i >= 0; i--) {
      if (this.breakRequested) break;
      const task = this.middleground[i];
      this.runTaskLines(task, interpreter, this.mgLinesPerFrame);
      if (task.done) this.middleground.splice(i, 1);
    }

    // Run background tasks (1 line each, round-robin)
    if (this.background.length > 0 && !this.breakRequested) {
      const startIdx = this.bgIndex % this.background.length;
      let count = this.background.length;
      for (let n = 0; n < count; n++) {
        const i = (startIdx + n) % this.background.length;
        const task = this.background[i];
        this.runTaskLines(task, interpreter, 1);
      }
      // Remove done tasks
      for (let i = this.background.length - 1; i >= 0; i--) {
        if (this.background[i].done) this.background.splice(i, 1);
      }
      this.bgIndex++;
    }
  }

  // Run a task fully (all remaining lines for one pass)
  runTaskFully(task, interpreter) {
    const maxSteps = 10000; // Safety limit
    let steps = 0;
    while (task.pc < task.lines.length && !task.done && !this.breakRequested && steps < maxSteps) {
      this.executeTaskLine(task, interpreter);
      steps++;
    }
    // FG tasks loop for next frame
    if (task.pc >= task.lines.length && task.loop) {
      task.pc = 0;
    } else if (task.pc >= task.lines.length) {
      task.done = true;
    }
  }

  // Run N lines of a task
  runTaskLines(task, interpreter, n) {
    for (let i = 0; i < n && task.pc < task.lines.length && !task.done && !this.breakRequested; i++) {
      this.executeTaskLine(task, interpreter);
      // Background and foreground tasks loop — restart when reaching end
      if (task.pc >= task.lines.length && task.loop) {
        task.pc = 0;
      }
    }
    if (task.pc >= task.lines.length) task.done = true;
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

    // In ZGRASS, lines starting with . are comments
    if (line === '' || line.startsWith('.')) return;

    // Strip label prefix for execution
    const execLine = line.replace(/^\d+\w*\s+/, '');
    if (execLine.trim() === '') return;

    try {
      interpreter.execLine(execLine, task);
    } catch (e) {
      if (e.message === 'RETURN' || e.message === 'BREAK') {
        task.done = true;
      } else if (e.message === 'GOTO' || e.message === 'SKIP') {
        // pc was already modified by the control command
      } else {
        throw e;
      }
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

  // Kill current task (for error recovery)
  killCurrent() {
    this.breakRequested = true;
    // Remove the most recently added task from each queue
    if (this.middleground.length > 0) this.middleground.pop();
    else if (this.foreground.length > 0) this.foreground.pop();
    else if (this.background.length > 0) this.background.pop();
  }

  // Check if any tasks are running
  isRunning() {
    return this.foreground.length > 0 || this.middleground.length > 0 || this.background.length > 0;
  }
}
