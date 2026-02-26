// colormodes.js — PLOP/XOR/OR/AND compositing (modes 0-15)
// colormode encoding: operation = colormode >> 2, colorValue = colormode & 3
// Operations: 0=PLOP (overwrite), 1=XOR, 2=OR, 3=AND

export function applyColormode(existingPixel, colormode) {
  const operation = (colormode >> 2) & 3;
  const colorValue = colormode & 3;

  switch (operation) {
    case 0: // PLOP — overwrite
      return colorValue;
    case 1: // XOR
      return (existingPixel ^ colorValue) & 3;
    case 2: // OR
      return (existingPixel | colorValue) & 3;
    case 3: // AND
      return (existingPixel & colorValue) & 3;
    default:
      return colorValue;
  }
}

// Decode colormode into its parts for display/debug
export function decodeColormode(colormode) {
  const ops = ['PLOP', 'XOR', 'OR', 'AND'];
  return {
    operation: ops[(colormode >> 2) & 3],
    colorValue: colormode & 3,
    raw: colormode & 15
  };
}
