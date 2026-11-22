// GridGuys' 3D mode: the 2D automaton grown in an N x N x N grid of cells,
// drawn by stepping a ray through the grid one cell at a time (DDA).
//
// GLSL ES 1.00 has no 3D textures, so the grid is an atlas: N slices of N x N
// cells, slice z at tile (z mod cols, floor(z / cols)) of a 2D texture
// cols * N wide. The state encoding is the 2D mode's:
// R: state (0=idle, 0.25=kaboom, 0.5=clicked, 0.75=respawn)
// G: countdown (1.0 to 0.0)
// A: random color value

const atlasCommon = `
uniform sampler2D u_state;
uniform float u_N;       // cells along each side
uniform float u_cols;    // atlas tiles a row
uniform vec2 u_atlas;    // atlas size in texels

// The texel centre of cell c (integer coordinates as floats)
vec2 cellUV(vec3 c) {
    float ty = floor((c.z + 0.5) / u_cols);
    float tx = c.z - ty * u_cols;
    return (vec2(tx, ty) * u_N + c.xy + 0.5) / u_atlas;
}

// A cell outside the grid is idle, as the 2D mode's border is
vec4 cellAt(vec3 c) {
    if (c.x < 0.0 || c.y < 0.0 || c.z < 0.0 || c.x >= u_N || c.y >= u_N || c.z >= u_N) return vec4(0.0);
    return texture2D(u_state, cellUV(c));
}
`;

export const gridguys3dSimulationFrag = `
precision highp float;
varying vec2 vTexCoord;
${atlasCommon}
uniform vec3 u_target;          // in cells, centred on the grid
uniform float u_targetClicked;
uniform float u_time;

uniform float u_oddsNW;
uniform float u_oddsN;
uniform float u_oddsNE;
uniform float u_oddsW;
uniform float u_oddsE;
uniform float u_oddsSW;
uniform float u_oddsS;
uniform float u_oddsSE;
uniform float u_oddsFront;      // toward +Z, the camera at yaw 0
uniform float u_oddsBack;
uniform float u_zSpread;        // a planar direction's odds, scaled, when it also steps in Z

uniform float u_delayFrames;
uniform float u_lifeFrames;
uniform float u_respawnFrames;
uniform float u_chaos;

float hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

// The 2D mode's odds for a step of (dx, dy), Y up
float planarOdds(float dx, float dy) {
    if (dy > 0.5) return dx < -0.5 ? u_oddsNW : (dx > 0.5 ? u_oddsNE : u_oddsN);
    if (dy < -0.5) return dx < -0.5 ? u_oddsSW : (dx > 0.5 ? u_oddsSE : u_oddsS);
    return dx < -0.5 ? u_oddsW : (dx > 0.5 ? u_oddsE : 0.0);
}

// The odds of spreading one step along d
float dirOdds(vec3 d) {
    if (abs(d.x) < 0.5 && abs(d.y) < 0.5) return d.z > 0.0 ? u_oddsFront : u_oddsBack;
    float p = planarOdds(d.x, d.y);
    return abs(d.z) > 0.5 ? p * u_zSpread : p;
}

bool isClicked(vec4 s) {
    return s.r >= 0.4 && s.r <= 0.6;
}

void main() {
    // Which cell this texel is
    vec2 px = floor(gl_FragCoord.xy);
    vec2 tile = floor(px / u_N);
    vec3 c = vec3(px - tile * u_N, tile.y * u_cols + tile.x);
    if (c.z >= u_N) {
        gl_FragColor = vec4(0.0);
        return;
    }

    vec4 current = texture2D(u_state, cellUV(c));
    float state = current.r;
    float countdown = current.g;
    float colorVal = current.a;

    if (colorVal < 0.01) {
        colorVal = 0.3 + 0.7 * hash(c);
    }

    float randVal = hash(c + vec3(fract(u_time * 7.3), fract(u_time * 11.1), 0.0));

    float newState = state;
    float newCountdown = countdown;

    float decrement = 1.0 / max(u_lifeFrames, 1.0);
    float delayDecrement = 1.0 / max(u_delayFrames, 1.0);
    float respawnDecrement = 1.0 / max(u_respawnFrames, 1.0);

    // IDLE
    if (state < 0.1) {
        float triggered = 0.0;
        float k = 0.0;
        // Each clicked neighbour spreads to us with the odds of the step from it to us
        for (int dz = -1; dz <= 1; dz++) {
            for (int dy = -1; dy <= 1; dy++) {
                for (int dx = -1; dx <= 1; dx++) {
                    vec3 o = vec3(float(dx), float(dy), float(dz));
                    if (dx == 0 && dy == 0 && dz == 0) continue;
                    k += 1.0;
                    if (!isClicked(cellAt(c + o))) continue;
                    float r = hash(c + vec3(fract(u_time * (3.7 + 1.37 * k)), 0.1 * k, 0.0));
                    triggered += step(r, dirOdds(-o));
                }
            }
        }

        if (triggered > 0.5) {
            newState = 0.25;  // KABOOM
            newCountdown = mix(0.7, 1.0, randVal * u_chaos + (1.0 - u_chaos));
        }

        // Direct click from target
        vec3 centre = c + 0.5 - u_N * 0.5;
        if (distance(centre, u_target) < 1.5 && u_targetClicked > 0.5) {
            newState = 0.5;  // CLICKED
            newCountdown = 1.0;
        }
    }
    // KABOOM
    else if (state > 0.2 && state < 0.3) {
        newCountdown = countdown - delayDecrement;
        if (newCountdown <= 0.05) {
            newState = 0.5;
            newCountdown = mix(0.7, 1.0, randVal * u_chaos + (1.0 - u_chaos));
        }
    }
    // CLICKED
    else if (state > 0.4 && state < 0.6) {
        newCountdown = countdown - decrement;
        if (newCountdown <= 0.05) {
            newState = 0.75;
            newCountdown = mix(0.7, 1.0, randVal * u_chaos + (1.0 - u_chaos));
        }
    }
    // RESPAWN
    else if (state > 0.7) {
        newCountdown = countdown - respawnDecrement;
        if (newCountdown <= 0.05) {
            newState = 0.0;
            newCountdown = 0.0;
        }
    }

    gl_FragColor = vec4(newState, newCountdown, 0.0, colorVal);
}
`;

// Clicked cells are solid cubes. Kaboom and respawn cells glow, the 2D mode's
// colours added up along the ray through them, and dim what is behind them.
export const gridguys3dRenderFrag = `
precision highp float;
varying vec2 vTexCoord;
${atlasCommon}
uniform vec3 u_eye;            // in cells
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_fwd;
uniform float u_tanHalfFov;
uniform float u_aspect;
uniform float u_blend;

const int MAX_STEPS = 800;     // a ray crosses at most 3N cells, and N is at most 256
// Glow added, and how much it dims what is behind it, a grid width crossed,
// so a size looks as bright as any other
const float GLOW = 12.0;
const float ABSORB = 10.0;

void main() {
    // vTexCoord.y is 0 at the top of the picture as it is shown
    vec2 ndc = vec2(vTexCoord.x * 2.0 - 1.0, 1.0 - vTexCoord.y * 2.0);
    vec3 rd = normalize(u_fwd + ndc.x * u_aspect * u_tanHalfFov * u_right + ndc.y * u_tanHalfFov * u_up);
    // No zero components, so the slab and step maths never divide by zero
    rd = vec3(abs(rd.x) < 1e-6 ? 1e-6 : rd.x, abs(rd.y) < 1e-6 ? 1e-6 : rd.y, abs(rd.z) < 1e-6 ? 1e-6 : rd.z);
    vec3 inv = 1.0 / rd;

    // Where the ray enters and leaves the grid's box
    vec3 ta = (vec3(0.0) - u_eye) * inv;
    vec3 tb = (vec3(u_N) - u_eye) * inv;
    vec3 tmin = min(ta, tb);
    vec3 tmax = max(ta, tb);
    float t0 = max(max(tmin.x, tmin.y), tmin.z);
    float t1 = min(min(tmax.x, tmax.y), tmax.z);

    vec3 color = vec3(0.0);
    if (t1 > max(t0, 0.0)) {
        float t = max(t0, 0.0);
        vec3 p = u_eye + rd * (t + 1e-4);
        vec3 cell = clamp(floor(p), vec3(0.0), vec3(u_N - 1.0));
        vec3 stp = sign(rd);
        vec3 tDelta = abs(inv);
        vec3 tNextAxis = (cell + max(stp, 0.0) - u_eye) * inv;
        // The face the ray came in through
        vec3 normal = t0 > 0.0
            ? -stp * step(tmin.yzx, tmin) * step(tmin.zxy, tmin)
            : vec3(0.0);
        float trans = 1.0;
        float glow = GLOW / u_N;
        float absorb = ABSORB / u_N;

        for (int i = 0; i < MAX_STEPS; i++) {
            float tNext = min(min(tNextAxis.x, tNextAxis.y), tNextAxis.z);
            vec4 s = texture2D(u_state, cellUV(cell));
            float state = s.r;
            float countdown = s.g;
            float len = tNext - t;

            if (state > 0.4 && state < 0.6) {
                // CLICKED: a solid cube, the 2D mode's grey, lit from the camera
                // and from above, its edges drawn darker
                float gray = (0.5 + 0.5 * s.a) * (0.5 + countdown * 0.5);
                vec3 n = dot(normal, normal) > 0.5 ? normal : -rd;
                float light = 0.45 + 0.4 * max(dot(n, -rd), 0.0) + 0.15 * max(dot(n, normalize(vec3(0.4, 1.0, 0.3))), 0.0);
                vec3 f = fract(u_eye + rd * t);
                vec3 e = min(f, 1.0 - f) + abs(n) * 1.0;   // ignore the axis the face is across
                float edge = min(min(e.x, e.y), e.z);
                light *= mix(0.55, 1.0, smoothstep(0.02, 0.09, edge));
                color += trans * gray * light;
                trans = 0.0;
                break;
            } else if (state > 0.2 && state < 0.3) {
                // KABOOM: pulsing glow
                float a = 0.3 + countdown * 0.4;
                color += trans * 0.4 * a * glow * len;
                trans *= exp(-absorb * a * len);
            } else if (state > 0.7) {
                // RESPAWN: dim
                float a = countdown * 0.3;
                color += trans * 0.15 * a * glow * len;
                trans *= exp(-absorb * a * len);
            }

            // Step to the next cell across the nearest face
            t = tNext;
            if (tNextAxis.x <= tNextAxis.y && tNextAxis.x <= tNextAxis.z) {
                cell.x += stp.x; tNextAxis.x += tDelta.x; normal = vec3(-stp.x, 0.0, 0.0);
            } else if (tNextAxis.y <= tNextAxis.z) {
                cell.y += stp.y; tNextAxis.y += tDelta.y; normal = vec3(0.0, -stp.y, 0.0);
            } else {
                cell.z += stp.z; tNextAxis.z += tDelta.z; normal = vec3(0.0, 0.0, -stp.z);
            }
            if (cell.x < 0.0 || cell.y < 0.0 || cell.z < 0.0 || cell.x >= u_N || cell.y >= u_N || cell.z >= u_N) break;
            if (trans < 0.01) break;
        }
    }

    gl_FragColor = vec4(color * u_blend, 1.0);
}
`;
