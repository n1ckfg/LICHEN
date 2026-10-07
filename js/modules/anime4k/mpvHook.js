import { vertSrc } from '../../shaders/vert.js';

// Anime4K ships as mpv user shaders. A file is a list of passes, each a block of
// //! directives followed by GLSL whose hook() reads named textures through
// mpv's macros (NAME_tex, NAME_texOff, NAME_pos, NAME_pt, NAME_size) and returns
// one texel. This turns a file into p5 shaders, one per pass. It covers what the
// Restore shaders use and no more: every pass is the size of its input, and
// WHEN conditions and non-MAIN hooks other than PREKERNEL are rejected.

// Parse a file into passes: { desc, hook, binds, save }, plus the GLSL body.
export function parseHook(src) {
  return src.split(/^\/\/!DESC/m).slice(1).map(chunk => {
    const lines = chunk.split('\n');
    const pass = { desc: lines[0].trim(), hook: null, binds: [], save: null };
    const body = [];
    for (const line of lines.slice(1)) {
      const m = line.match(/^\/\/!(\w+)\s*(.*?)\s*$/);
      if (!m) {
        body.push(line);
        continue;
      }
      const [, key, value] = m;
      if (key === 'HOOK') pass.hook = value;
      else if (key === 'BIND') pass.binds.push(value);
      else if (key === 'SAVE') pass.save = value;
      else if (key === 'WIDTH' || key === 'HEIGHT') {
        // Only a texture's own size: NAME.w or NAME.h
        if (!/^\w+\.[wh]$/.test(value)) throw new Error(`${pass.desc}: unsupported ${key} ${value}`);
      } else if (key !== 'COMPONENTS') {
        throw new Error(`${pass.desc}: unsupported directive //!${key}`);
      }
    }
    if (pass.hook !== 'MAIN' && pass.hook !== 'PREKERNEL') {
      throw new Error(`${pass.desc}: unsupported hook ${pass.hook}`);
    }
    pass.body = body.join('\n');
    return pass;
  });
}

// A pass's fragment shader: each bound texture is a sampler plus its size in
// texels, and the macros read it at this fragment's own uv, so every texture
// lines up texel for texel. mpv puts +y down the image; so does a LICHEN
// framebuffer, where v = 0 is the top row, so offsets carry over unchanged.
export function hookFrag(pass) {
  let src = 'precision highp float;\nvarying vec2 vTexCoord;\n';
  for (const name of pass.binds) {
    src += `uniform sampler2D ${name};\nuniform vec2 ${name}_size;\n` +
      `#define ${name}_pt (1.0 / ${name}_size)\n` +
      `#define ${name}_pos vTexCoord\n` +
      `#define ${name}_tex(pos) texture2D(${name}, pos)\n` +
      `#define ${name}_texOff(off) texture2D(${name}, vTexCoord + (off) / ${name}_size)\n`;
  }
  // mpv also names the hooked texture after itself
  if (pass.binds.includes('HOOKED') && !pass.binds.includes('MAIN')) {
    for (const s of ['pt', 'pos', 'tex', 'texOff', 'size']) src += `#define MAIN_${s} HOOKED_${s}\n`;
  }
  return src + pass.body + '\nvoid main() {\n  gl_FragColor = hook();\n}\n';
}

// Parse a file and make its passes' shaders on glCanvas, resolving once they
// are compiled.
export async function buildHook(glCanvas, src) {
  const passes = parseHook(src);
  for (const pass of passes) pass.shader = glCanvas.createShader(vertSrc, hookFrag(pass));
  await compileInBackground(glCanvas, passes);
  return passes;
}

// p5 compiles a shader the first time it is bound, and waits for the result.
// With nothing in the GPU's shader cache, that froze the page for 1 s on an M
// model and 6.5 s on UL. KHR_parallel_shader_compile lets the GPU compile in the
// background instead, so this builds the programs itself, polls until they are
// done, and gives them to p5, which skips its own compile when a shader already
// has a program (Shader.init in p5 1.9). Without the extension, or if p5's
// internals have moved, p5 compiles them as usual.
async function compileInBackground(glCanvas, passes) {
  const gl = glCanvas.drawingContext;
  const ext = gl.getExtension('KHR_parallel_shader_compile');
  const shaders = passes.map(p => p.shader);
  if (!ext || !shaders.every(s => s._glProgram === 0 && typeof s._loadUniforms === 'function')) return;
  const built = shaders.map(s => {
    const vert = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vert, s._vertSrc);
    gl.compileShader(vert);
    const frag = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(frag, s._fragSrc);
    gl.compileShader(frag);
    const program = gl.createProgram();
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    return { vert, frag, program };
  });
  // Asking for anything but COMPLETION_STATUS_KHR before then would wait
  while (!built.every(b => gl.getProgramParameter(b.program, ext.COMPLETION_STATUS_KHR))) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  built.forEach((b, i) => {
    if (!gl.getProgramParameter(b.program, gl.LINK_STATUS)) {
      const log = gl.getShaderInfoLog(b.frag) || gl.getProgramInfoLog(b.program);
      throw new Error(`${passes[i].desc}: ${log}`);
    }
    const s = shaders[i];
    s._vertShader = b.vert;
    s._fragShader = b.frag;
    s._glProgram = b.program;
    s._loadAttributes();
    s._loadUniforms();
  });
}
