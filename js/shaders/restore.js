// Restore's last pass: crossfades from the input to Anime4K's restored image,
// keeping the input's alpha.
export const restoreMixFrag = `
precision mediump float;

uniform sampler2D tex0;
uniform sampler2D uRestored;
uniform float uMix;

varying vec2 vTexCoord;

void main() {
    vec4 src = texture2D(tex0, vTexCoord);
    vec3 restored = texture2D(uRestored, vTexCoord).rgb;
    gl_FragColor = vec4(mix(src.rgb, restored, uMix), src.a);
}
`;
