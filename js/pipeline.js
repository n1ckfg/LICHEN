import { ConnectionGraph } from './graph.js';
import { DEFAULT_FRAME_WIDTH, DEFAULT_FRAME_HEIGHT, MIN_FRAME_SIZE, MAX_FRAME_SIZE } from './frame.js';

export class ProcessingPipeline {
  constructor(glCanvas) {
    this.glCanvas = glCanvas;
    this.graph = new ConnectionGraph();
    // Each Monitor's Buffer Width and Height as last seen, to tell which one changed
    this._seenBuffer = new WeakMap();
    this._seenLoads = 0;
  }

  processFrame() {
    this._syncFrameSize();
    for (const nodeId of this.graph.sortedOrder) {
      const mod = this.graph.nodes.get(nodeId);
      if (!mod) continue;
      mod.process(this.graph, this.glCanvas);
    }
    // Apply control connections after all modules have processed
    for (const cc of this.graph.controlConnections) {
      const srcMod = this.graph.nodes.get(cc.fromId);
      const dstMod = this.graph.nodes.get(cc.toId);
      if (!srcMod || !dstMod) continue;
      const param = dstMod.params[cc.paramName];
      if (!param) continue;
      const cv = srcMod.getControlValue(cc.fromPort);
      const scaled = param.min + cv * (param.max - param.min);
      // A trigger param fires on the cable's rising edge through its midpoint
      const mid = (param.min + param.max) / 2;
      const fire = param.widget === 'trigger' && param.value < mid && scaled >= mid;
      dstMod.setParam(cc.paramName, scaled);
      if (fire) dstMod.fireTrigger(cc.paramName);
    }
  }

  // The frame size is the patch's, set by its Monitors' Buffer Width and
  // Buffer Height, which every Monitor in the patch shares (see Frame Size in
  // ARCHITECTURE.md):
  // - a Monitor whose values have changed since last frame sets it
  // - in a patch just loaded, the first Monitor sets it, or the default with none
  // - otherwise it stays, and a Monitor new to the patch takes it up
  // Every Monitor is then given it, and a new size resizes glCanvas.
  _syncFrameSize() {
    const g = this.glCanvas;
    const monitors = [];
    for (const mod of this.graph.nodes.values()) {
      if (mod.params.bufferWidth && mod.params.bufferHeight) monitors.push(mod);
    }
    const size = (m) => [m.params.bufferWidth.value, m.params.bufferHeight.value];
    let target = null;
    for (const m of monitors) {
      const seen = this._seenBuffer.get(m);
      const [w, h] = size(m);
      if (seen && (seen[0] !== w || seen[1] !== h)) {
        target = [w, h];
        break;
      }
    }
    const loaded = this.graph.loads !== this._seenLoads;
    this._seenLoads = this.graph.loads;
    if (!target && !monitors.some(m => this._seenBuffer.has(m))) {
      if (monitors.length) target = size(monitors[0]);
      else if (loaded) target = [DEFAULT_FRAME_WIDTH, DEFAULT_FRAME_HEIGHT];
    }
    target ??= [g.width, g.height];

    const fit = (v) => Math.max(MIN_FRAME_SIZE, Math.min(MAX_FRAME_SIZE, Math.round(v)));
    const [w, h] = [fit(target[0]), fit(target[1])];
    for (const m of monitors) {
      m.setParam('bufferWidth', w, false);
      m.setParam('bufferHeight', h, false);
      this._seenBuffer.set(m, [w, h]);
    }
    if (w !== g.width || h !== g.height) this.resizeFrame(w, h);
  }

  // Resizes glCanvas, which every framebuffer made without a size follows, and
  // tells each module, for what it sized itself
  resizeFrame(w, h) {
    this.glCanvas.resizeCanvas(w, h, true);
    for (const mod of this.graph.nodes.values()) mod.frameResized(w, h);
  }
}
