// repl.js — REPL input, command history, INPUT callback
// Renders an input line at the bottom of the terminal panel.

export class REPL {
  constructor(terminal) {
    this.terminal = terminal;
    this.inputBuffer = '';
    this.cursorPos = 0;
    this.history = [];
    this.historyIndex = -1;
    this.onSubmit = null;       // callback(line) for normal REPL input
    this.inputCallback = null;  // callback(value) for INPUT command
    this.inputPrompt = '';      // prompt for INPUT command
    this.cursorBlink = true;
    this.cursorTimer = 0;
  }

  // Handle keyboard input
  handleKey(key, keyCode, p) {
    // Cursor blink reset
    this.cursorBlink = true;
    this.cursorTimer = 0;

    if (keyCode === p.ENTER || keyCode === 13) {
      const line = this.inputBuffer.trim();
      if (this.inputCallback) {
        // INPUT mode — pass value to waiting command
        const cb = this.inputCallback;
        this.inputCallback = null;
        const prompt = this.inputPrompt;
        this.inputPrompt = '';
        this.terminal.println((prompt ? prompt : '> ') + line);
        this.inputBuffer = '';
        this.cursorPos = 0;
        cb(line);
      } else if (line.length > 0) {
        this.terminal.println('> ' + line);
        this.history.push(line);
        this.historyIndex = this.history.length;
        this.inputBuffer = '';
        this.cursorPos = 0;
        if (this.onSubmit) this.onSubmit(line);
      }
      return;
    }

    if (keyCode === p.BACKSPACE || keyCode === 8) {
      if (this.cursorPos > 0) {
        this.inputBuffer = this.inputBuffer.slice(0, this.cursorPos - 1) +
                           this.inputBuffer.slice(this.cursorPos);
        this.cursorPos--;
      }
      return;
    }

    if (keyCode === p.DELETE || keyCode === 46) {
      if (this.cursorPos < this.inputBuffer.length) {
        this.inputBuffer = this.inputBuffer.slice(0, this.cursorPos) +
                           this.inputBuffer.slice(this.cursorPos + 1);
      }
      return;
    }

    if (keyCode === p.LEFT_ARROW || keyCode === 37) {
      if (this.cursorPos > 0) this.cursorPos--;
      return;
    }

    if (keyCode === p.RIGHT_ARROW || keyCode === 39) {
      if (this.cursorPos < this.inputBuffer.length) this.cursorPos++;
      return;
    }

    if (keyCode === p.UP_ARROW || keyCode === 38) {
      if (this.historyIndex > 0) {
        this.historyIndex--;
        this.inputBuffer = this.history[this.historyIndex];
        this.cursorPos = this.inputBuffer.length;
      }
      return;
    }

    if (keyCode === p.DOWN_ARROW || keyCode === 40) {
      if (this.historyIndex < this.history.length - 1) {
        this.historyIndex++;
        this.inputBuffer = this.history[this.historyIndex];
        this.cursorPos = this.inputBuffer.length;
      } else {
        this.historyIndex = this.history.length;
        this.inputBuffer = '';
        this.cursorPos = 0;
      }
      return;
    }

    if (keyCode === p.HOME || keyCode === 36) {
      this.cursorPos = 0;
      return;
    }

    if (keyCode === p.END || keyCode === 35) {
      this.cursorPos = this.inputBuffer.length;
      return;
    }

    // Printable character
    if (key.length === 1 && keyCode !== p.CONTROL && keyCode !== p.ALT) {
      this.inputBuffer = this.inputBuffer.slice(0, this.cursorPos) +
                         key +
                         this.inputBuffer.slice(this.cursorPos);
      this.cursorPos++;
    }
  }

  // Request input for the INPUT command
  requestInput(prompt, callback) {
    this.inputPrompt = prompt || '';
    this.inputCallback = callback;
    if (prompt) {
      this.terminal.println(prompt);
    }
  }

  // Check if REPL is waiting for INPUT
  isWaitingForInput() {
    return this.inputCallback !== null;
  }

  // Render the input line
  render(p, layout, canvasWidth, canvasHeight) {
    const { fontSize, lineHeight, padding } = layout;
    const y = canvasHeight - lineHeight - 4;

    // Cursor blink timing
    this.cursorTimer++;
    if (this.cursorTimer > 30) {
      this.cursorBlink = !this.cursorBlink;
      this.cursorTimer = 0;
    }

    // Prompt
    const prompt = this.inputCallback ? (this.inputPrompt || '? ') : '> ';

    // Input text
    p.noStroke();
    p.fill(0, 255, 0);
    p.textFont('monospace');
    p.textSize(fontSize);
    p.textAlign(p.LEFT, p.TOP);
    p.text(prompt + this.inputBuffer, padding, y);

    // Cursor
    if (this.cursorBlink) {
      const textBefore = prompt + this.inputBuffer.slice(0, this.cursorPos);
      const cursorX = padding + p.textWidth(textBefore);
      p.fill(0, 255, 0);
      p.rect(cursorX, y, p.textWidth('M') * 0.8, fontSize);
    }
  }
}
