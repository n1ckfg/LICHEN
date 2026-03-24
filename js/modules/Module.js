import { vertSrc } from '../shaders/vert.js';

export class Module {
  constructor(type, glCanvas, id) {
    this.type = type;
    this.id = id;
    this.x = 200;
    this.y = 200;
    this.inputs = [];
    this.outputs = [];
    this.params = {};
    this.controlValues = {};
    this.shader = null;
    this.outputFBO = null;
    this.glCanvas = glCanvas;
    this.collapsed = false;
  }

  createShader(fragSrc) {
    this.shader = this.glCanvas.createShader(vertSrc, fragSrc);
  }

  createOutputFBO() {
    this.outputFBO = this.glCanvas.createFramebuffer();
  }

  getInput(graph, portIndex) {
    const connections = graph.getInputConnections(this.id);
    const conn = connections.find(c => c.toPort === portIndex);
    if (!conn) return null;
    const srcModule = graph.nodes.get(conn.fromId);
    if (!srcModule || !srcModule.outputFBO) return null;
    return srcModule.outputFBO;
  }

  renderQuad() {
    const g = this.glCanvas;
    g.noStroke();
    g.rect(-g.width / 2, -g.height / 2, g.width, g.height);
  }

  process(graph, glCanvas) {
    // Override in subclasses
  }

  setParam(name, value) {
    if (this.params[name]) {
      this.params[name].value = Math.max(
        this.params[name].min,
        Math.min(this.params[name].max, value)
      );
    }
  }

  getControlValue(portIndex) {
    const output = this.outputs[portIndex];
    return this.controlValues[output?.name] ?? 0;
  }

  getParam(name) {
    return this.params[name] ? this.params[name].value : 0;
  }

  dispose() {
    this.outputFBO = null;
    this.shader = null;
  }
}
