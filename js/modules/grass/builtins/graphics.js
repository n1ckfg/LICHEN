// builtins/graphics.js — BOX, LINE, POINT, CIRCLE, CLEAR, SNAP, DISPLAY,
// FILL, CENTER, RT/1's shapes ELLIPSE, RBOX and POLYGON, and its drawing
// modifiers MIRROR, MULTI, KALIEDOSCOPE, SPHERE, CORNER, PATTERN and KILL
// (see modifiers.js)

import { mirror, multi, kaleidoscope, sphere, corner, pattern } from '../modifiers.js';

export function registerGraphicsCommands(interp) {
  const reg = interp.commands;

  // A switch's letters, as RT/1 read them: MIRROR.XY is X and Y, as is
  // MIRROR.X.Y
  const has = (switches, letter) => switches.some(s => s.includes(letter));
  // A centre argument in GRASS coordinates, as a buffer pixel. Left out, it is
  // the CENTER
  const bx = (ctx, v) => ctx.fb.toBufferX(Math.floor(v ?? 0));
  const by = (ctx, v) => ctx.fb.toBufferY(Math.floor(v ?? 0));
  // An angle in radians, given in degrees, or in radians with $RD=1, as SIN
  // takes it. RT/1's angles were always radians
  const radians = (ctx, a) => (ctx.env.get('$RD') ? a : a * Math.PI / 180);
  // GRASS points [[x, y], ...] about (cx, cy), turned counterclockwise by
  // `angle` radians, as buffer pixels. trunc: RT/1's POLYGON cut the
  // fractions off after turning. Else they are rounded, a half toward the
  // screen's top left as BOX places an even size (rounding off sin and cos's
  // last digits first, so a quarter turn's half stays a half)
  const placed = (ctx, cx, cy, pts, angle, trunc = false) => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const ox = ctx.fb.toBufferX(Math.floor(cx));
    const oy = ctx.fb.toBufferY(Math.floor(cy));
    const half = (v) => Math.ceil(Math.round(v * 1e6) / 1e6 - 0.5);
    return pts.map(([x, y]) => {
      const tx = x * c - y * s;
      const ty = x * s + y * c;
      return trunc ? [ox + Math.trunc(tx), oy - Math.trunc(ty)] : [half(ox + tx), half(oy - ty)];
    });
  };

  // CLEAR — clear TV screen; CLEAR.CRT clears terminal. CLEAR n clears the
  // screen to color n, 0 to 3, as RT/1's did
  reg.register('CLEAR', (args, switches, ctx) => {
    if (switches.includes('CRT')) {
      ctx.terminal.clear();
    } else {
      ctx.fb.clear(Math.floor(args[0] || 0));
    }
    return 1;
  }, 2, ['CRT']);

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

  // CIRCLE xcenter, ycenter, xradius, yradius, colormode. CIRCLE.F fills it
  // (RT/1)
  reg.register('CIRCLE', (args, switches, ctx) => {
    const cx = Math.floor(args[0] ?? 0);
    const cy = Math.floor(args[1] ?? 0);
    const rx = Math.floor(args[2] ?? 10);
    const ry = Math.floor(args.length > 3 ? args[3] : (args[2] ?? 10));
    const colormode = Math.floor(args[4] ?? 3) & 15;
    ctx.fb.circle(cx, cy, rx, ry, colormode, has(switches, 'F'));
    return 1;
  }, 2, ['F']);

  // ELLIPSE xcenter, ycenter, xradius, yradius, colormode, angle — CIRCLE's
  // ellipse turned counterclockwise by angle (RT/1). .F fills it. Turned by
  // a whole number of quarter turns, it is CIRCLE's to the pixel; turned
  // otherwise, it is drawn as a many-sided polygon
  reg.register('ELLIPSE', (args, switches, ctx) => {
    const cx = Math.floor(args[0] ?? 0);
    const cy = Math.floor(args[1] ?? 0);
    const rx = Math.abs(Math.floor(args[2] ?? 10));
    const ry = Math.abs(Math.floor(args.length > 3 ? args[3] : (args[2] ?? 10)));
    const colormode = Math.floor(args[4] ?? 3) & 15;
    const angle = radians(ctx, args[5] || 0);
    const fill = has(switches, 'F');
    // A half turn leaves an ellipse as it was, and a quarter turn swaps its
    // radii
    if (Math.abs(Math.sin(angle)) < 1e-9 || Math.abs(Math.cos(angle)) < 1e-9) {
      const quarter = Math.abs(Math.cos(angle)) < 1e-9;
      ctx.fb.circle(cx, cy, quarter ? ry : rx, quarter ? rx : ry, colormode, fill);
      return 1;
    }
    const n = Math.max(12, Math.ceil(Math.PI * Math.max(rx, ry)));
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * 2 * Math.PI;
      pts.push([rx * Math.cos(t), ry * Math.sin(t)]);
    }
    ctx.fb.shape(placed(ctx, cx, cy, pts, angle), colormode, fill);
    return 1;
  }, 2, ['F']);

  // RBOX xcenter, ycenter, xsize, ysize, angle, colormode [, width] — BOX's
  // outline turned counterclockwise by angle (RT/1's MEYERS.C), width pixels
  // wide. RBOX.F fills it, and at angle 0 is BOX. A size of 0 or less draws
  // nothing and gives -1, as on RT/1
  reg.register('RBOX', (args, switches, ctx) => {
    const xs = Math.floor(args[2] || 0);
    const ys = Math.floor(args[3] || 0);
    if (xs <= 0 || ys <= 0) return -1;
    const angle = radians(ctx, args[4] || 0);
    const colormode = Math.floor(args[5] ?? 3) & 15;
    const width = Math.floor(args[6] ?? 1);
    // The corners of an xs by ys box: BOX's, so a box 51 wide spans 51
    const hx = (xs - 1) / 2;
    const hy = (ys - 1) / 2;
    const pts = [[hx, hy], [-hx, hy], [-hx, -hy], [hx, -hy]];
    ctx.fb.shape(placed(ctx, args[0] ?? 0, args[1] ?? 0, pts, angle), colormode,
      has(switches, 'F'), width);
    return 1;
  }, 2, ['F']);

  // POLYGON array, colormode, xcenter, ycenter [, xscale, yscale] [, angle] —
  // the points of an N by 2 array (x in (i,0), y in (i,1)) joined in order,
  // the last back to the first, about (xcenter, ycenter), scaled and then
  // turned (RT/1's MEYERS.C). One extra argument is the angle, two the
  // scales, three both. POLYGON.F fills it; RT/1's two scratch arrays before
  // the array may be given, and are not needed
  reg.register('POLYGON', (nodes, switches, ctx) => {
    let a = nodes;
    const fill = has(switches, 'F');
    const isArray = (n) => { try { ctx.arrayNamed(n, 'POLYGON'); return true; } catch { return false; } };
    if (fill && a.length >= 3 && !isArray(a[0]) && isArray(a[2])) a = a.slice(2);
    if (a.length < 4) throw new Error('POLYGON requires array, colormode, xcenter, ycenter');
    const { name, arr } = ctx.arrayNamed(a[0], 'POLYGON');
    if (arr.dimensions.length !== 2 || arr.dimensions[1] !== 2) {
      throw new Error(`POLYGON needs an N by 2 array of points, and ${name} is not one`);
    }
    const [colormode, cx, cy, ...opt] = a.slice(1).map(n => ctx.eval(n));
    let [xsc, ysc, angle] = [1, 1, 0];
    if (opt.length === 1) angle = opt[0];
    else if (opt.length >= 2) [xsc, ysc, angle = 0] = opt;
    const pts = [];
    for (let i = 0; i < arr.dimensions[0]; i++) {
      pts.push([arr.data[i * 2] * xsc, arr.data[i * 2 + 1] * ysc]);
    }
    ctx.fb.shape(placed(ctx, cx ?? 0, cy ?? 0, pts, radians(ctx, angle || 0), true),
      Math.floor(colormode ?? 3) & 15, fill);
    return 1;
  }, 3, ['F']); // POL, so that PO is still POW


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
  }, 2, ['L', 'V', 'D', 'N', 'C']);

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
  }, 3, ['X', 'Y']); // MIR, so that MI is still MIN

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
  }, 2, ['X', 'Y', 'C', 'H']);

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
  reg.register('KALIEDOSCOPE', kal, 2, ['C']);
  reg.register('KALEIDOSCOPE', kal, 5, ['C']);

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

  // PATTERN array — draw everything in the colormodes of a 2D array, xsize by
  // ysize, repeated across the screen: element (i,j) is used i pixels right
  // and j up from the pattern's origin, whatever colormode a command gives
  // (RT/1's MODIFIER.C). The array is copied, so changing it later changes
  // nothing until PATTERN is given it again. PATTERN on its own stops it.
  // PATTERN.C x, y puts the origin at (x, y), which starts at (0, 0)
  reg.register('PATTERN', (nodes, switches, ctx) => {
    const fb = ctx.fb;
    if (has(switches, 'C')) {
      const [x, y] = nodes.map(n => ctx.eval(n));
      fb.patternOrigin = [bx(ctx, x), by(ctx, y)];
      const live = fb.modifiers.find(m => m.kind === 'PATTERN');
      if (live) [live.ox, live.oy] = fb.patternOrigin;
      return 1;
    }
    const [ox, oy] = fb.patternOrigin ?? [bx(ctx, 0), by(ctx, 0)];
    if (nodes.length === 0) {
      fb.setModifier(pattern(null, 1, 1, ox, oy));
      return 1;
    }
    const { name, arr } = ctx.arrayNamed(nodes[0], 'PATTERN');
    if (arr.dimensions.length !== 2) {
      throw new Error(`PATTERN needs a 2D array (ARRAY ${name},xsize,ysize)`);
    }
    fb.setModifier(pattern(arr.data.slice(), arr.dimensions[0], arr.dimensions[1], ox, oy));
    return 1;
  }, 3, ['C']); // PAT

  // KILL — stop every modifier: MIRROR, MULTI, KALIEDOSCOPE, SPHERE, CORNER,
  // PATTERN. CENTER, and PATTERN.C's origin, stay where they are
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
