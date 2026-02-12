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
  }
}
