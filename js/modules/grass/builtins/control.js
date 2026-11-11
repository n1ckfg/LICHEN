// builtins/control.js — IF, GOTO, SKIP, RETURN, WAIT, ONERROR

export function registerControlCommands(interp) {
  const reg = interp.commands;

  // GOTO label — jump to label in current macro
  reg.register('GOTO', (args, switches, ctx) => {
    const label = String(args[0] || '');

    if (ctx.currentTask) {
      // Running in scheduler — modify task pc and signal
      ctx.scheduler.gotoLabel(ctx.currentTask, label);
      throw new Error('GOTO');
    }

    const mib = ctx.env.currentMIB();
    if (mib) {
      // Running in immediate macro
      const upper = label.toUpperCase();
      if (mib.labels.has(upper)) {
        mib.pc = mib.labels.get(upper);
        throw new Error('GOTO');
      }
      throw new Error(`Label not found: ${label}`);
    }

    throw new Error('GOTO outside of macro');
  }, 1);

  // SKIP n — relative jump (negative=back, positive=forward, 0=same line)
  reg.register('SKIP', (args, switches, ctx) => {
    const offset = Math.floor(args[0] || 0);

    if (ctx.currentTask) {
      ctx.scheduler.skip(ctx.currentTask, offset);
      throw new Error('SKIP');
    }

    const mib = ctx.env.currentMIB();
    if (mib) {
      mib.pc = mib.pc - 1 + offset;
      throw new Error('SKIP');
    }

    throw new Error('SKIP outside of macro');
  }, 2);

  // RETURN [value] — return from macro
  reg.register('RETURN', (args, switches, ctx) => {
    const err = new Error('RETURN');
    err.returnValue = args.length > 0 ? args[0] : 0;
    throw err;
  }, 1);

  // WAIT n — pause for n frames (1/60s each). The task's lines stop for this
  // frame and start again n frames on. Does nothing in a macro run inline
  reg.register('WAIT', (args, switches, ctx) => {
    const frames = Math.max(1, Math.floor(args[0] || 1));
    if (ctx.currentTask) {
      ctx.currentTask.sleep = frames - 1;
      ctx.currentTask.yielded = true;
    }
    return 1;
  }, 2);

  // TIMEOUT n — run the .F macro this is in once every n frames (1/60 s each)
  reg.register('TIMEOUT', (args, switches, ctx) => {
    const frames = Math.max(1, Math.floor(args[0] || 1));
    if (ctx.currentTask) ctx.currentTask.timeout = frames;
    return 1;
  }, 2);

  // ONERROR label — set error handler
  reg.register('ONERROR', (args, switches, ctx) => {
    const label = String(args[0] || '');
    const mib = ctx.env.currentMIB();
    if (mib) {
      mib.onErrorLabel = label;
    } else {
      ctx.env.onErrorLabel = label;
    }
    return 1;
  }, 3);
}
