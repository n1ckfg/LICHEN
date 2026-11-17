// builtins/graphics.js — BOX, LINE, POINT, CIRCLE, CLEAR, SNAP, DISPLAY,
// FILL, CENTER, and RT/1's drawing modifiers MIRROR, MULTI, KALIEDOSCOPE,
// SPHERE, CORNER and KILL (see modifiers.js)

import { mirror, multi, kaleidoscope, sphere, corner } from '../modifiers.js';

export function registerGraphicsCommands(interp) {
  const reg = interp.commands;

  // A switch's letters, as RT/1 read them: MIRROR.XY is X and Y, as is
  // MIRROR.X.Y
  const has = (switches, letter) => switches.some(s => s.includes(letter));
  // A centre argument in GRASS coordinates, as a buffer pixel. Left out, it is
  // the CENTER
  const bx = (ctx, v) => ctx.fb.toBufferX(Math.floor(v ?? 0));
  const by = (ctx, v) => ctx.fb.toBufferY(Math.floor(v ?? 0));

  // CLEAR — clear TV screen; CLEAR.CRT clears terminal
  reg.register('CLEAR', (args, switches, ctx) => {
    if (switches.includes('CRT')) {
      ctx.terminal.clear();
    } else {
      ctx.fb.clear();
    }
    return 1;
  }, 2);

  // BOX xcenter, ycenter, xsize, ysize, colormode
  reg.register('BOX', (args, switches, ctx) => {
    const cx = Math.floor(args[0] || 0);
    const cy = Math.floor(args[1] || 0);
    const xsize = Math.floor(args[2] || 0);
    const ysize = Math.floor(args[3] || 0);
    const colormode = Math.floor(args[4] ?? 3) & 15;
    ctx.fb.box(cx, cy, xsize, ysize, colormode);
    return 1;
  }, 1);

  // LINE x, y, colormode [, thickness] — draw from current position to x,y.
  // A thickness over 1 draws a fat line, as RT/1's LINE did
  reg.register('LINE', (args, switches, ctx) => {
    const x = Math.floor(args[0] || 0);
    const y = Math.floor(args[1] || 0);
    const colormode = Math.floor(args[2] ?? 3) & 15;
    const thickness = Math.floor(args[3] ?? 1);
    ctx.fb.line(x, y, colormode, thickness);
    return 1;
  }, 1);

  // POINT x, y [, colormode] — set or read a pixel
  // Without colormode: returns pixel value at (x,y)
  // With colormode: sets pixel
  reg.register('POINT', (args, switches, ctx) => {
    const x = Math.floor(args[0] || 0);
    const y = Math.floor(args[1] || 0);
    if (args.length < 3) {
      // Read pixel
      return ctx.fb.getPixel(x, y);
    }
    const colormode = Math.floor(args[2]) & 15;
    ctx.fb.point(x, y, colormode);
    return 1;
  }, 3); // POI, so that P is PRINT

  // CIRCLE xcenter, ycenter, xradius, yradius, colormode
  reg.register('CIRCLE', (args, switches, ctx) => {
    const cx = Math.floor(args[0] ?? 0);
    const cy = Math.floor(args[1] ?? 0);
    const rx = Math.floor(args[2] ?? 10);
    const ry = Math.floor(args.length > 3 ? args[3] : (args[2] ?? 10));
    const colormode = Math.floor(args[4] ?? 3) & 15;
    ctx.fb.circle(cx, cy, rx, ry, colormode);
    return 1;
  }, 2);

  // SNAP name, x, y, xsize, ysize — capture screen region
  reg.register('SNAP', (args, switches, ctx) => {
    if (args.length < 5) throw new Error('SNAP requires name,x,y,xsize,ysize');
    const name = String(args[0]);
    const x = Math.floor(args[1]);
    const y = Math.floor(args[2]);
    const xsize = Math.floor(args[3]);
    const ysize = Math.floor(args[4]);
    const sprite = ctx.fb.snap(x, y, xsize, ysize);
    ctx.sprites.store(name, sprite);
    return 1;
  }, 2);

  // DISPLAY snap, x, y [, displaymode] — blit sprite
  reg.register('DISPLAY', (args, switches, ctx) => {
    if (args.length < 3) throw new Error('DISPLAY requires snap,x,y[,mode]');
    const name = String(args[0]);
    const x = Math.floor(args[1]);
    const y = Math.floor(args[2]);
    const mode = Math.floor(args[3] || 0);
    const sprite = ctx.sprites.get(name);
    if (!sprite) throw new Error(`Sprite ${name} not found`);
    ctx.fb.display(sprite, x, y, mode);
    return 1;
  }, 1);

  // FILL x, y [, colormode [, spacing]] — fill the area of one color around
  // (x, y). .L, .V, .D, .N and .C fill with lines spacing apart instead:
  // across, up and down, diagonal, the other diagonal, or crossed
  reg.register('FILL', (args, switches, ctx) => {
    const x = Math.floor(args[0] || 0);
    const y = Math.floor(args[1] || 0);
    const colormode = Math.floor(args[2] ?? 3) & 15;
    const pattern = ['L', 'V', 'D', 'N', 'C'].find(l => has(switches, l)) || null;
    return ctx.fb.fill(x, y, colormode, pattern, pattern ? args[3] ?? 2 : 1);
  }, 2);

  // CENTER x, y — put GRASS's (0, 0) at (x, y) from the screen's centre.
  // Every command's coordinates are measured from it, the modifiers' centres
  // too. CENTER 0,0 puts it back
  reg.register('CENTER', (args, switches, ctx) => {
    ctx.fb.centerX = Math.floor(args[0] || 0);
    ctx.fb.centerY = Math.floor(args[1] || 0);
    return 1;
  }, 2);

  // MIRROR.X, .Y or .XY [xc, yc] — draw everything also reflected across
  // x = xc, y = yc, or both (default the CENTER)
  reg.register('MIRROR', (args, switches, ctx) => {
    ctx.fb.setModifier(mirror(has(switches, 'X'), has(switches, 'Y'),
      bx(ctx, args[0]), by(ctx, args[1])));
    return 1;
  }, 3); // MIR, so that MI is still MIN

  // MULTI xsize, ysize [, xc, yc] — draw everything repeated every xsize by
  // ysize pixels over the screen; one size 0 repeats along one axis. .X and
  // .Y flip alternate tiles across xc and yc, .H adds checkerboard copies half
  // a tile over, and MULTI.C colormode, xsize, ysize... draws the copies in
  // another colormode. MULTI on its own, or 0,0, stops it
  reg.register('MULTI', (args, switches, ctx) => {
    const a = [...args];
    const centerCm = has(switches, 'C') ? Math.floor(a.shift() ?? 3) & 15 : null;
    ctx.fb.setModifier(multi({
      xsize: Math.floor(a[0] || 0), ysize: Math.floor(a[1] || 0),
      cx: bx(ctx, a[2]), cy: by(ctx, a[3]),
      flipX: has(switches, 'X'), flipY: has(switches, 'Y'),
      centerCm, half: has(switches, 'H'),
    }));
    return 1;
  }, 2);

  // KALIEDOSCOPE n [, xc, yc] — draw everything n times, turned in equal
  // steps about (xc, yc). KALIEDOSCOPE.C start, n... draws only what is in
  // the slice from angle start (degrees, or radians with $RD=1) and turns
  // that. 1, or no n, stops it. RT/1 spelled it so; KALEIDOSCOPE works too
  const kal = (args, switches, ctx) => {
    const a = [...args];
    const clip = has(switches, 'C');
    let start = 0;
    if (clip) {
      start = a.shift() ?? 0;
      if (!ctx.env.get('$RD')) start = start * Math.PI / 180;
    }
    ctx.fb.setModifier(kaleidoscope({
      n: Math.floor(a[0] ?? 1), cx: bx(ctx, a[1]), cy: by(ctx, a[2]), clip, start,
    }));
    return 1;
  };
  reg.register('KALIEDOSCOPE', kal, 2);
  reg.register('KALEIDOSCOPE', kal, 5);

  // SPHERE xc, yc, r — draw everything wrapped onto a sphere of radius r
  // about (xc, yc), so the whole screen fits in its disc. r 0 stops it
  reg.register('SPHERE', (args, switches, ctx) => {
    ctx.fb.setModifier(sphere(bx(ctx, args[0]), by(ctx, args[1]), Math.floor(args[2] || 0)));
    return 1;
  }, 3);

  // CORNER xsize, ysize — draw nothing in the xsize by ysize corner at the
  // screen's lower right, for an L-shaped window. 0,0 stops it
  reg.register('CORNER', (args, switches, ctx) => {
    ctx.fb.setModifier(corner(Math.floor(args[0] || 0), Math.floor(args[1] || 0)));
    return 1;
  }, 3);

  // KILL — stop every modifier: MIRROR, MULTI, KALIEDOSCOPE, SPHERE, CORNER.
  // CENTER stays where it is
  reg.register('KILL', (args, switches, ctx) => {
    ctx.fb.killModifiers();
    return 1;
  }, 2);

  // MOVE x, y — set current drawing position (cursor)
  reg.register('MOVE', (args, switches, ctx) => {
    ctx.fb.cursorX = Math.floor(args[0] || 0);
    ctx.fb.cursorY = Math.floor(args[1] || 0);
    return 1;
  }, 2);
}
