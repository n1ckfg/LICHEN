// Common LUT Format (CLF) reader.
//
// parseCLF() reads a CLF ProcessList (Academy/ASC CLF v2-v3, SMPTE ST 2136-1)
// into a list of ops whose parameters are normalized to 0-1, with each node's
// bit-depth scaling folded in. compileCLF() turns that list into one function
// that applies the whole transform to an RGB value. LUTModule runs that
// function once per lattice point to bake a 3D LUT, so none of this runs per
// pixel. Where the spec leaves an edge case open, this follows OpenColorIO's
// reader and CPU renderers, which the tests compare against.

const BIT_DEPTH_SCALE = { '8i': 255, '10i': 1023, '12i': 4095, '16i': 65535, '16f': 1, '32f': 1 };
const SMPTE_NS = 'http://www.smpte-ra.org/ns/2136-1/2024';
const SMPTE_NS_PREFIX = 'http://www.smpte-ra.org/ns/2136-1/';
const FLT_MIN = 1.1754943508222875e-38;

// Elements that describe the transform rather than being part of it
const METADATA = new Set(['Description', 'InputDescriptor', 'OutputDescriptor', 'Info', 'Id']);

// OpenColorIO CTF process nodes: not CLF, so refuse rather than skip them
const CTF_ONLY = new Set(['Gamma', 'InverseLUT1D', 'InverseLUT3D', 'ExposureContrast', 'FixedFunction',
  'GradingPrimary', 'GradingRGBCurve', 'GradingHueCurve', 'GradingTone', 'Reference']);

export class CLFError extends Error {}

export function parseCLF(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new CLFError('Not a well-formed XML file.');
  }
  const root = doc.documentElement;
  if (root.localName !== 'ProcessList') {
    throw new CLFError(`Expected a <ProcessList>, found <${root.localName}>.`);
  }

  const warnings = [];
  const version = readVersion(root);
  const ops = [];
  let prevOutDepth = null;

  for (const el of root.children) {
    const name = el.localName;
    if (METADATA.has(name)) {
      if (name === 'Id') checkId(el, warnings);
      continue;
    }
    const parse = NODE_PARSERS[name];
    if (!parse) {
      if (CTF_ONLY.has(name)) throw new CLFError(`<${name}> is an OpenColorIO CTF node, not part of CLF.`);
      warnings.push(`Ignored unknown element <${name}>.`);
      continue;
    }
    if (version < 3 && (name === 'Log' || name === 'Exponent')) {
      throw new CLFError(`<${name}> needs CLF v3; this file is CLF v${version}.`);
    }
    const inDepth = bitDepth(el, 'inBitDepth');
    const outDepth = bitDepth(el, 'outBitDepth');
    if (prevOutDepth !== null && inDepth !== prevOutDepth) {
      throw new CLFError(`<${name}> has inBitDepth ${inDepth}, but the node before it outputs ${prevOutDepth}.`);
    }
    prevOutDepth = outDepth;
    // A node may parse to more than one op (a LUT with an IndexMap)
    ops.push(...[].concat(parse(el, {
      inScale: BIT_DEPTH_SCALE[inDepth], outScale: BIT_DEPTH_SCALE[outDepth], version, warnings,
    })));
  }

  if (!ops.length) throw new CLFError('The ProcessList has no process nodes.');
  return { ops, warnings };
}

// ---- ProcessList metadata ----

function readVersion(root) {
  const ns = root.namespaceURI || '';
  const smpte = ns === SMPTE_NS;
  if (!smpte && ns.startsWith(SMPTE_NS_PREFIX)) {
    throw new CLFError(`The namespace ${ns} is newer than this reader supports (${SMPTE_NS}).`);
  }

  let version;
  const comp = root.getAttribute('compCLFversion') ?? root.getAttribute('version');
  if (comp !== null) {
    const trimmed = comp.trim();
    if (trimmed === 'ST2136-1:2024') {
      version = 3;
    } else if (/^\d+(\.\d+){0,2}$/.test(trimmed)) {
      const [major, minor = 0] = trimmed.split('.').map(Number);
      if (major > 3 || (major === 3 && minor > 0)) {
        throw new CLFError(`CLF version ${trimmed} is newer than this reader supports (3.0).`);
      }
      version = major + minor / 10;
    } else {
      throw new CLFError(`"${comp}" is not a valid compCLFversion.`);
    }
  } else if (smpte) {
    version = 3;
  } else {
    throw new CLFError('The ProcessList has no compCLFversion attribute.');
  }

  // Before SMPTE ST 2136-1 the ProcessList id was required
  const id = root.getAttribute('id');
  if (id !== null && !id.trim()) throw new CLFError('The ProcessList id must not be empty.');
  if (id === null && !smpte) throw new CLFError('The ProcessList is missing its id attribute.');
  return version;
}

function checkId(el, warnings) {
  const id = el.textContent.trim();
  if (!/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    warnings.push(`"${id}" is not a SMPTE ST 2136-1 compliant Id.`);
  }
}

function bitDepth(el, attr) {
  const depth = el.getAttribute(attr);
  if (depth === null) throw new CLFError(`<${el.localName}> is missing ${attr}.`);
  if (!(depth in BIT_DEPTH_SCALE)) throw new CLFError(`<${el.localName}> has an invalid ${attr} "${depth}".`);
  return depth;
}

// ---- Shared element and number helpers ----

function child(el, name) {
  for (const c of el.children) if (c.localName === name) return c;
  return null;
}

function childrenNamed(el, name) {
  return Array.from(el.children).filter(c => c.localName === name);
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

function parseNumber(token, where) {
  if (NUMBER.test(token)) return Number(token);
  const t = token.toLowerCase().replace(/^\+/, '');
  if (t === 'nan' || t === '-nan') return NaN;
  if (t === 'inf' || t === 'infinity') return Infinity;
  if (t === '-inf' || t === '-infinity') return -Infinity;
  throw new CLFError(`${where}: "${token}" is not a number.`);
}

// textContent skips comments, which some files put inside their arrays
function numbers(el, where) {
  return el.textContent.trim().split(/\s+/).filter(Boolean).map(t => parseNumber(t, where));
}

function single(el, where) {
  const values = numbers(el, where);
  if (values.length !== 1) throw new CLFError(`${where} must hold one number.`);
  return values[0];
}

function readArray(el) {
  const name = el.localName;
  const arr = child(el, 'Array');
  if (!arr) throw new CLFError(`<${name}> has no <Array>.`);
  const dimText = (arr.getAttribute('dim') || '').trim();
  const dims = dimText.split(/\s+/).filter(Boolean).map(Number);
  if (!dims.length || dims.some(d => !Number.isInteger(d) || d < 1)) {
    throw new CLFError(`<${name}> has an invalid Array dim "${dimText}".`);
  }
  return { dims, values: numbers(arr, `<${name}> Array`) };
}

function expectCount(values, count, name) {
  if (values.length !== count) {
    throw new CLFError(`<${name}> Array has ${values.length} values; its dim calls for ${count}.`);
  }
}

// Attribute from a list of legal values, matched without regard to case
function styleOf(el, legal, fallback) {
  const style = el.getAttribute('style');
  if (style === null) {
    if (fallback) return fallback;
    throw new CLFError(`<${el.localName}> is missing its style.`);
  }
  const match = legal.find(s => s.toLowerCase() === style.trim().toLowerCase());
  if (!match) throw new CLFError(`<${el.localName}> has an invalid style "${style}".`);
  return match;
}

// Per-channel parameter elements: one without a channel applies to all three
function channelParams(el, tag, read) {
  const out = [null, null, null];
  for (const p of childrenNamed(el, tag)) {
    const channel = p.getAttribute('channel');
    const params = read(p);
    if (channel === null) {
      out.fill(params);
    } else {
      const i = 'RGB'.indexOf(channel.trim().toUpperCase());
      if (i < 0 || channel.trim().length !== 1) throw new CLFError(`<${tag}> has an invalid channel "${channel}".`);
      out[i] = params;
    }
  }
  return out;
}

function numericAttrs(el, names) {
  const out = {};
  for (const n of names) {
    const v = el.getAttribute(n);
    if (v !== null) out[n] = parseNumber(v.trim(), `<${el.localName}> ${n}`);
  }
  return out;
}

// ---- Process nodes ----

function parseMatrix(el, ctx) {
  const { dims, values } = readArray(el);
  // CLF v2 wrote a third dim of 3 ("3 3 3", "3 4 3")
  const d = dims.length === 3 && dims[2] === 3 ? dims.slice(0, 2) : dims;
  if (d.length !== 2 || d[0] !== 3 || (d[1] !== 3 && d[1] !== 4)) {
    throw new CLFError(`<Matrix> Array dim "${dims.join(' ')}" must be "3 3" or "3 4".`);
  }
  expectCount(values, 3 * d[1], 'Matrix');
  // The coefficients map inBitDepth-scaled values to outBitDepth-scaled ones
  const k = ctx.inScale / ctx.outScale;
  const m = [], o = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) m.push(values[r * d[1] + c] * k);
    o.push(d[1] === 4 ? values[r * 4 + 3] / ctx.outScale : 0);
  }
  return { type: 'matrix', m, o };
}

function flagAttr(el, name) {
  const v = el.getAttribute(name);
  if (v === null) return false;
  if (v.trim().toLowerCase() !== 'true') throw new CLFError(`<${el.localName}> ${name} may only be "true".`);
  return true;
}

function parseLUT1D(el, ctx) {
  const halfDomain = flagAttr(el, 'halfDomain');
  const rawHalfs = flagAttr(el, 'rawHalfs');
  const { dims, values } = readArray(el);
  if (dims.length !== 2 || (dims[1] !== 1 && dims[1] !== 3)) {
    throw new CLFError(`<LUT1D> Array dim "${dims.join(' ')}" must be "N 1" or "N 3".`);
  }
  const [n, comps] = dims;
  expectCount(values, n * comps, 'LUT1D');
  if (n < 2) throw new CLFError('<LUT1D> needs at least 2 entries.');
  if (halfDomain && n !== 65536) throw new CLFError('A halfDomain <LUT1D> must have 65536 entries.');

  const decode = rawHalfs ? (v, i) => {
    if (!Number.isInteger(v) || v < 0 || v > 65535) throw new CLFError(`<LUT1D> rawHalfs value ${i} is not a 16-bit integer.`);
    return halfToFloat(v);
  } : v => v;
  const tables = [0, 1, 2].map(ch => {
    const t = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const j = i * comps + (comps === 3 ? ch : 0);
      t[i] = sanitize(decode(values[j], j) / ctx.outScale);
    }
    return t;
  });

  return withIndexMap(el, ctx, n, { type: 'lut1d', n, tables, halfDomain });
}

// OpenColorIO loads NaN table entries as 0 and infinities as the largest float
const FLT_MAX = 3.4028234663852886e38;
function sanitize(v) {
  return Number.isNaN(v) ? 0 : Math.min(Math.max(v, -FLT_MAX), FLT_MAX);
}

// IndexMap (CLF v2 only) maps input values onto the table's index positions.
// Like OpenColorIO, it becomes a clamping Range ahead of the LUT; only the
// two-entry form is supported, and CLF v3 ignores it.
function withIndexMap(el, ctx, n, lutOp) {
  const im = child(el, 'IndexMap');
  if (!im) return lutOp;
  if (ctx.version >= 3) {
    ctx.warnings.push('Ignored <IndexMap>, which is not part of CLF v3.');
    return lutOp;
  }
  const pairs = im.textContent.replace(/\s*@\s*/g, '@').trim().split(/\s+/).filter(Boolean);
  const dim = Number(im.getAttribute('dim'));
  if (dim !== pairs.length) throw new CLFError(`<IndexMap> dim ${dim} does not match its ${pairs.length} entries.`);
  if (dim !== 2) throw new CLFError(`<IndexMap> with ${dim} entries is not supported; only 2.`);
  const [[in0, idx0], [in1, idx1]] = pairs.map(p => {
    const parts = p.split('@');
    if (parts.length !== 2) throw new CLFError(`<IndexMap> entry "${p}" must be value@index.`);
    return parts.map(t => parseNumber(t, '<IndexMap>'));
  });
  if (in0 === in1) throw new CLFError('<IndexMap> input values must differ.');
  const x0 = in0 / ctx.inScale, x1 = in1 / ctx.inScale;
  const y0 = idx0 / (n - 1), y1 = idx1 / (n - 1);
  const scale = (y1 - y0) / (x1 - x0);
  const range = { type: 'range', scale, offset: y0 - scale * x0, lo: Math.min(y0, y1), hi: Math.max(y0, y1) };
  return [range, lutOp];
}

function parseLUT3D(el, ctx) {
  const interp = (el.getAttribute('interpolation') || 'trilinear').trim().toLowerCase();
  if (interp !== 'trilinear' && interp !== 'tetrahedral') {
    throw new CLFError(`<LUT3D> has an invalid interpolation "${interp}".`);
  }
  const { dims, values } = readArray(el);
  if (dims.length !== 4 || dims[3] !== 3) {
    throw new CLFError(`<LUT3D> Array dim "${dims.join(' ')}" must be "N N N 3".`);
  }
  const n = dims[0];
  if (dims[1] !== n || dims[2] !== n) throw new CLFError('<LUT3D> grid must be the same size on all three axes.');
  if (n < 2) throw new CLFError('<LUT3D> needs at least 2 entries per axis.');
  expectCount(values, n * n * n * 3, 'LUT3D');
  // Blue varies fastest: entry (r, g, b) is at ((r * n + g) * n + b) * 3
  return withIndexMap(el, ctx, n, {
    type: 'lut3d', n, data: Float64Array.from(values, v => sanitize(v / ctx.outScale)), tetrahedral: interp === 'tetrahedral',
  });
}

function parseRange(el, ctx) {
  const style = styleOf(el, ['Clamp', 'noClamp'], 'Clamp');
  const value = (tag, scale) => {
    const c = child(el, tag);
    return c ? single(c, `<Range> ${tag}`) / scale : null;
  };
  const minIn = value('minInValue', ctx.inScale), maxIn = value('maxInValue', ctx.inScale);
  const minOut = value('minOutValue', ctx.outScale), maxOut = value('maxOutValue', ctx.outScale);
  if ((minIn === null) !== (minOut === null) || (maxIn === null) !== (maxOut === null)) {
    throw new CLFError('<Range> values come in pairs: minInValue with minOutValue, maxInValue with maxOutValue.');
  }
  const hasMin = minIn !== null, hasMax = maxIn !== null;
  if (!hasMin && !hasMax) throw new CLFError('<Range> has no values.');
  const clamp = style === 'Clamp';

  if (hasMin && hasMax) {
    if (minIn > maxIn || Math.abs(maxIn - minIn) < 1e-6) {
      throw new CLFError('<Range> minInValue must be less than maxInValue.');
    }
    const scale = (maxOut - minOut) / (maxIn - minIn);
    return {
      type: 'range', scale, offset: minOut - scale * minIn,
      lo: clamp ? Math.min(minOut, maxOut) : -Infinity, hi: clamp ? Math.max(minOut, maxOut) : Infinity,
    };
  }
  // A single bound only clamps, so its in and out values must agree
  if (!clamp) throw new CLFError('A noClamp <Range> needs both min and max values.');
  const [vin, vout] = hasMin ? [minIn, minOut] : [maxIn, maxOut];
  if (Math.abs(vin - vout) > 1e-6 * Math.max(1, Math.abs(vin))) {
    throw new CLFError('With only a min or only a max, the <Range> in and out values must match after bit-depth scaling.');
  }
  return { type: 'range', scale: 1, offset: 0, lo: hasMin ? vout : -Infinity, hi: hasMax ? vout : Infinity };
}

const LOG_STYLES = ['log10', 'antiLog10', 'log2', 'antiLog2', 'linToLog', 'logToLin', 'cameraLinToLog', 'cameraLogToLin'];

function parseLog(el) {
  const style = styleOf(el, LOG_STYLES);
  const camera = style.startsWith('camera');
  const takesParams = camera || style === 'linToLog' || style === 'logToLin';
  const given = channelParams(el, 'LogParams', p => numericAttrs(p,
    ['base', 'logSideSlope', 'logSideOffset', 'linSideSlope', 'linSideOffset', 'linSideBreak', 'linearSlope']));
  if (!takesParams && given.some(Boolean)) throw new CLFError(`<Log> style ${style} takes no LogParams.`);

  const base = { log10: 10, antiLog10: 10, log2: 2, antiLog2: 2 }[style] ?? 2;
  const params = given.map(p => {
    const q = { base, logSideSlope: 1, logSideOffset: 0, linSideSlope: 1, linSideOffset: 0, ...p };
    if ('linSideBreak' in q && !camera) throw new CLFError(`<Log> style ${style} may not have linSideBreak.`);
    if ('linearSlope' in q && !camera) throw new CLFError(`<Log> style ${style} may not have linearSlope.`);
    if (camera && !('linSideBreak' in q)) throw new CLFError(`<Log> style ${style} needs linSideBreak.`);
    if (!(q.base > 0) || q.base === 1) throw new CLFError(`<Log> base ${q.base} is invalid.`);
    if (q.logSideSlope === 0 || q.linSideSlope === 0) throw new CLFError('<Log> slopes must not be 0.');
    if (camera) {
      // The linear segment meets the log curve at linSideBreak; unless given, its slope
      // matches the curve's there too
      q.linearSlope ??= q.logSideSlope * q.linSideSlope /
        ((q.linSideSlope * q.linSideBreak + q.linSideOffset) * Math.log(q.base));
      q.logSideBreak = q.logSideSlope * Math.log2(q.linSideSlope * q.linSideBreak + q.linSideOffset) /
        Math.log2(q.base) + q.logSideOffset;
      q.linearOffset = q.logSideBreak - q.linearSlope * q.linSideBreak;
    }
    return q;
  });
  const toLog = style === 'log10' || style === 'log2' || style === 'linToLog' || style === 'cameraLinToLog';
  return { type: 'log', toLog, camera, params };
}

const EXPONENT_STYLES = ['basicFwd', 'basicRev', 'basicMirrorFwd', 'basicMirrorRev', 'basicPassThruFwd',
  'basicPassThruRev', 'monCurveFwd', 'monCurveRev', 'monCurveMirrorFwd', 'monCurveMirrorRev'];

function parseExponent(el) {
  const style = styleOf(el, EXPONENT_STYLES);
  const monCurve = style.startsWith('monCurve');
  // Channels left unspecified pass through unchanged
  const params = channelParams(el, 'ExponentParams', p => {
    const a = numericAttrs(p, ['exponent', 'offset']);
    if (!('exponent' in a)) throw new CLFError('<ExponentParams> is missing its exponent.');
    if (monCurve) {
      if (!('offset' in a)) throw new CLFError(`<Exponent> style ${style} needs an offset.`);
      if (!(a.exponent >= 1)) throw new CLFError(`<Exponent> style ${style} needs an exponent of at least 1.`);
      if (!(a.offset >= 0 && a.offset <= 0.9)) throw new CLFError('<Exponent> offset must be between 0 and 0.9.');
    } else {
      if ('offset' in a) throw new CLFError(`<Exponent> style ${style} may not have an offset.`);
      if (!(a.exponent > 0)) throw new CLFError('<Exponent> exponent must be greater than 0.');
    }
    return a;
  }).map(p => p ?? { exponent: 1, offset: 0 });
  if (!childrenNamed(el, 'ExponentParams').length) throw new CLFError('<Exponent> has no ExponentParams.');
  return {
    type: 'exponent', monCurve, mirror: style.includes('Mirror'), passThru: style.includes('PassThru'),
    reverse: style.endsWith('Rev'), params: params.map(p => monCurve ? monCurveParams(p) : p),
  };
}

// Constants for the monCurve power-with-linear-toe curves. OpenColorIO keeps the
// exponent above 1 and the offset above 0 so an identity (1, 0) stays finite.
function monCurveParams({ exponent, offset }) {
  const EPS = 1e-6;
  const g = Math.max(exponent, 1 + EPS), o = Math.max(offset, EPS);
  return {
    g, o,
    breakFwd: o / (g - 1),
    slopeFwd: ((g - 1) / o) * Math.pow(o * g / ((g - 1) * (1 + o)), g),
    breakRev: Math.pow(o * g / ((g - 1) * (1 + o)), g),
    slopeRev: Math.pow((g - 1) / o, g - 1) * Math.pow((1 + o) / g, g),
  };
}

const CDL_STYLES = { fwd: 'Fwd', rev: 'Rev', fwdnoclamp: 'FwdNoClamp', revnoclamp: 'RevNoClamp',
  'v1.2_fwd': 'Fwd', 'v1.2_rev': 'Rev', noclampfwd: 'FwdNoClamp', noclamprev: 'RevNoClamp' };

function parseCDL(el) {
  const raw = el.getAttribute('style');
  const style = raw === null ? 'Fwd' : CDL_STYLES[raw.trim().toLowerCase()];
  if (!style) throw new CLFError(`<ASC_CDL> has an invalid style "${raw}".`);

  let slope = [1, 1, 1], offset = [0, 0, 0], power = [1, 1, 1], sat = 1;
  const sop = child(el, 'SOPNode');
  if (sop) {
    const triple = (tag) => {
      const c = child(sop, tag);
      if (!c) throw new CLFError(`<SOPNode> is missing <${tag}>.`);
      const v = numbers(c, `<${tag}>`);
      if (v.length !== 3) throw new CLFError(`<${tag}> must hold 3 numbers.`);
      return v;
    };
    [slope, offset, power] = [triple('Slope'), triple('Offset'), triple('Power')];
    if (slope.some(v => !(v >= 0))) throw new CLFError('<Slope> values must be 0 or more.');
    if (power.some(v => !(v > 0))) throw new CLFError('<Power> values must be greater than 0.');
  }
  const satNode = child(el, 'SatNode');
  if (satNode) {
    const s = child(satNode, 'Saturation');
    if (!s) throw new CLFError('<SatNode> is missing <Saturation>.');
    sat = single(s, '<Saturation>');
    if (!(sat >= 0)) throw new CLFError('<Saturation> must be 0 or more.');
  }
  return { type: 'cdl', reverse: style.startsWith('Rev'), clamp: !style.endsWith('NoClamp'), slope, offset, power, sat };
}

const NODE_PARSERS = {
  Matrix: parseMatrix, LUT1D: parseLUT1D, LUT3D: parseLUT3D, Range: parseRange,
  Log: parseLog, Exponent: parseExponent, ASC_CDL: parseCDL,
};

// ---- Evaluation ----

// Returns fn(c) that transforms c = [r, g, b] (normalized) in place
export function compileCLF(ops) {
  const steps = ops.map(op => COMPILERS[op.type](op));
  return (c) => {
    for (const step of steps) step(c);
    return c;
  };
}

const COMPILERS = {
  matrix({ m, o }) {
    return (c) => {
      const [r, g, b] = c;
      c[0] = m[0] * r + m[1] * g + m[2] * b + o[0];
      c[1] = m[3] * r + m[4] * g + m[5] * b + o[1];
      c[2] = m[6] * r + m[7] * g + m[8] * b + o[2];
    };
  },

  lut1d({ n, tables, halfDomain }) {
    const last = n - 1;
    if (halfDomain) {
      // Indexed by the normalized value's own half-float bits, whatever the inBitDepth
      return (c) => { for (let i = 0; i < 3; i++) c[i] = halfDomainLookup(tables[i], c[i]); };
    }
    return (c) => {
      for (let i = 0; i < 3; i++) {
        const t0 = c[i] * last;
        const t = t0 > 0 ? Math.min(t0, last) : 0;   // NaN lands on 0, as in OpenColorIO
        c[i] = lerpTable(tables[i], t);
      }
    };
  },

  lut3d({ n, data, tetrahedral }) {
    return (c) => lut3dLookup(data, n, c, tetrahedral);
  },

  range({ scale, offset, lo, hi }) {
    return (c) => {
      for (let i = 0; i < 3; i++) c[i] = Math.min(Math.max(c[i] * scale + offset, lo), hi);
    };
  },

  log({ toLog, camera, params }) {
    const fns = params.map(q => {
      const logBase = Math.log(q.base);
      const linToLog = (x) => q.logSideSlope * Math.log(Math.max(FLT_MIN, q.linSideSlope * x + q.linSideOffset)) / logBase + q.logSideOffset;
      const logToLin = (y) => (Math.pow(q.base, (y - q.logSideOffset) / q.logSideSlope) - q.linSideOffset) / q.linSideSlope;
      if (!camera) return toLog ? linToLog : logToLin;
      return toLog
        ? (x) => x < q.linSideBreak ? q.linearSlope * x + q.linearOffset : linToLog(x)
        : (y) => y < q.logSideBreak ? (y - q.linearOffset) / q.linearSlope : logToLin(y);
    });
    return (c) => { for (let i = 0; i < 3; i++) c[i] = fns[i](c[i]); };
  },

  exponent({ monCurve, mirror, passThru, reverse, params }) {
    const fns = params.map(p => {
      let f;
      if (monCurve) {
        f = reverse
          ? (y) => y <= p.breakRev ? y * p.slopeRev : Math.pow(y, 1 / p.g) * (1 + p.o) - p.o
          : (x) => x <= p.breakFwd ? x * p.slopeFwd : Math.pow((x + p.o) / (1 + p.o), p.g);
      } else {
        const e = reverse ? 1 / p.exponent : p.exponent;
        f = (x) => Math.pow(Math.max(0, x), e);
      }
      if (mirror) return (x) => Math.sign(x) * f(Math.abs(x));
      if (passThru) return (x) => x < 0 ? x : f(x);
      return f;
    });
    return (c) => { for (let i = 0; i < 3; i++) c[i] = fns[i](c[i]); };
  },

  cdl({ reverse, clamp, slope, offset, power, sat }) {
    // Inverting uses 1 / max(v, 0.01), as OpenColorIO does
    const rcp = (v) => 1 / Math.max(v, 0.01);
    const clamp01 = (c) => { if (clamp) for (let i = 0; i < 3; i++) c[i] = Math.min(Math.max(c[i], 0), 1); };
    const applyPower = (c, pw) => {
      for (let i = 0; i < 3; i++) {
        if (clamp) c[i] = Math.pow(Math.min(Math.max(c[i], 0), 1), pw[i]);
        else c[i] = Number.isNaN(c[i]) ? 0 : c[i] < 0 ? c[i] : Math.pow(c[i], pw[i]);
      }
    };
    const applySat = (c, s) => {
      const luma = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      for (let i = 0; i < 3; i++) c[i] = luma + s * (c[i] - luma);
    };
    if (!reverse) {
      return (c) => {
        for (let i = 0; i < 3; i++) c[i] = c[i] * slope[i] + offset[i];
        applyPower(c, power);
        applySat(c, sat);
        clamp01(c);
      };
    }
    const powerRev = power.map(rcp), slopeRev = slope.map(rcp), satRev = rcp(sat);
    return (c) => {
      clamp01(c);
      applySat(c, satRev);
      applyPower(c, powerRev);
      for (let i = 0; i < 3; i++) c[i] = (c[i] - offset[i]) * slopeRev[i];
      clamp01(c);
    };
  },
};

// Linear interpolation between neighbouring entries, written the way
// OpenColorIO does so an infinite entry isn't multiplied by 0
function lerpTable(table, t) {
  const lo = Math.floor(t), hi = Math.ceil(t);
  const delta = hi - t;
  return delta === 0 ? table[hi] : table[hi] + (table[lo] - table[hi]) * delta;
}

function lut3dLookup(data, n, c, tetrahedral) {
  const last = n - 1;
  const idx = [0, 0, 0], f = [0, 0, 0], nxt = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const t = c[i] * last;
    const tc = t > 0 ? Math.min(t, last) : 0;
    idx[i] = Math.floor(tc);
    nxt[i] = Math.min(idx[i] + 1, last);
    f[i] = tc - idx[i];
  }
  const at = (r, g, b) => ((r * n + g) * n + b) * 3;
  const corner = (dr, dg, db) => at(dr ? nxt[0] : idx[0], dg ? nxt[1] : idx[1], db ? nxt[2] : idx[2]);
  const [fr, fg, fb] = f;
  const out = [0, 0, 0];
  const add = (w, o) => { if (w) for (let i = 0; i < 3; i++) out[i] += w * data[o + i]; };

  if (tetrahedral) {
    const c000 = corner(0, 0, 0), c111 = corner(1, 1, 1);
    if (fr > fg) {
      if (fg > fb) { add(1 - fr, c000); add(fr - fg, corner(1, 0, 0)); add(fg - fb, corner(1, 1, 0)); add(fb, c111); }
      else if (fr > fb) { add(1 - fr, c000); add(fr - fb, corner(1, 0, 0)); add(fb - fg, corner(1, 0, 1)); add(fg, c111); }
      else { add(1 - fb, c000); add(fb - fr, corner(0, 0, 1)); add(fr - fg, corner(1, 0, 1)); add(fg, c111); }
    } else {
      if (fb > fg) { add(1 - fb, c000); add(fb - fg, corner(0, 0, 1)); add(fg - fr, corner(0, 1, 1)); add(fr, c111); }
      else if (fb > fr) { add(1 - fg, c000); add(fg - fb, corner(0, 1, 0)); add(fb - fr, corner(0, 1, 1)); add(fr, c111); }
      else { add(1 - fg, c000); add(fg - fr, corner(0, 1, 0)); add(fr - fb, corner(1, 1, 0)); add(fb, c111); }
    }
  } else {
    for (let dr = 0; dr < 2; dr++) for (let dg = 0; dg < 2; dg++) for (let db = 0; db < 2; db++) {
      add((dr ? fr : 1 - fr) * (dg ? fg : 1 - fg) * (db ? fb : 1 - fb), corner(dr, dg, db));
    }
  }
  c[0] = out[0]; c[1] = out[1]; c[2] = out[2];
}

// ---- 16-bit floats, for halfDomain and rawHalfs LUT1Ds ----

export function halfToFloat(bits) {
  const sign = bits & 0x8000 ? -1 : 1;
  const exp = (bits >> 10) & 0x1f, mant = bits & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 31) return mant ? NaN : sign * Infinity;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

const HALF_MAX_BITS = 0x7bff;

// Bits of the largest half-float at or below |x| (x finite, not NaN)
function halfBitsBelow(a) {
  if (a >= 65504) return HALF_MAX_BITS;
  let bits = a < 2 ** -14 ? Math.floor(a * 2 ** 24) : ((Math.floor(Math.log2(a)) + 15) << 10);
  if (a >= 2 ** -14) bits += Math.floor((a / 2 ** (Math.floor(Math.log2(a))) - 1) * 1024);
  // log2 can land a hair off at binade edges; nudge until bits brackets a
  while (bits > 0 && halfToFloat(bits) > a) bits--;
  while (bits < HALF_MAX_BITS && halfToFloat(bits + 1) <= a) bits++;
  return bits;
}

// A halfDomain table has one entry per half-float bit pattern. The input is
// interpolated between the two half-floats that bracket it.
function halfDomainLookup(table, x) {
  if (Number.isNaN(x)) return table[0x7e00];
  const sign = x < 0 ? 0x8000 : 0;
  const a = Math.abs(x);
  if (a === Infinity) return table[sign | 0x7c00];
  const lo = halfBitsBelow(a);
  if (lo === HALF_MAX_BITS) return table[sign | HALF_MAX_BITS];
  const hi = lo + 1;
  const fa = halfToFloat(lo), fb = halfToFloat(hi);
  const t = (a - fa) / (fb - fa);
  const va = table[sign | lo], vb = table[sign | hi];
  return t === 0 ? va : va + (vb - va) * t;
}
