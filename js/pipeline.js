import { ConnectionGraph } from './graph.js';

export class ProcessingPipeline {
  constructor(glCanvas) {
    this.glCanvas = glCanvas;
    this.graph = new ConnectionGraph();
  }

  processFrame() {
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
}
