import { vertSrc } from '../shaders/vert.js';
import { StringSeed } from '../stringseed.js';

// A param's seed candidates: its step grid over the whole range (random: true)
// or over a narrower [lo, hi]. toPrecision drops the float drift of lo + i*step.
function seedCandidates(param) {
  const [lo, hi] = Array.isArray(param.random) ? param.random : [param.min, param.max];
  const n = Math.floor((hi - lo) / param.step + 1e-9) + 1;
  return Array.from({ length: n }, (_, i) => parseFloat((lo + i * param.step).toPrecision(12)));
}

export class Module {
  constructor(type, glCanvas, id) {
    this.type = type;
    this.id = id;
    this.x = 200;
    this.y = 200;
    // Each port and param declares an id of 4 hex digits, unique within the
    // module, and each subclass a static uid of 8: patches save these in place
    // of names and port numbers (see Patch IDs in ARCHITECTURE.md)
    this.inputs = [];
    this.outputs = [];
    this.params = {};
    this.controlValues = {};
    // Control output name -> a loop of samples, for control input pins (see
    // getControlInput). Knob cables still see only controlValues.
    this.controlSignals = {};
    this.shader = null;
    this.outputFBO = null;
    this.glCanvas = glCanvas;
    this.collapsed = false;
    // Name key into js/historical-info.json; null uses the type, and the info
    // button shows only when an entry has that name
    this.historicalInfo = null;
    // Hex seed the random params were last drawn from; null until randomize()
    this.seed = null;
    // Param name -> value before the first randomize(); null until then
    this.declared = null;
    // Trigger param name -> performance.now() it last fired, for the button flash
    this.triggeredAt = {};
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

  // Framebuffers are allocated at the graphics' pixel density, so on a retina
  // display gl_FragCoord runs over twice as many pixels as glCanvas.width and
  // glCanvas.height report. Any shader working in gl_FragCoord space -- and any
  // texel step derived from a resolution -- needs these, not the logical size.
  get pixelDensity() {
    return this.outputFBO ? this.outputFBO.density : 1;
  }

  fragResolution() {
    const d = this.pixelDensity;
    return [this.glCanvas.width * d, this.glCanvas.height * d];
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

  // What the control output cabled to input pin portIndex carries this frame:
  // { value, signal }, where value is its 0..1 control value and signal its loop
  // of samples, or null if it has none. null when nothing, or a video output, is
  // cabled there. The cable is in graph.connections, so the source has already
  // processed this frame.
  getControlInput(graph, portIndex) {
    const conn = graph.getInputConnections(this.id).find(c => c.toPort === portIndex);
    if (!conn) return null;
    const src = graph.nodes.get(conn.fromId);
    const output = src?.outputs[conn.fromPort];
    if (!output || output.type !== 'control') return null;
    return { value: src.controlValues[output.name] ?? 0, signal: src.controlSignals[output.name] ?? null };
  }

  getParam(name) {
    return this.params[name] ? this.params[name].value : 0;
  }

  // Seeded randomization (StringSeed, js/stringseed.js). Every param with a
  // `random` key is one axis, in declaration order, so axis i always reads
  // slice i of the seed. Omit `seed` to draw a fresh one sized to the axes.
  randomize(seed) {
    const ss = new StringSeed();
    for (const [name, param] of Object.entries(this.params)) {
      if (param.random) ss.addAxis(name, seedCandidates(param));
    }
    if (ss.axes.length === 0) return [];
    // Keep the values the first draw replaces. In a module that draws in its
    // constructor these are the declared ones, which ConnectionGraph.fromJSON
    // puts back for a param added since the patch was saved.
    this.declared ??= Object.fromEntries(Object.entries(this.params).map(([k, p]) => [k, p.value]));
    this.seed = seed ?? StringSeed.generateSeed(ss.requiredSeedBytes());
    const results = ss.resolve(this.seed);
    for (const r of results) this.setParam(r.axis, r.choice);
    return results;
  }

  // A trigger param (widget: 'trigger') fires on a click of its button, or when
  // a control cable driving it rises through 0.5. Modules act in onTrigger().
  fireTrigger(name) {
    this.triggeredAt[name] = performance.now();
    this.onTrigger(name);
  }

  onTrigger(name) {
    // Override in subclasses
  }

  // Text on a trigger param's button
  triggerText(name) {
    return '';
  }

  dispose() {
    this.outputFBO = null;
    this.shader = null;
  }
}
