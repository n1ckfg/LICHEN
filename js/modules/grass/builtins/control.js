// builtins/control.js — GOTO, SKIP, RETURN, WAIT, TIMEOUT, ONERROR, STOP

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

  // STOP name, ... — stop the .B and .F macros running these macros, and
  // leave the rest running (lesson 11: "stop them selectively with the STOP
  // command"; RT/1's CM2.C). A macro may stop itself. A name may be
  // abbreviated, as when it was started. Returns how many were stopped
  reg.register('STOP', (args, switches, ctx) => {
    let stopped = 0;
    for (const arg of args) {
      const name = String(arg);
      const full = ctx.env.isMacro(name) ? name : ctx.env.resolvePrefix(name);
      stopped += ctx.scheduler.stop(full || name);
    }
    return stopped;
  }, 3); // STO, so that ST is still STR

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
