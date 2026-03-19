export const gridguysRenderFrag = `
precision highp float;
varying vec2 vTexCoord;

uniform sampler2D u_state;
uniform sampler2D tex0;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_blend;

void main() {
    vec2 uv = vTexCoord;

    vec4 state = texture2D(u_state, uv);
    vec4 inputColor = texture2D(tex0, uv);

    float stateVal = state.r;
    float countdown = state.g;
    float colorVal = state.a;

    vec3 color = vec3(0.0);
    float alpha = 0.0;

    if (stateVal > 0.4 && stateVal < 0.6) {
        // CLICKED state - bright, use countdown for fade
        float gray = 0.5 + 0.5 * colorVal;
        color = vec3(gray);
        alpha = 0.5 + countdown * 0.5;
    } else if (stateVal > 0.2 && stateVal < 0.3) {
        // KABOOM state - pulsing glow
        color = vec3(0.4);
        alpha = 0.3 + countdown * 0.4;
    } else if (stateVal > 0.7) {
        // RESPAWN state - dim
        color = vec3(0.15);
        alpha = countdown * 0.3;
    }

    // Blend GridGuys effect with input video
    vec3 gridguysColor = color * alpha;
    vec3 finalColor = mix(inputColor.rgb, inputColor.rgb + gridguysColor, u_blend);

    gl_FragColor = vec4(finalColor, 1.0);
}
`;
