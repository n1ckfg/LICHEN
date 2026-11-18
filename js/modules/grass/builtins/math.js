// builtins/math.js — SIN, COS, TAN, LOG, LN, SQRT, ABS, INT, POWER, the
// arcs, ARRDIM, etc. Math functions in GRASS work in degrees by default
// ($RD=0); RT/1's worked in radians only

export function registerMathCommands(interp) {
  const reg = interp.commands;

  // Helper: convert angle based on $RD mode
  function toRad(ctx, angle) {
    const rd = ctx.env.get('$RD');
    return rd ? angle : (angle * Math.PI / 180);
  }

  function fromRad(ctx, rad) {
    const rd = ctx.env.get('$RD');
    return rd ? rad : (rad * 180 / Math.PI);
  }

  // SIN(angle)
  reg.register('SIN', (args, switches, ctx) => {
    return Math.sin(toRad(ctx, args[0] || 0));
  }, 2);

  // COS(angle)
  reg.register('COS', (args, switches, ctx) => {
    return Math.cos(toRad(ctx, args[0] || 0));
  }, 2);

  // TAN(angle)
  reg.register('TAN', (args, switches, ctx) => {
    return Math.tan(toRad(ctx, args[0] || 0));
  }, 2);

  // ATAN(value) — arctangent, returns angle
  reg.register('ATAN', (args, switches, ctx) => {
    return fromRad(ctx, Math.atan(args[0] || 0));
  }, 2);

  // ARCSIN(v), ARCCOS(v) — the angle whose sine or cosine is v, which must
  // be from -1 to 1 (RT/1's CM2.C). ARCTAN is ATAN
  reg.register('ARCSIN', (args, switches, ctx) => {
    const v = args[0] || 0;
    if (Math.abs(v) > 1) throw new Error('ARCSIN of a number past -1 to 1');
    return fromRad(ctx, Math.asin(v));
  }, 4);
  reg.register('ARCCOS', (args, switches, ctx) => {
    const v = args[0] || 0;
    if (Math.abs(v) > 1) throw new Error('ARCCOS of a number past -1 to 1');
    return fromRad(ctx, Math.acos(v));
  }, 4);
  reg.register('ARCTAN', (args, switches, ctx) => {
    return fromRad(ctx, Math.atan(args[0] || 0));
  }, 4);

  // ATAN2(y, x) — two-argument arctangent
  reg.register('ATAN2', (args, switches, ctx) => {
    return fromRad(ctx, Math.atan2(args[0] || 0, args[1] || 0));
  }, 3);

  // LOG(value) — natural logarithm. RT/1's LOG was base 10; the UV-1
  // lessons don't say which Zgrass had, so it stays as it was
  reg.register('LOG', (args, switches, ctx) => {
    const v = args[0] || 0;
    if (v <= 0) throw new Error('LOG of non-positive number');
    return Math.log(v);
  }, 2);

  // LN(value) — natural logarithm, as RT/1 had it
  reg.register('LN', (args, switches, ctx) => {
    const v = args[0] || 0;
    if (v <= 0) throw new Error('LN of non-positive number');
    return Math.log(v);
  }, 2);

  // SQRT(value)
  reg.register('SQRT', (args, switches, ctx) => {
    const v = args[0] || 0;
    if (v < 0) throw new Error('SQRT of negative number');
    return Math.sqrt(v);
  }, 2);

  // ABS(value)
  reg.register('ABS', (args, switches, ctx) => {
    return Math.abs(args[0] || 0);
  }, 2);

  // INT(value) — truncate to integer
  reg.register('INT', (args, switches, ctx) => {
    return Math.floor(args[0] || 0);
  }, 2);

  // SGN(value) — sign: -1, 0, or 1
  reg.register('SGN', (args, switches, ctx) => {
    const v = args[0] || 0;
    return v > 0 ? 1 : (v < 0 ? -1 : 0);
  }, 2);

  // RND(n) — random number 0 to n-1
  reg.register('RND', (args, switches, ctx) => {
    const n = Math.floor(args[0] || 2);
    return Math.floor(Math.random() * n);
  }, 2);

  // MAX(a, b)
  reg.register('MAX', (args, switches, ctx) => {
    return Math.max(args[0] || 0, args[1] || 0);
  }, 2);

  // MIN(a, b)
  reg.register('MIN', (args, switches, ctx) => {
    return Math.min(args[0] || 0, args[1] || 0);
  }, 2);

  // EXP(value) — e^value
  reg.register('EXP', (args, switches, ctx) => {
    return Math.exp(args[0] || 0);
  }, 2);

  // POW(base, exponent), and POWER as RT/1 spelled it. RT/1's POWER refused
  // a negative exponent; here both take one, as POW always has
  const pow = (args) => Math.pow(args[0] || 0, args[1] || 0);
  reg.register('POW', pow, 2);
  reg.register('POWER', pow, 4);

  // ARRDIM(array, n) — the size of the array's dimension n, counting from 0;
  // 0 for a dimension it hasn't (RT/1's CM2.C). ARRAY FOO,200,10 gives
  // ARRDIM(FOO,0) 200, ARRDIM(FOO,1) 10 and ARRDIM(FOO,2) 0. Its arguments
  // come as AST nodes, so the array is named, not read
  reg.register('ARRDIM', (nodes, switches, ctx) => {
    if (nodes.length < 2) throw new Error('ARRDIM requires array, dimension');
    const { arr } = ctx.arrayNamed(nodes[0], 'ARRDIM');
    const n = Math.floor(ctx.eval(nodes[1]) || 0);
    return arr.dimensions[n] ?? 0;
  }, 4); // ARRD, so that AR is still ARRAY

  // PI — returns pi constant
  reg.register('PI', (args, switches, ctx) => {
    return Math.PI;
  }, 2);
}
