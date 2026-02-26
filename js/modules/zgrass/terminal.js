// terminal.js — Scrollback text buffer, rendered as overlay on the canvas
// Displays output text (PRINT, errors, etc.) in a semi-transparent panel.

export class Terminal {
  constructor(maxLines = 100) {
    this.lines = [];
    this.maxLines = maxLines;
    this.dirty = true;
  }

  // Add a line of text
  println(text) {
    const str = String(text);
    // Split on newlines so multi-line output works
    const parts = str.split('\n');
    for (const part of parts) {
      this.lines.push(part);
    }
    while (this.lines.length > this.maxLines) {
      this.lines.shift();
    }
    this.dirty = true;
  }

  // Print without newline — append to last line
  print(text) {
    const str = String(text);
    if (this.lines.length === 0) {
      this.lines.push(str);
    } else {
      this.lines[this.lines.length - 1] += str;
    }
    this.dirty = true;
  }

  // Clear terminal
  clear() {
    this.lines = [];
    this.dirty = true;
  }

  // Render the terminal overlay on the p5 canvas
  render(p, canvasWidth, canvasHeight) {
    const fontSize = Math.max(12, Math.floor(canvasHeight / 40));
    const lineHeight = fontSize + 2;
    const panelHeight = Math.floor(canvasHeight * 0.35);
    const panelY = canvasHeight - panelHeight;
    const visibleLines = Math.floor(panelHeight / lineHeight) - 2; // leave room for REPL

    // Semi-transparent background
    p.noStroke();
    p.fill(0, 0, 0, 180);
    p.rect(0, panelY, canvasWidth, panelHeight);

    // Border line
    p.stroke(0, 200, 0, 150);
    p.strokeWeight(1);
    p.line(0, panelY, canvasWidth, panelY);

    // Render text
    p.noStroke();
    p.fill(0, 255, 0);
    p.textFont('monospace');
    p.textSize(fontSize);
    p.textAlign(p.LEFT, p.TOP);

    const startLine = Math.max(0, this.lines.length - visibleLines);
    const padding = 8;
    for (let i = startLine; i < this.lines.length; i++) {
      const y = panelY + padding + (i - startLine) * lineHeight;
      if (y + lineHeight > canvasHeight - lineHeight * 2) break;
      p.text(this.lines[i], padding, y);
    }

    // Return layout info for REPL positioning
    return {
      panelY,
      panelHeight,
      fontSize,
      lineHeight,
      padding
    };
  }
}
