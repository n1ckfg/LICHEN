export const cyberlaceFrag = `
precision highp float;

uniform sampler2D tex0;
uniform float levels;

varying vec2 vTexCoord;

const vec3 white = vec3(0.937, 0.937, 0.937);
const vec3 lightGray = vec3(0.686, 0.686, 0.686);
const vec3 darkGray = vec3(0.376, 0.376, 0.376);
const vec3 black = vec3(0.066, 0.066, 0.066);
const vec3 green = vec3(0.7, 1.0, 0.8);

float getLuminance(vec3 col) {
    return dot(col, vec3(0.299, 0.587, 0.114));
}

void main() {
    int numLevels = int(clamp(levels, 2.0, 4.0));

    vec3 palette[4];
    palette[0] = white;
    palette[1] = lightGray;
    palette[2] = darkGray;
    palette[3] = black;

    vec2 uv = vTexCoord.xy;
    //vec2 uv2 = vec2(uv.x, abs(1.0 - uv.y));
    vec3 texColor = texture2D(tex0, uv).xyz;
    
    float texGray = getLuminance(texColor);

    vec3 closestColor = palette[0];
    float closestDist = distance(texGray, getLuminance(palette[0]));

    for (int i = 1; i < 4; i++) {
        if (i >= numLevels) break;
        float dist = distance(texGray, getLuminance(palette[i]));
        if (dist < closestDist) {
            closestColor = palette[i];
            closestDist = dist;
        }
    }

    vec2 ditherOffset = vec2(mod(gl_FragCoord.x, 2.0) - 0.5, mod(gl_FragCoord.y, 2.0) - 0.5);
    float ditherThreshold = 0.25;

    if (texGray + ditherOffset.x * ditherThreshold < getLuminance(closestColor)) {
        gl_FragColor = vec4(closestColor * green, 1.0);
    } else {
        gl_FragColor = vec4(vec3(0.0), 1.0);
    }
}

`;
