export const sharpenFrag = `
precision mediump float;

uniform sampler2D tex0;
uniform vec2 texelSize;
uniform float posterize;
uniform float posterizeLevels;
uniform float sharpenAmount;

varying vec2 vTexCoord;

void main() {
    vec2 uv = vTexCoord.xy;

    vec3 centerColor = texture2D(tex0, uv).xyz;
    vec3 leftColor = texture2D(tex0, uv - vec2(texelSize.x, 0.0)).xyz;
    vec3 rightColor = texture2D(tex0, uv + vec2(texelSize.x, 0.0)).xyz;
    vec3 topColor = texture2D(tex0, uv + vec2(0.0, texelSize.y)).xyz;
    vec3 bottomColor = texture2D(tex0, uv - vec2(0.0, texelSize.y)).xyz;

    // The four neighbours share (sharpenAmount - 1) of negative weight, so the
    // kernel always sums to 1 and flat areas keep their brightness: 1 passes the
    // input through, and the default 5 is the classic 5 / -1 kernel.
    float neighborWeight = (sharpenAmount - 1.0) * 0.25;
    vec3 sharpenedColor = centerColor * sharpenAmount - (leftColor + rightColor + topColor + bottomColor) * neighborWeight;
    vec3 color = sharpenedColor;
    if (posterize > 0.5) {
        color = floor(sharpenedColor * posterizeLevels) / posterizeLevels;
    }

    gl_FragColor = vec4(color, 1.0);
}
`;
