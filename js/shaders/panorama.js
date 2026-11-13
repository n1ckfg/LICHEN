// Panorama views its input as a panorama from the centre: each output pixel
// casts a ray from a camera turned by yaw and pitch, and the input is read
// where that ray meets the sphere or cube it is mapped on. Both projections
// place the image as QTVR does (js/modules/QTVRModule.js), so a picture looks
// the same in either module at the same Yaw, Pitch and FOV.
//
// Directions are in p5's world space, as QTVR's camera sees them: y down, and
// at yaw 0 and pitch 0 the view looks toward -z with +x on the right.

const VIEW_RAY = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform vec2 uTexSize;   // the input in physical pixels
uniform float uYaw;      // radians; positive turns right
uniform float uPitch;    // radians; positive looks up
uniform float uTanHalf;  // tan(vertical FOV / 2)
uniform float uAspect;   // output width / height

// The ray through this pixel. vTexCoord runs top-down, as the y-down world does,
// so a pixel below the centre looks down.
vec3 viewRay() {
  float cp = cos(uPitch);
  vec3 f = vec3(sin(uYaw) * cp, -sin(uPitch), -cos(uYaw) * cp);
  // p5's camera() basis with up (0, 1, 0): x = up × z and y = z × x, z = -f
  vec3 x = normalize(cross(vec3(0.0, 1.0, 0.0), -f));
  vec3 y = cross(-f, x);
  vec2 s = vTexCoord * 2.0 - 1.0;
  return normalize(f + s.x * uTanHalf * uAspect * x + s.y * uTanHalf * y);
}
`;

// QTVR's sphere: p5's sphere() puts uv (u, v) at (cos φ sin θ, sin φ, cos φ cos θ),
// θ = 2πu and φ = πv − π/2, and QTVR mirrors x then turns it a quarter about y,
// which takes it to (cos φ cos θ, sin φ, cos φ sin θ). This inverts that.
export const panoramaEquirectFrag = VIEW_RAY + `
const float PI = 3.14159265358979;

// The input at column x (texels, wrapping round) and height v. Each tap sits on
// a column's centre, so the hardware blends rows only, and the two columns are
// blended here: the seam at θ = ±π blends the first column with the last instead
// of clamping to one of them.
vec4 column(float x, float v) {
  return texture2D(tex0, vec2((mod(x, uTexSize.x) + 0.5) / uTexSize.x, v));
}

void main() {
  vec3 d = viewRay();
  float u = atan(d.z, d.x) / (2.0 * PI);
  float v = asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5;
  float x = fract(u) * uTexSize.x - 0.5;
  float x0 = floor(x);
  gl_FragColor = mix(column(x0, v), column(x0 + 1.0, v), x - x0);
}
`;

// QTVR's cube: a horizontal strip of six square faces, px, nx, py, ny, pz, nz
// left to right, each drawn on the cube face whose corners its top-left,
// top-right and bottom-left go to (QTVR's SKYBOX_FACES). Those corners are
// c0, c1 and c3 here, on the cube of side 2.
export const panoramaCubemapFrag = VIEW_RAY + `
void main() {
  vec3 d = viewRay();
  vec3 a = abs(d);
  float face;
  vec3 c0, c1, c3;
  if (a.x >= a.y && a.x >= a.z) {
    if (d.x > 0.0) { face = 0.0; c0 = vec3( 1.0, -1.0, -1.0); c1 = vec3( 1.0, -1.0,  1.0); c3 = vec3( 1.0,  1.0, -1.0); }
    else           { face = 1.0; c0 = vec3(-1.0, -1.0,  1.0); c1 = vec3(-1.0, -1.0, -1.0); c3 = vec3(-1.0,  1.0,  1.0); }
  } else if (a.y >= a.z) {
    if (d.y < 0.0) { face = 2.0; c0 = vec3(-1.0, -1.0,  1.0); c1 = vec3( 1.0, -1.0,  1.0); c3 = vec3(-1.0, -1.0, -1.0); }
    else           { face = 3.0; c0 = vec3(-1.0,  1.0, -1.0); c1 = vec3( 1.0,  1.0, -1.0); c3 = vec3(-1.0,  1.0,  1.0); }
  } else {
    if (d.z < 0.0) { face = 4.0; c0 = vec3(-1.0, -1.0, -1.0); c1 = vec3( 1.0, -1.0, -1.0); c3 = vec3(-1.0,  1.0, -1.0); }
    else           { face = 5.0; c0 = vec3( 1.0, -1.0,  1.0); c1 = vec3(-1.0, -1.0,  1.0); c3 = vec3( 1.0,  1.0,  1.0); }
  }
  // Where the ray meets the face, as uv across it (each edge is 2 long)
  vec3 p = d / max(max(a.x, a.y), a.z);
  vec2 uv = vec2(dot(p - c0, c1 - c0), dot(p - c0, c3 - c0)) / 4.0;
  // Held half a texel inside the face, so its edge doesn't blend in the next face
  vec2 tile = vec2(uTexSize.x / 6.0, uTexSize.y);
  uv = clamp(uv, 0.5 / tile, 1.0 - 0.5 / tile);
  gl_FragColor = texture2D(tex0, vec2((face + uv.x) / 6.0, uv.y));
}
`;
