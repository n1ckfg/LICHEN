// The Swarm module's shaders: its agents' segments, drawn onto the canvas it
// keeps, and the slight box blur it gives that canvas now and then.
//
// Each agent's segment this frame is two texels of uAgents: its start and end
// (x0, y0, x1, y1), then the line's width, the outline's width, and the uv the
// line takes its colour from. Positions and widths are in logical pixels of
// the frame, y down. Segments come from one p5.Geometry of two quads an agent:
// aPosition.x is -1 at the segment's start and 1 at its end, aPosition.y is -1
// or 1 across it, and aPosition.z is the quad's index. Quad 2i is agent i's
// outline and quad 2i + 1 its line, so they blend in the order the original
// drew them: each agent's outline, then its line, then the next agent's.
export const SWARM_MAX = 1000;

export const swarmSegmentVert = `
precision highp float;
attribute vec3 aPosition;

uniform sampler2D uAgents;
uniform float uTexW;
uniform float uCount;       // agents drawn this frame
uniform sampler2D uInput;
uniform float uHasInput;
uniform vec2 uFrame;        // the frame's logical size
uniform float uFeather;     // one physical pixel, in logical pixels
uniform float uOutline;     // the outline's opacity

varying vec3 vUvl;
varying vec4 vColor;
varying float vHalf;

void main() {
  float agent = floor((aPosition.z + 0.5) / 2.0);
  bool isLine = aPosition.z - agent * 2.0 > 0.5;
  if (agent >= uCount) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);   // no agent here: off screen
    return;
  }
  vec4 seg = texture2D(uAgents, vec2((agent * 2.0 + 0.5) / uTexW, 0.5));
  vec4 info = texture2D(uAgents, vec2((agent * 2.0 + 1.5) / uTexW, 0.5));

  vHalf = (isLine ? info.x : info.y) * 0.5;
  float size = vHalf + uFeather;
  vec2 p0 = seg.xy;
  vec2 p1 = seg.zw;
  float len = length(p1 - p0);
  vec2 dir = len > 1e-6 ? (p1 - p0) / len : vec2(1.0, 0.0);
  vec2 norm = vec2(-dir.y, dir.x);
  bool atEnd = aPosition.x > 0.0;
  vec2 pos = (atEnd ? p1 : p0) + (dir * aPosition.x + norm * aPosition.y) * size;
  vUvl = vec3(atEnd ? len + size : -size, aPosition.y * size, len);

  if (isLine) {
    // BitmapData.getPixel reads 0 off the image, and the original paints
    // white wherever it reads 0
    vec2 uv = info.zw;
    vec3 c = texture2D(uInput, uv).rgb;
    bool inside = uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
    if (uHasInput < 0.5 || !inside || max(c.r, max(c.g, c.b)) < 0.5 / 255.0) c = vec3(1.0);
    vColor = vec4(c, 1.0);
  } else {
    vColor = vec4(0.0, 0.0, 0.0, uOutline);
  }

  // gl_FragCoord.y = 0 is the top of a framebuffer
  gl_Position = vec4(pos / uFrame * 2.0 - 1.0, 0.0, 1.0);
}
`;

// A line vHalf either side of the segment, round-ended like the original's
// ROUND caps, smoothed over one physical pixel and premultiplied for p5's BLEND
export const swarmSegmentFrag = `
precision highp float;
uniform float uFeather;
varying vec3 vUvl;
varying vec4 vColor;
varying float vHalf;

void main() {
  float u = vUvl.x, len = vUvl.z;
  float d = u < 0.0 ? length(vUvl.xy) : u > len ? length(vec2(u - len, vUvl.y)) : abs(vUvl.y);
  float a = clamp((vHalf - d) / uFeather + 0.5, 0.0, 1.0) * vColor.a;
  gl_FragColor = vec4(vColor.rgb * a, a);
}
`;

// Box blur of fractional width b, sampled over a 3x3 neighbourhood: the centre
// pixel is fully inside the box and each neighbour is covered by (b - 1) / 2.
// Weights are normalised by b (see boxWeights() in SwarmModule.js).
export const swarmBlurFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform vec2 texelSize;
uniform vec3 wx;
uniform vec3 wy;

void main() {
  vec4 sum = vec4(0.0);
  for (int j = 0; j < 3; j++) {
    for (int i = 0; i < 3; i++) {
      vec2 off = vec2(float(i - 1), float(j - 1)) * texelSize;
      sum += texture2D(tex0, vTexCoord + off) * wx[i] * wy[j];
    }
  }
  gl_FragColor = sum;
}
`;
