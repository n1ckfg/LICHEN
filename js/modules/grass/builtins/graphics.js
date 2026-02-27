// builtins/graphics.js — BOX, LINE, POINT, CIRCLE, CLEAR, SNAP, DISPLAY

export function registerGraphicsCommands(interp) {
  const reg = interp.commands;

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
    const halfW = Math.floor(args[2] || 0);
    const halfH = Math.floor(args[3] || 0);
    const colormode = Math.floor(args[4] ?? 3) & 15;
    ctx.fb.box(cx, cy, halfW, halfH, colormode);
    return 1;
  }, 1);

  // LINE x, y, colormode — draw from current position to x,y
  reg.register('LINE', (args, switches, ctx) => {
    const x = Math.floor(args[0] || 0);
    const y = Math.floor(args[1] || 0);
    const colormode = Math.floor(args[2] ?? 3) & 15;
    ctx.fb.line(x, y, colormode);
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
  }, 1);

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
    const halfW = Math.floor(args[3]);
    const halfH = Math.floor(args[4]);
    const sprite = ctx.fb.snap(x, y, halfW, halfH);
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

  // MOVE x, y — set current drawing position (cursor)
  reg.register('MOVE', (args, switches, ctx) => {
    ctx.fb.cursorX = Math.floor(args[0] || 0);
    ctx.fb.cursorY = Math.floor(args[1] || 0);
    return 1;
  }, 2);
}
