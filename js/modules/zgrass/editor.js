// editor.js — Full-screen EDIT mode for macros
// Opens a modal overlay for editing macro source code.

export class Editor {
  constructor(terminal) {
    this.terminal = terminal;
    this.active = false;
    this.macroName = '';
    this.lines = [''];
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.scrollOffset = 0;
    this.onSave = null;  // callback(name, body)
  }

  // Open editor for a named macro
  open(name, body, onSave) {
    this.active = true;
    this.macroName = name;
    this.lines = body ? body.split('\n') : [''];
    if (this.lines.length === 0) this.lines = [''];
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.scrollOffset = 0;
    this.onSave = onSave;
  }

  close() {
    this.active = false;
  }

  // Get the edited body as a string
  getBody() {
    return this.lines.join('\n');
  }

  handleKey(key, keyCode, p) {
    if (!this.active) return;

    // ESC — save and close
    if (keyCode === p.ESCAPE || keyCode === 27) {
      if (this.onSave) {
        this.onSave(this.macroName, this.getBody());
      }
      this.close();
      this.terminal.println(`Saved macro ${this.macroName}`);
      return;
    }

    // Ctrl+Q — discard and close
    if (key === 'q' && p.keyIsDown(p.CONTROL)) {
      this.close();
      this.terminal.println('Edit cancelled');
      return;
    }

    if (keyCode === p.ENTER || keyCode === 13) {
      // Split line at cursor
      const line = this.lines[this.cursorRow];
      this.lines.splice(this.cursorRow, 1, line.slice(0, this.cursorCol), line.slice(this.cursorCol));
      this.cursorRow++;
      this.cursorCol = 0;
      return;
    }

    if (keyCode === p.BACKSPACE || keyCode === 8) {
      if (this.cursorCol > 0) {
        const line = this.lines[this.cursorRow];
        this.lines[this.cursorRow] = line.slice(0, this.cursorCol - 1) + line.slice(this.cursorCol);
        this.cursorCol--;
      } else if (this.cursorRow > 0) {
        // Merge with previous line
        this.cursorCol = this.lines[this.cursorRow - 1].length;
        this.lines[this.cursorRow - 1] += this.lines[this.cursorRow];
        this.lines.splice(this.cursorRow, 1);
        this.cursorRow--;
      }
      return;
    }

    if (keyCode === p.UP_ARROW || keyCode === 38) {
      if (this.cursorRow > 0) {
        this.cursorRow--;
        this.cursorCol = Math.min(this.cursorCol, this.lines[this.cursorRow].length);
      }
      return;
    }

    if (keyCode === p.DOWN_ARROW || keyCode === 40) {
      if (this.cursorRow < this.lines.length - 1) {
        this.cursorRow++;
        this.cursorCol = Math.min(this.cursorCol, this.lines[this.cursorRow].length);
      }
      return;
    }

    if (keyCode === p.LEFT_ARROW || keyCode === 37) {
      if (this.cursorCol > 0) this.cursorCol--;
      else if (this.cursorRow > 0) {
        this.cursorRow--;
        this.cursorCol = this.lines[this.cursorRow].length;
      }
      return;
    }

    if (keyCode === p.RIGHT_ARROW || keyCode === 39) {
      if (this.cursorCol < this.lines[this.cursorRow].length) this.cursorCol++;
      else if (this.cursorRow < this.lines.length - 1) {
        this.cursorRow++;
        this.cursorCol = 0;
      }
      return;
    }

    // Printable character
    if (key.length === 1) {
      const line = this.lines[this.cursorRow];
      this.lines[this.cursorRow] = line.slice(0, this.cursorCol) + key + line.slice(this.cursorCol);
      this.cursorCol++;
    }
  }

  render(p, canvasWidth, canvasHeight) {
    if (!this.active) return;

    const fontSize = Math.max(12, Math.floor(canvasHeight / 40));
    const lineHeight = fontSize + 2;
    const padding = 12;
    const headerHeight = lineHeight + 8;

    // Full-screen overlay
    p.noStroke();
    p.fill(0, 0, 40, 240);
    p.rect(0, 0, canvasWidth, canvasHeight);

    // Header
    p.fill(0, 0, 80);
    p.rect(0, 0, canvasWidth, headerHeight);
    p.fill(255, 255, 0);
    p.textFont('monospace');
    p.textSize(fontSize);
    p.textAlign(p.LEFT, p.TOP);
    p.text(`EDIT: ${this.macroName}  |  ESC=Save  Ctrl+Q=Cancel`, padding, 4);

    // Scroll management
    const visibleLines = Math.floor((canvasHeight - headerHeight - padding) / lineHeight);
    if (this.cursorRow < this.scrollOffset) {
      this.scrollOffset = this.cursorRow;
    }
    if (this.cursorRow >= this.scrollOffset + visibleLines) {
      this.scrollOffset = this.cursorRow - visibleLines + 1;
    }

    // Render lines
    p.fill(0, 255, 0);
    for (let i = 0; i < visibleLines && i + this.scrollOffset < this.lines.length; i++) {
      const lineNum = i + this.scrollOffset;
      const y = headerHeight + padding + i * lineHeight;
      const numStr = String(lineNum + 1).padStart(3, ' ') + ' ';
      p.fill(100, 100, 100);
      p.text(numStr, padding, y);
      p.fill(0, 255, 0);
      p.text(this.lines[lineNum], padding + p.textWidth(numStr), y);
    }

    // Cursor
    const cursorScreenRow = this.cursorRow - this.scrollOffset;
    if (cursorScreenRow >= 0 && cursorScreenRow < visibleLines) {
      const cy = headerHeight + padding + cursorScreenRow * lineHeight;
      const numStr = String(this.cursorRow + 1).padStart(3, ' ') + ' ';
      const cx = padding + p.textWidth(numStr) + p.textWidth(this.lines[this.cursorRow].slice(0, this.cursorCol));
      p.fill(0, 255, 0, 180);
      p.rect(cx, cy, p.textWidth('M') * 0.8, fontSize);
    }
  }
}
