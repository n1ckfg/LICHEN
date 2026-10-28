// The capital letters A–Z as stroked polylines, in the style of the sketch's M.
//
// Each letter is drawn in its tile's own space, where the tile's centre is at 0
// and its edges at ±1, y down as in Processing. A letter is a list of strokes
// and a stroke a list of points. Every letter spans the whole box, as the M
// does, and corners a letter would round are cut at 45° instead, so the
// alphabet stays as angular as the M. M is the sketch's own vertices.
export const ALPHABET = {
  A: [[[-1, 1], [0, -1], [1, 1]], [[-0.5, 0], [0.5, 0]]],
  B: [[[-1, 1], [-1, -1], [0.5, -1], [1, -0.5], [0.5, 0], [1, 0.5], [0.5, 1], [-1, 1]], [[-1, 0], [0.5, 0]]],
  C: [[[1, -1], [-0.5, -1], [-1, -0.5], [-1, 0.5], [-0.5, 1], [1, 1]]],
  D: [[[-1, -1], [0.5, -1], [1, -0.5], [1, 0.5], [0.5, 1], [-1, 1], [-1, -1]]],
  E: [[[1, -1], [-1, -1], [-1, 1], [1, 1]], [[-1, 0], [0.5, 0]]],
  F: [[[1, -1], [-1, -1], [-1, 1]], [[-1, 0], [0.5, 0]]],
  G: [[[1, -1], [-0.5, -1], [-1, -0.5], [-1, 0.5], [-0.5, 1], [1, 1], [1, 0], [0, 0]]],
  H: [[[-1, -1], [-1, 1]], [[1, -1], [1, 1]], [[-1, 0], [1, 0]]],
  I: [[[-1, -1], [1, -1]], [[0, -1], [0, 1]], [[-1, 1], [1, 1]]],
  J: [[[1, -1], [1, 0.5], [0.5, 1], [-0.5, 1], [-1, 0.5]]],
  K: [[[-1, -1], [-1, 1]], [[1, -1], [-1, 0], [1, 1]]],
  L: [[[-1, -1], [-1, 1], [1, 1]]],
  M: [[[-1, 1], [-1, -1], [0, 0], [1, -1], [1, 1]]],
  N: [[[-1, 1], [-1, -1], [1, 1], [1, -1]]],
  O: [[[-0.5, -1], [0.5, -1], [1, -0.5], [1, 0.5], [0.5, 1], [-0.5, 1], [-1, 0.5], [-1, -0.5], [-0.5, -1]]],
  P: [[[-1, 1], [-1, -1], [0.5, -1], [1, -0.5], [0.5, 0], [-1, 0]]],
  Q: [[[-0.5, -1], [0.5, -1], [1, -0.5], [1, 0.5], [0.5, 1], [-0.5, 1], [-1, 0.5], [-1, -0.5], [-0.5, -1]], [[0.25, 0.25], [1, 1]]],
  R: [[[-1, 1], [-1, -1], [0.5, -1], [1, -0.5], [0.5, 0], [-1, 0]], [[0, 0], [1, 1]]],
  S: [[[1, -1], [-0.5, -1], [-1, -0.5], [-0.5, 0], [0.5, 0], [1, 0.5], [0.5, 1], [-1, 1]]],
  T: [[[-1, -1], [1, -1]], [[0, -1], [0, 1]]],
  U: [[[-1, -1], [-1, 0.5], [-0.5, 1], [0.5, 1], [1, 0.5], [1, -1]]],
  V: [[[-1, -1], [0, 1], [1, -1]]],
  W: [[[-1, -1], [-1, 1], [0, 0], [1, 1], [1, -1]]],
  X: [[[-1, -1], [1, 1]], [[1, -1], [-1, 1]]],
  Y: [[[-1, -1], [0, 0], [1, -1]], [[0, 0], [0, 1]]],
  Z: [[[-1, -1], [1, -1], [-1, 1], [1, 1]]],
};

export const LETTERS = Object.keys(ALPHABET);

// The most segments any letter has (Q's nine), which sizes the shader's table
export const MAX_SEGMENTS = 9;

// A letter's segments, flattened for the shader's vec4 table: x0, y0, x1, y1
// for each, padded with zeros to MAX_SEGMENTS
export function letterSegments(letter) {
  const flat = new Float32Array(MAX_SEGMENTS * 4);
  let n = 0;
  for (const stroke of ALPHABET[letter]) {
    for (let i = 1; i < stroke.length; i++) {
      flat.set([...stroke[i - 1], ...stroke[i]], n * 4);
      n++;
    }
  }
  return { segments: flat, count: n };
}
