// builtins/math.js — SIN, COS, TAN, LOG, SQRT, ABS, INT, etc.
// Math functions in ZGRASS work in degrees by default ($RD=0).

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

  // ATAN2(y, x) — two-argument arctangent
  reg.register('ATAN2', (args, switches, ctx) => {
    return fromRad(ctx, Math.atan2(args[0] || 0, args[1] || 0));
  }, 3);

  // LOG(value) — natural logarithm
  reg.register('LOG', (args, switches, ctx) => {
    const v = args[0] || 0;
    if (v <= 0) throw new Error('LOG of non-positive number');
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

  // POW(base, exponent)
  reg.register('POW', (args, switches, ctx) => {
    return Math.pow(args[0] || 0, args[1] || 0);
  }, 2);

  // PI — returns pi constant
  reg.register('PI', (args, switches, ctx) => {
    return Math.PI;
  }, 2);
}
