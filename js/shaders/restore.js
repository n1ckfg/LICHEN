// Restore's last pass: pushes the input toward Anime4K's restored image by
// uMix, past it above 1, then applies Clamp_Highlights' clamp when uClamp is on,
// keeping the input's alpha. The clamp runs here, after the gain, so a gain
// can't bring back the overshoot it removes: each pixel's luminance is pulled
// down to uStats, the input's maximum over the 5 x 5 pixels around it.
export const restoreMixFrag = `
precision mediump float;

uniform sampler2D tex0;
uniform sampler2D uRestored;
uniform sampler2D uStats;
uniform float uMix;
uniform float uClamp;

varying vec2 vTexCoord;

void main() {
    vec4 src = texture2D(tex0, vTexCoord);
    vec3 restored = texture2D(uRestored, vTexCoord).rgb;
    vec3 color = mix(src.rgb, restored, uMix);
    if (uClamp > 0.5) {
        // As Anime4K_Clamp_Highlights: BT.601 luma, taken off all three channels
        float luma = dot(color, vec3(0.299, 0.587, 0.114));
        color -= luma - min(luma, texture2D(uStats, vTexCoord).r);
    }
    gl_FragColor = vec4(color, src.a);
}
`;
