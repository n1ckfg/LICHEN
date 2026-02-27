// palette.js — 256-color master palette and 4 active color slots
// The UV-1 used a 256-color palette with 4 active colors at any time (2bpp).
// We initialize with a reasonable default palette and allow remapping.

const WIDTH = 320;
const HEIGHT = 201;

// Generate a default 256-color palette (8-8-4 RGB distribution like classic systems)
function generateDefaultPalette() {
  const palette = new Array(256);
  // Color 0: black
  palette[0] = [0, 0, 0, 255];
  // Color 1: red
  palette[1] = [255, 0, 0, 255];
  // Color 2: green
  palette[2] = [0, 255, 0, 255];
  // Color 3: blue
  palette[3] = [0, 0, 255, 255];
  // Color 4: white
  palette[4] = [255, 255, 255, 255];
  // Color 5: yellow
  palette[5] = [255, 255, 0, 255];
  // Color 6: cyan
  palette[6] = [0, 255, 255, 255];
  // Color 7: magenta
  palette[7] = [255, 0, 255, 255];

  // Fill remaining with a spread of colors (6x6x6 color cube + grays)
  let idx = 8;
  // 6x6x6 color cube (216 colors)
  for (let r = 0; r < 6 && idx < 256; r++) {
    for (let g = 0; g < 6 && idx < 256; g++) {
      for (let b = 0; b < 6 && idx < 256; b++) {
        palette[idx++] = [
          Math.round(r * 51),
          Math.round(g * 51),
          Math.round(b * 51),
          255
        ];
      }
    }
  }
  // Fill any remaining with grays
  while (idx < 256) {
    const v = Math.round(((idx - 224) / 31) * 255);
    palette[idx++] = [v, v, v, 255];
  }
  return palette;
}

export class Palette {
  constructor() {
    this.master = generateDefaultPalette();
    // 4 active color slots — indices into the master palette
    // Default: 0=black, 1=red, 2=green, 3=blue
    this.activeLeft = [0, 1, 2, 4];  // $L0-$L3
    this.activeRight = [0, 1, 2, 4]; // $R0-$R3
    this.horizontalBoundary = WIDTH;  // $HB — full screen uses left colors
  }

  // Get RGBA for a 2-bit color value (0-3), considering screen position
  getColor(colorValue, x) {
    const slots = (x !== undefined && x >= this.horizontalBoundary)
      ? this.activeRight
      : this.activeLeft;
    const paletteIndex = slots[colorValue & 3];
    return this.master[paletteIndex];
  }

  // Set active color slot
  setLeft(slot, paletteIndex) {
    this.activeLeft[slot & 3] = paletteIndex & 255;
  }

  setRight(slot, paletteIndex) {
    this.activeRight[slot & 3] = paletteIndex & 255;
  }

  // Set master palette entry
  setMasterColor(index, r, g, b) {
    this.master[index & 255] = [r & 255, g & 255, b & 255, 255];
  }
}

export { WIDTH, HEIGHT };
