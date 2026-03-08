import { createModule, getRegistry } from './moduleRegistry.js';
import { vertSrc } from './shaders/vert.js';
const blitFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
void main() {
  gl_FragColor = texture2D(tex0, vec2(vTexCoord.x, 1.0 - vTexCoord.y));
}
`;

const MODULE_CATEGORIES = {
  'Sources': ['Camera', 'GRASS', 'NAPLPS', 'Oscillator', 'VideoPlayer'],
  'Core': ['AdderMultiplier', 'ColorEncoder', 'Comparator', 'Differentiator', 'FunctionGenerator', 'SyncGenerator', 'ValueScrambler'],
  'Effects': ['Delay', 'Film', 'GameBoy', 'Glitch', 'HyperCard', 'PixelVision', 'TimeTunnel', 'TV', 'VHSC'],
  'Output': ['Monitor'],
};

const MODULE_COLORS = {
  Camera: [34, 85, 170],
  VideoPlayer: [34, 85, 170],
  NAPLPS: [170, 85, 136],
  Oscillator: [34, 136, 85],
  Monitor: [170, 85, 34],
  Comparator: [136, 85, 34],
  FunctionGenerator: [85, 136, 34],
  AdderMultiplier: [102, 68, 136],
  Differentiator: [136, 102, 68],
  ColorEncoder: [170, 68, 102],
  SyncGenerator: [68, 136, 102],
  ValueScrambler: [102, 102, 68],
  TV: [85, 85, 119],
  Film: [85, 85, 119],
  VHSC: [85, 85, 119],
  PixelVision: [85, 85, 119],
  TimeTunnel: [85, 85, 119],
  GameBoy: [85, 85, 119],
  HyperCard: [85, 85, 119],
  Delay: [68, 102, 136],
  Glitch: [102, 68, 85],
  GRASS: [34, 120, 68],
};

const MODULE_WIDTH = 160;
const HEADER_HEIGHT = 24;
const PORT_RADIUS = 7;
const PORT_SPACING = 24;
const PARAM_ROW_HEIGHT = 20;
const KNOB_RADIUS = 7;
const MONITOR_PREVIEW_W = 152;
const MONITOR_PREVIEW_H = 114;
const PREVIEW_W = 80;
const PREVIEW_H = 60;

export class NodeGraphUI {
  constructor(pipeline, p) {
    this.pipeline = pipeline;
    this.p = p;
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1.0;
    this.draggingNode = null;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;
    this.dragStartX = 0;      // screen coords at drag mousedown
    this.dragStartY = 0;
    this.dragActive = false;  // true only after mouse moves beyond dead zone
    this.draggingCable = null;
    this.pendingCable = null;     // click-to-connect: cable follows mouse after click-release on outlet
    this._pendingTarget = null;   // input port being clicked while pendingCable is active
    this.draggingKnob = null;
    this._fullscreenExitTime = 0; // prevents double-click from immediately re-entering fullscreen
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;
    this.panStartPanX = 0;
    this.panStartPanY = 0;
    this.selectedNode = null;
    this.fullscreenMonitor = null;
    this._blitShader = null;
    this._activeParamInput = null; // currently active inline text input

    this._createPalette();
    this._addDefaultNodes();
    this._searchPopup = null;
    this._allModuleTypes = Object.values(MODULE_CATEGORIES).flat().sort();
  }

  // Render a Framebuffer onto the P2D main canvas by blitting through glCanvas
  _drawFBO(fbo, x, y, w, h) {
    if (!fbo) return;
    const g = this.pipeline.glCanvas;
    if (!this._blitShader) {
      this._blitShader = g.createShader(vertSrc, blitFrag);
    }
    g.shader(this._blitShader);
    this._blitShader.setUniform('tex0', fbo);
    g.noStroke();
    g.rect(-g.width / 2, -g.height / 2, g.width, g.height);
    this.p.image(g, x, y, w, h);
  }

  _createPalette() {
    const palette = document.createElement('div');
    palette.id = 'module-palette';

    const title = document.createElement('h3');
    title.textContent = 'Modules';
    palette.appendChild(title);

    for (const [category, types] of Object.entries(MODULE_CATEGORIES)) {
      const section = document.createElement('div');
      section.className = 'palette-section';
      const sectionTitle = document.createElement('div');
      sectionTitle.className = 'palette-section-title';
      sectionTitle.textContent = category;
      section.appendChild(sectionTitle);

      for (const typeName of types) {
        const btn = document.createElement('button');
        btn.textContent = typeName;
        btn.addEventListener('click', () => this._addModule(typeName));
        section.appendChild(btn);
      }
      palette.appendChild(section);
    }

    document.body.appendChild(palette);
    this._paletteEl = palette;
  }

  _addDefaultNodes() {
    const mod = createModule('Monitor', this.pipeline.glCanvas, this.pipeline.graph.nextId);
    const h = this.getModuleHeight(mod);
    // Halfway between window center and lower-right corner = 75% of each dimension
    mod.x = this.p.width * 0.75 - MODULE_WIDTH / 2;
    mod.y = this.p.height * 0.75 - h / 2;
    this.pipeline.graph.addNode(mod);
  }

  _addModule(typeName) {
    const graph = this.pipeline.graph;
    const glCanvas = this.pipeline.glCanvas;
    const mod = createModule(typeName, glCanvas, graph.nextId);
    // Place near center of viewport
    const cx = (-this.panX + this.p.width / 2) / this.zoom;
    const cy = (-this.panY + this.p.height / 2) / this.zoom;
    mod.x = cx + (Math.random() - 0.5) * 100;
    mod.y = cy + (Math.random() - 0.5) * 100;
    graph.addNode(mod);
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.panX) / this.zoom,
      y: (sy - this.panY) / this.zoom,
    };
  }

  worldToScreen(wx, wy) {
    return {
      x: wx * this.zoom + this.panX,
      y: wy * this.zoom + this.panY,
    };
  }

  getModuleHeight(mod) {
    const portRows = Math.max(mod.inputs.length, mod.outputs.length);
    const portSection = portRows > 0 ? portRows * PORT_SPACING + 8 : 0;
    const paramCount = Object.keys(mod.params).length;
    const paramSection = paramCount * PARAM_ROW_HEIGHT;
    const hasPreview = mod.outputFBO && mod.type !== 'Monitor' && mod.type !== 'GRASS';
    const previewSection = hasPreview ? PREVIEW_H + 8 : 0;
    const monitorSection = (mod.type === 'Monitor' || mod.type === 'GRASS') ? MONITOR_PREVIEW_H + 8 : 0;
    const hasFileBtn = mod.type === 'VideoPlayer' || mod.type === 'NAPLPS';
    const fileBtnSection = hasFileBtn ? 24 : 0;
    return HEADER_HEIGHT + portSection + paramSection + previewSection + monitorSection + fileBtnSection + 12;
  }

  getInputPortPos(mod, index) {
    const count = mod.inputs.length;
    const totalWidth = (count - 1) * (MODULE_WIDTH / (count + 1));
    const startX = mod.x + MODULE_WIDTH / (count + 1);
    return {
      x: mod.x + (index + 1) * MODULE_WIDTH / (count + 1),
      y: mod.y + HEADER_HEIGHT + 14,
    };
  }

  getOutputPortPos(mod, index) {
    const count = mod.outputs.length;
    const h = this.getModuleHeight(mod);
    return {
      x: mod.x + (index + 1) * MODULE_WIDTH / (count + 1),
      y: mod.y + h - 14,
    };
  }

  getParamY(mod, paramIndex) {
    const portRows = Math.max(mod.inputs.length, mod.outputs.length);
    const portSection = portRows > 0 ? portRows * PORT_SPACING + 8 : 0;
    return mod.y + HEADER_HEIGHT + portSection + paramIndex * PARAM_ROW_HEIGHT + 10;
  }

  hitTestPort(wx, wy) {
    const graph = this.pipeline.graph;
    for (const [id, mod] of graph.nodes) {
      for (let i = 0; i < mod.inputs.length; i++) {
        const pos = this.getInputPortPos(mod, i);
        if (Math.hypot(wx - pos.x, wy - pos.y) < PORT_RADIUS + 4) {
          return { nodeId: id, portType: 'input', portIndex: i };
        }
      }
      for (let i = 0; i < mod.outputs.length; i++) {
        const pos = this.getOutputPortPos(mod, i);
        if (Math.hypot(wx - pos.x, wy - pos.y) < PORT_RADIUS + 4) {
          return { nodeId: id, portType: 'output', portIndex: i };
        }
      }
    }
    return null;
  }

  hitTestNode(wx, wy) {
    const graph = this.pipeline.graph;
    // Check in reverse order (top-most first)
    const ids = Array.from(graph.nodes.keys()).reverse();
    for (const id of ids) {
      const mod = graph.nodes.get(id);
      const h = this.getModuleHeight(mod);
      if (wx >= mod.x && wx <= mod.x + MODULE_WIDTH &&
          wy >= mod.y && wy <= mod.y + h) {
        return id;
      }
    }
    return null;
  }

  hitTestKnob(wx, wy) {
    const graph = this.pipeline.graph;
    for (const [id, mod] of graph.nodes) {
      const paramNames = Object.keys(mod.params);
      for (let i = 0; i < paramNames.length; i++) {
        const py = this.getParamY(mod, i);
        const kx = mod.x + 16;
        const ky = py + 4;
        if (Math.hypot(wx - kx, wy - ky) < KNOB_RADIUS + 4) {
          return { nodeId: id, paramName: paramNames[i], startY: wy, startValue: mod.params[paramNames[i]].value };
        }
      }
    }
    return null;
  }

  hitTestKnobPort(wx, wy) {
    const graph = this.pipeline.graph;
    for (const [id, mod] of graph.nodes) {
      const paramNames = Object.keys(mod.params);
      for (let i = 0; i < paramNames.length; i++) {
        const py = this.getParamY(mod, i);
        const kx = mod.x + 16;
        const ky = py + 4;
        if (Math.hypot(wx - kx, wy - ky) < KNOB_RADIUS + 4) {
          return { nodeId: id, paramName: paramNames[i] };
        }
      }
    }
    return null;
  }

  hitTestParamValue(wx, wy) {
    const graph = this.pipeline.graph;
    for (const [id, mod] of graph.nodes) {
      const paramNames = Object.keys(mod.params);
      for (let i = 0; i < paramNames.length; i++) {
        const py = this.getParamY(mod, i);
        const ky = py + 4;
        const rx = mod.x + MODULE_WIDTH - 8;
        // Value text region: roughly 40px wide, 14px tall, right-aligned
        if (wx >= rx - 40 && wx <= rx && wy >= ky - 7 && wy <= ky + 7) {
          return { nodeId: id, paramName: paramNames[i], paramIndex: i };
        }
      }
    }
    return null;
  }

  _isControlled(nodeId, paramName) {
    return this.pipeline.graph.controlConnections.some(
      c => c.toId === nodeId && c.paramName === paramName
    );
  }

  _openParamInput(nodeId, paramName, paramIndex) {
    this._closeParamInput();
    const mod = this.pipeline.graph.nodes.get(nodeId);
    if (!mod) return;
    const param = mod.params[paramName];
    if (!param) return;

    const py = this.getParamY(mod, paramIndex);
    const ky = py + 4;
    const rx = mod.x + MODULE_WIDTH - 8;

    // Convert world coords to screen
    const screen = this.worldToScreen(rx - 44, ky - 8);
    const inputW = 48 * this.zoom;
    const inputH = 16 * this.zoom;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = param.step >= 1 ? param.value.toFixed(0) : param.value.toFixed(2);
    Object.assign(input.style, {
      position: 'absolute',
      left: screen.x + 'px',
      top: screen.y + 'px',
      width: inputW + 'px',
      height: inputH + 'px',
      fontSize: (9 * this.zoom) + 'px',
      fontFamily: 'monospace',
      textAlign: 'right',
      background: '#1a1a2a',
      color: '#fff',
      border: '1px solid #6cf',
      borderRadius: '2px',
      padding: '0 3px',
      outline: 'none',
      zIndex: '1000',
      boxSizing: 'border-box',
    });

    const commit = () => {
      const val = parseFloat(input.value);
      if (!isNaN(val)) {
        mod.setParam(paramName, val);
      }
      this._closeParamInput();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); this._closeParamInput(); }
      e.stopPropagation();
    });
    input.addEventListener('blur', commit);

    document.body.appendChild(input);
    input.select();
    input.focus();
    this._activeParamInput = { el: input, nodeId, paramName };
  }

  _closeParamInput() {
    if (this._activeParamInput) {
      this._activeParamInput.el.remove();
      this._activeParamInput = null;
    }
  }

  _openSearchPopup(screenX, screenY) {
    this._closeSearchPopup();

    const world = this.screenToWorld(screenX, screenY);

    const container = document.createElement('div');
    container.className = 'module-search-popup';
    Object.assign(container.style, {
      position: 'absolute',
      left: screenX + 'px',
      top: screenY + 'px',
      background: '#1a1a2a',
      border: '1px solid #6cf',
      borderRadius: '4px',
      padding: '4px',
      zIndex: '1001',
      minWidth: '160px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    });

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Search modules...';
    Object.assign(input.style, {
      width: '100%',
      padding: '6px 8px',
      fontSize: '12px',
      fontFamily: 'monospace',
      background: '#252535',
      color: '#fff',
      border: '1px solid #444',
      borderRadius: '3px',
      outline: 'none',
      boxSizing: 'border-box',
    });

    const resultsList = document.createElement('div');
    Object.assign(resultsList.style, {
      marginTop: '4px',
      maxHeight: '200px',
      overflowY: 'auto',
    });

    container.appendChild(input);
    container.appendChild(resultsList);
    document.body.appendChild(container);

    let selectedIndex = 0;
    let filteredModules = [...this._allModuleTypes];

    const updateSelection = () => {
      const items = resultsList.children;
      for (let i = 0; i < items.length; i++) {
        items[i].style.color = i === selectedIndex ? '#fff' : '#aaa';
        items[i].style.background = i === selectedIndex ? '#3a5a8a' : 'transparent';
      }
    };

    const renderResults = () => {
      resultsList.innerHTML = '';
      filteredModules.forEach((mod, i) => {
        const item = document.createElement('div');
        item.textContent = mod;
        Object.assign(item.style, {
          padding: '6px 8px',
          cursor: 'pointer',
          fontSize: '11px',
          fontFamily: 'monospace',
          color: i === selectedIndex ? '#fff' : '#aaa',
          background: i === selectedIndex ? '#3a5a8a' : 'transparent',
          borderRadius: '2px',
        });
        item.addEventListener('mouseenter', () => {
          selectedIndex = i;
          updateSelection();
        });
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._addModuleAt(mod, world.x, world.y);
          this._closeSearchPopup();
        });
        resultsList.appendChild(item);
      });
    };

    const updateFilter = () => {
      const query = input.value.toLowerCase();
      filteredModules = this._allModuleTypes.filter(m => m.toLowerCase().includes(query));
      selectedIndex = 0;
      renderResults();
    };

    input.addEventListener('input', updateFilter);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, filteredModules.length - 1);
        renderResults();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        renderResults();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredModules.length > 0) {
          this._addModuleAt(filteredModules[selectedIndex], world.x, world.y);
          this._closeSearchPopup();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this._closeSearchPopup();
      }
      e.stopPropagation();
    });

    // Close on click outside
    const closeOnClickOutside = (e) => {
      if (!container.contains(e.target)) {
        this._closeSearchPopup();
        document.removeEventListener('mousedown', closeOnClickOutside);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closeOnClickOutside), 0);

    renderResults();
    input.focus();
    this._searchPopup = { el: container, closeHandler: closeOnClickOutside };
  }

  _closeSearchPopup() {
    if (this._searchPopup) {
      document.removeEventListener('mousedown', this._searchPopup.closeHandler);
      this._searchPopup.el.remove();
      this._searchPopup = null;
    }
  }

  _addModuleAt(typeName, worldX, worldY) {
    const graph = this.pipeline.graph;
    const glCanvas = this.pipeline.glCanvas;
    const mod = createModule(typeName, glCanvas, graph.nextId);
    mod.x = worldX;
    mod.y = worldY;
    graph.addNode(mod);
  }

  hitTestMonitorDblClick(wx, wy) {
    const graph = this.pipeline.graph;
    for (const [id, mod] of graph.nodes) {
      const portRows = Math.max(mod.inputs.length, mod.outputs.length);
      const portSection = portRows > 0 ? portRows * PORT_SPACING + 8 : 0;

      if (mod.type === 'Monitor' || mod.type === 'GRASS') {
        // Large preview area
        const py = mod.y + HEADER_HEIGHT + portSection;
        if (wx >= mod.x + 4 && wx <= mod.x + 4 + MONITOR_PREVIEW_W &&
            wy >= py && wy <= py + MONITOR_PREVIEW_H) {
          return id;
        }
      } else if (mod.outputFBO) {
        // Small preview thumbnail
        const paramCount = Object.keys(mod.params).length;
        const paramSection = paramCount * PARAM_ROW_HEIGHT;
        const py = mod.y + HEADER_HEIGHT + portSection + paramSection + 4;
        const px = mod.x + (MODULE_WIDTH - PREVIEW_W) / 2;
        if (wx >= px && wx <= px + PREVIEW_W &&
            wy >= py && wy <= py + PREVIEW_H) {
          return id;
        }
      }
    }
    return null;
  }

  hitTestVideoPlayerBtn(wx, wy) {
    const graph = this.pipeline.graph;
    for (const [id, mod] of graph.nodes) {
      if (mod.type !== 'VideoPlayer' && mod.type !== 'NAPLPS') continue;
      const portRows = Math.max(mod.inputs.length, mod.outputs.length);
      const portSection = portRows > 0 ? portRows * PORT_SPACING + 8 : 0;
      const paramCount = Object.keys(mod.params).length;
      const paramSection = paramCount * PARAM_ROW_HEIGHT;
      const hasPreview = mod.outputFBO;
      const previewSection = hasPreview ? PREVIEW_H + 8 : 0;
      const btnY = mod.y + HEADER_HEIGHT + portSection + paramSection + previewSection;
      if (wx >= mod.x + 10 && wx <= mod.x + MODULE_WIDTH - 10 &&
          wy >= btnY && wy <= btnY + 20) {
        return id;
      }
    }
    return null;
  }

  draw() {
    const p = this.p;
    const graph = this.pipeline.graph;

    // Show/hide sidebar based on fullscreen state
    this._paletteEl.style.display = this.fullscreenMonitor !== null ? 'none' : '';

    // Draw fullscreen module if active
    if (this.fullscreenMonitor !== null) {
      const mod = graph.nodes.get(this.fullscreenMonitor);
      if (mod) {
        p.background(0);
        const aspect = 640 / 480;
        let dw = p.width;
        let dh = p.width / aspect;
        if (dh > p.height) {
          dh = p.height;
          dw = p.height * aspect;
        }
        const dx = (p.width - dw) / 2;
        const dy = (p.height - dh) / 2;

        if (mod.type === 'GRASS') {
          // Update mouse device vars while GRASS is fullscreened
          mod.updateMouseFromCanvas(p.mouseX, p.mouseY, p.width, p.height);
          if (mod.outputFBO) {
            this._drawFBO(mod.outputFBO, dx, dy, dw, dh);
          }
          // Render terminal/REPL overlays on top of the clean video
          mod.renderOverlays(p);
        } else if (mod.type === 'Monitor') {
          if (mod.displayTexture) {
            this._drawFBO(mod.displayTexture, dx, dy, dw, dh);
          }
        } else if (mod.outputFBO) {
          this._drawFBO(mod.outputFBO, dx, dy, dw, dh);
        }
      }
      return;
    }

    p.push();
    p.translate(this.panX, this.panY);
    p.scale(this.zoom);

    // Draw cables
    for (const conn of graph.connections) {
      const fromMod = graph.nodes.get(conn.fromId);
      const toMod = graph.nodes.get(conn.toId);
      if (!fromMod || !toMod) continue;
      const from = this.getOutputPortPos(fromMod, conn.fromPort);
      const to = this.getInputPortPos(toMod, conn.toPort);
      this._drawCable(p, from.x, from.y, to.x, to.y, [100, 180, 255]);
    }

    // Draw control cables (green)
    for (const cc of graph.controlConnections) {
      const fromMod = graph.nodes.get(cc.fromId);
      const toMod = graph.nodes.get(cc.toId);
      if (!fromMod || !toMod) continue;
      const from = this.getOutputPortPos(fromMod, cc.fromPort);
      const paramNames = Object.keys(toMod.params);
      const paramIdx = paramNames.indexOf(cc.paramName);
      if (paramIdx < 0) continue;
      const py = this.getParamY(toMod, paramIdx);
      const to = { x: toMod.x + 16, y: py + 4 };
      this._drawCable(p, from.x, from.y, to.x, to.y, [100, 255, 130]);
    }

    // Draw in-progress cable (drag or click-to-connect)
    const activeCable = this.draggingCable || this.pendingCable;
    if (activeCable) {
      const world = this.screenToWorld(p.mouseX, p.mouseY);
      this._drawCable(p, activeCable.x, activeCable.y, world.x, world.y, [255, 255, 100]);
    }

    // Draw modules
    for (const [id, mod] of graph.nodes) {
      this._drawModule(p, mod, id);
    }

    p.pop();
  }

  _drawCable(p, x1, y1, x2, y2, color) {
    const dy = Math.abs(y2 - y1);
    const cpOffset = Math.max(40, dy * 0.5);
    p.noFill();
    p.stroke(color[0], color[1], color[2], 200);
    p.strokeWeight(2.5);
    p.bezier(x1, y1, x1, y1 + cpOffset, x2, y2 - cpOffset, x2, y2);
  }

  _drawModule(p, mod, id) {
    const h = this.getModuleHeight(mod);
    const col = MODULE_COLORS[mod.type] || [80, 80, 80];
    const isSelected = this.selectedNode === id;

    // Shadow
    p.noStroke();
    p.fill(0, 0, 0, 60);
    p.rect(mod.x + 3, mod.y + 3, MODULE_WIDTH, h, 6);

    // Body
    p.fill(30, 30, 50);
    p.stroke(isSelected ? 255 : 60);
    p.strokeWeight(isSelected ? 2 : 1);
    p.rect(mod.x, mod.y, MODULE_WIDTH, h, 6);

    // Header
    p.noStroke();
    p.fill(col[0], col[1], col[2]);
    p.rect(mod.x, mod.y, MODULE_WIDTH, HEADER_HEIGHT, 6, 6, 0, 0);

    // Title
    p.fill(255);
    p.noStroke();
    p.textSize(11);
    p.textAlign(p.LEFT, p.CENTER);
    p.text(mod.type, mod.x + 8, mod.y + HEADER_HEIGHT / 2);

    // Delete button
    p.fill(200, 80, 80);
    p.textAlign(p.RIGHT, p.CENTER);
    p.textSize(14);
    p.text('\u00d7', mod.x + MODULE_WIDTH - 6, mod.y + HEADER_HEIGHT / 2);

    // Input ports
    for (let i = 0; i < mod.inputs.length; i++) {
      const pos = this.getInputPortPos(mod, i);
      p.fill(68, 136, 255);
      p.stroke(255);
      p.strokeWeight(1.5);
      p.ellipse(pos.x, pos.y, PORT_RADIUS * 2);
      p.noStroke();
      p.fill(180);
      p.textSize(8);
      p.textAlign(p.CENTER, p.TOP);
      p.text(mod.inputs[i].name, pos.x, pos.y + PORT_RADIUS + 2);
    }

    // Output ports
    for (let i = 0; i < mod.outputs.length; i++) {
      const pos = this.getOutputPortPos(mod, i);
      const isControlPort = mod.outputs[i].type === 'control';
      p.fill(isControlPort ? [100, 255, 130] : [255, 136, 68]);
      p.stroke(255);
      p.strokeWeight(1.5);
      p.ellipse(pos.x, pos.y, PORT_RADIUS * 2);
      p.noStroke();
      p.fill(180);
      p.textSize(8);
      p.textAlign(p.CENTER, p.BOTTOM);
      p.text(mod.outputs[i].name, pos.x, pos.y - PORT_RADIUS - 2);
    }

    // Params
    const paramNames = Object.keys(mod.params);
    for (let i = 0; i < paramNames.length; i++) {
      const name = paramNames[i];
      const param = mod.params[name];
      const py = this.getParamY(mod, i);
      const kx = mod.x + 16;
      const ky = py + 4;

      // Knob background
      const controlled = this._isControlled(id, name);
      p.fill(controlled ? 30 : 50);
      p.stroke(controlled ? [100, 255, 130] : 100);
      p.strokeWeight(controlled ? 1.5 : 1);
      p.ellipse(kx, ky, KNOB_RADIUS * 2);

      // Knob arc (value indicator)
      const norm = (param.value - param.min) / (param.max - param.min);
      const startAngle = -p.PI * 0.75;
      const endAngle = startAngle + norm * p.PI * 1.5;
      p.noFill();
      p.stroke(controlled ? [100, 255, 130] : [100, 200, 255]);
      p.strokeWeight(2);
      p.arc(kx, ky, KNOB_RADIUS * 2 - 2, KNOB_RADIUS * 2 - 2, startAngle, endAngle);

      // Label
      p.noStroke();
      p.fill(170);
      p.textSize(9);
      p.textAlign(p.LEFT, p.CENTER);
      p.text(param.label || name, kx + KNOB_RADIUS + 6, ky);

      // Value
      p.fill(130);
      p.textAlign(p.RIGHT, p.CENTER);
      const displayVal = param.step >= 1 ? param.value.toFixed(0) : param.value.toFixed(2);
      p.text(displayVal, mod.x + MODULE_WIDTH - 8, ky);
    }

    // Monitor preview
    if (mod.type === 'Monitor') {
      const portRows = Math.max(mod.inputs.length, mod.outputs.length);
      const portSection = portRows > 0 ? portRows * PORT_SPACING + 8 : 0;
      const py = mod.y + HEADER_HEIGHT + portSection;
      p.fill(0);
      p.stroke(60);
      p.strokeWeight(1);
      p.rect(mod.x + 4, py, MONITOR_PREVIEW_W, MONITOR_PREVIEW_H, 2);
      if (mod.displayTexture) {
        this._drawFBO(mod.displayTexture, mod.x + 4, py, MONITOR_PREVIEW_W, MONITOR_PREVIEW_H);
        // Blit to external second-screen window if open
        if (mod.hasExtWindow && mod.hasExtWindow()) {
          mod._blitToExtWindow(this.pipeline.glCanvas);
        }
      }
    }

    // GRASS preview (clean video output, same size as Monitor preview)
    if (mod.type === 'GRASS') {
      const portRows = Math.max(mod.inputs.length, mod.outputs.length);
      const portSection = portRows > 0 ? portRows * PORT_SPACING + 8 : 0;
      const py = mod.y + HEADER_HEIGHT + portSection;
      p.fill(0);
      p.stroke(60);
      p.strokeWeight(1);
      p.rect(mod.x + 4, py, MONITOR_PREVIEW_W, MONITOR_PREVIEW_H, 2);
      if (mod.outputFBO) {
        try {
          this._drawFBO(mod.outputFBO, mod.x + 4, py, MONITOR_PREVIEW_W, MONITOR_PREVIEW_H);
        } catch (e) { /* FBO may not be ready yet */ }
      }
    }

    // Module preview thumbnail (for non-Monitor, non-GRASS modules with FBO)
    if (mod.outputFBO && mod.type !== 'Monitor' && mod.type !== 'GRASS') {
      const portRows = Math.max(mod.inputs.length, mod.outputs.length);
      const portSection = portRows > 0 ? portRows * PORT_SPACING + 8 : 0;
      const paramSection = paramNames.length * PARAM_ROW_HEIGHT;
      const py = mod.y + HEADER_HEIGHT + portSection + paramSection + 4;
      const px = mod.x + (MODULE_WIDTH - PREVIEW_W) / 2;
      p.fill(0);
      p.noStroke();
      p.rect(px, py, PREVIEW_W, PREVIEW_H, 2);
      try {
        this._drawFBO(mod.outputFBO, px, py, PREVIEW_W, PREVIEW_H);
      } catch (e) {
        // FBO may not be ready yet
      }
    }

    // File picker button (VideoPlayer, NAPLPS)
    if (mod.type === 'VideoPlayer' || mod.type === 'NAPLPS') {
      const portRows = Math.max(mod.inputs.length, mod.outputs.length);
      const portSection = portRows > 0 ? portRows * PORT_SPACING + 8 : 0;
      const paramSection = paramNames.length * PARAM_ROW_HEIGHT;
      const hasPreview = mod.outputFBO;
      const previewSection = hasPreview ? PREVIEW_H + 8 : 0;
      const btnY = mod.y + HEADER_HEIGHT + portSection + paramSection + previewSection;
      p.fill(60, 60, 90);
      p.stroke(100);
      p.strokeWeight(1);
      p.rect(mod.x + 10, btnY, MODULE_WIDTH - 20, 20, 3);
      p.noStroke();
      p.fill(200);
      p.textSize(9);
      p.textAlign(p.CENTER, p.CENTER);
      const btnLabel = mod.type === 'NAPLPS' ? 'Load .nap...' : 'Load Video...';
      p.text(btnLabel, mod.x + MODULE_WIDTH / 2, btnY + 10);
    }
  }

  mousePressed(mx, my, button) {
    if (this.fullscreenMonitor !== null) {
      this.fullscreenMonitor = null;
      this._fullscreenExitTime = performance.now();
      return;
    }

    const world = this.screenToWorld(mx, my);

    // Click-to-connect: pending cable is active
    if (this.pendingCable) {
      const portHit = this.hitTestPort(world.x, world.y);
      if (portHit && portHit.portType === 'input') {
        // Clicked on an inlet — record target, wait for release to confirm
        this._pendingTarget = portHit;
        return;
      }
      // Check if clicking a knob for control connection
      const srcMod = this.pipeline.graph.nodes.get(this.pendingCable.fromId);
      const isControl = srcMod && srcMod.outputs[this.pendingCable.fromPort]?.type === 'control';
      if (isControl) {
        const knobHit = this.hitTestKnobPort(world.x, world.y);
        if (knobHit) {
          this._pendingTarget = knobHit;
          return;
        }
      }
      // Clicked anywhere else — cancel
      this.pendingCable = null;
      this._pendingTarget = null;
      return;
    }

    // Alt+click on a module: duplicate it
    if (this.p.keyIsDown(this.p.ALT)) {
      const nodeHit = this.hitTestNode(world.x, world.y);
      if (nodeHit !== null) {
        const dupId = this._duplicateNode(nodeHit);
        if (dupId !== null) {
          const mod = this.pipeline.graph.nodes.get(dupId);
          this.draggingNode = dupId;
          this.dragOffsetX = world.x - mod.x;
          this.dragOffsetY = world.y - mod.y;
          this.dragStartX = mx;
          this.dragStartY = my;
          this.dragActive = true;
          this.selectedNode = dupId;
        }
        return;
      }
    }

    // Middle-click or Alt+click (on empty space): pan
    if (button === this.p.CENTER || this.p.keyIsDown(this.p.ALT)) {
      this.isPanning = true;
      this.panStartX = mx;
      this.panStartY = my;
      this.panStartPanX = this.panX;
      this.panStartPanY = this.panY;
      return;
    }

    // Right-click: disconnect control cable on knob, or delete cable/node
    if (button === this.p.RIGHT) {
      const knobHit = this.hitTestKnobPort(world.x, world.y);
      if (knobHit && this._isControlled(knobHit.nodeId, knobHit.paramName)) {
        const cc = this.pipeline.graph.controlConnections.find(
          c => c.toId === knobHit.nodeId && c.paramName === knobHit.paramName
        );
        if (cc) {
          this.pipeline.graph.disconnectControl(cc.fromId, cc.fromPort, cc.toId, cc.paramName);
        }
        return;
      }
      this._handleRightClick(world);
      return;
    }

    // Check delete button hit (the x in header)
    const deleteHit = this._hitTestDeleteBtn(world.x, world.y);
    if (deleteHit !== null) {
      this._deleteNode(deleteHit);
      return;
    }

    // Check VideoPlayer file button
    const vpHit = this.hitTestVideoPlayerBtn(world.x, world.y);
    if (vpHit !== null) {
      const mod = this.pipeline.graph.nodes.get(vpHit);
      if (mod && mod.pickFile) mod.pickFile();
      return;
    }

    // Check knob — if controlled, disconnect and start re-plugging the control cable
    const knobHit = this.hitTestKnob(world.x, world.y);
    if (knobHit) {
      if (this._isControlled(knobHit.nodeId, knobHit.paramName)) {
        const cc = this.pipeline.graph.controlConnections.find(
          c => c.toId === knobHit.nodeId && c.paramName === knobHit.paramName
        );
        if (cc) {
          this.pipeline.graph.disconnectControl(cc.fromId, cc.fromPort, cc.toId, cc.paramName);
          const srcMod = this.pipeline.graph.nodes.get(cc.fromId);
          const pos = this.getOutputPortPos(srcMod, cc.fromPort);
          this.draggingCable = {
            fromId: cc.fromId,
            fromPort: cc.fromPort,
            x: pos.x,
            y: pos.y,
          };
        }
      } else {
        this.draggingKnob = knobHit;
      }
      return;
    }

    // Check output port (start cable)
    const portHit = this.hitTestPort(world.x, world.y);
    if (portHit && portHit.portType === 'output') {
      const mod = this.pipeline.graph.nodes.get(portHit.nodeId);
      const pos = this.getOutputPortPos(mod, portHit.portIndex);
      this.draggingCable = {
        fromId: portHit.nodeId,
        fromPort: portHit.portIndex,
        x: pos.x,
        y: pos.y,
      };
      return;
    }

    // Check input port (disconnect existing cable)
    if (portHit && portHit.portType === 'input') {
      const conns = this.pipeline.graph.getInputConnections(portHit.nodeId);
      const existing = conns.find(c => c.toPort === portHit.portIndex);
      if (existing) {
        // Disconnect and start dragging from the source
        this.pipeline.graph.disconnect(existing.fromId, existing.fromPort, existing.toId, existing.toPort);
        const srcMod = this.pipeline.graph.nodes.get(existing.fromId);
        const pos = this.getOutputPortPos(srcMod, existing.fromPort);
        this.draggingCable = {
          fromId: existing.fromId,
          fromPort: existing.fromPort,
          x: pos.x,
          y: pos.y,
        };
        return;
      }
    }

    // Check node body (drag)
    const nodeHit = this.hitTestNode(world.x, world.y);
    if (nodeHit !== null) {
      this.draggingNode = nodeHit;
      const mod = this.pipeline.graph.nodes.get(nodeHit);
      this.dragOffsetX = world.x - mod.x;
      this.dragOffsetY = world.y - mod.y;
      this.dragStartX = mx;
      this.dragStartY = my;
      this.dragActive = false;
      this.selectedNode = nodeHit;
      return;
    }

    this.selectedNode = null;
  }

  mouseDragged(mx, my) {
    if (this.isPanning) {
      this.panX = this.panStartPanX + (mx - this.panStartX);
      this.panY = this.panStartPanY + (my - this.panStartY);
      return;
    }

    const world = this.screenToWorld(mx, my);

    if (this.draggingNode !== null) {
      // Apply a small dead zone so micro-movements during clicks/double-clicks
      // don't displace the node and break hit-tests for the subsequent events.
      if (!this.dragActive) {
        if (Math.hypot(mx - this.dragStartX, my - this.dragStartY) < 4) return;
        this.dragActive = true;
      }
      const mod = this.pipeline.graph.nodes.get(this.draggingNode);
      if (mod) {
        mod.x = world.x - this.dragOffsetX;
        mod.y = world.y - this.dragOffsetY;
      }
      return;
    }

    if (this.draggingKnob) {
      const dk = this.draggingKnob;
      const mod = this.pipeline.graph.nodes.get(dk.nodeId);
      if (mod && mod.params[dk.paramName]) {
        const param = mod.params[dk.paramName];
        const delta = (dk.startY - world.y) / (150 / this.zoom);
        const range = param.max - param.min;
        const newVal = dk.startValue + delta * range;
        mod.setParam(dk.paramName, newVal);
      }
    }
  }

  mouseReleased(mx, my) {
    if (this.isPanning) {
      this.isPanning = false;
      return;
    }

    // Click-to-connect: release on inlet or knob completes the connection
    if (this.pendingCable && this._pendingTarget) {
      const world = this.screenToWorld(mx, my);
      if (this._pendingTarget.paramName) {
        // Target is a knob
        const knobHit = this.hitTestKnobPort(world.x, world.y);
        if (knobHit && knobHit.nodeId === this._pendingTarget.nodeId &&
            knobHit.paramName === this._pendingTarget.paramName) {
          this.pipeline.graph.connectControl(
            this.pendingCable.fromId,
            this.pendingCable.fromPort,
            knobHit.nodeId,
            knobHit.paramName
          );
        }
      } else {
        const portHit = this.hitTestPort(world.x, world.y);
        if (portHit && portHit.portType === 'input' &&
            portHit.nodeId === this._pendingTarget.nodeId &&
            portHit.portIndex === this._pendingTarget.portIndex) {
          this.pipeline.graph.connect(
            this.pendingCable.fromId,
            this.pendingCable.fromPort,
            portHit.nodeId,
            portHit.portIndex
          );
        }
      }
      this.pendingCable = null;
      this._pendingTarget = null;
      return;
    }

    if (this.draggingCable) {
      const world = this.screenToWorld(mx, my);
      const portHit = this.hitTestPort(world.x, world.y);
      // Check if dropped on a knob (control connection)
      const srcMod = this.pipeline.graph.nodes.get(this.draggingCable.fromId);
      const isControl = srcMod && srcMod.outputs[this.draggingCable.fromPort]?.type === 'control';
      if (isControl) {
        const knobHit = this.hitTestKnobPort(world.x, world.y);
        if (knobHit) {
          this.pipeline.graph.connectControl(
            this.draggingCable.fromId,
            this.draggingCable.fromPort,
            knobHit.nodeId,
            knobHit.paramName
          );
          this.draggingCable = null;
          return;
        }
      }
      if (portHit && portHit.portType === 'input') {
        // Dragged to an input port — connect (existing behavior)
        this.pipeline.graph.connect(
          this.draggingCable.fromId,
          this.draggingCable.fromPort,
          portHit.nodeId,
          portHit.portIndex
        );
        this.draggingCable = null;
      } else if (portHit && portHit.portType === 'output' &&
                 portHit.nodeId === this.draggingCable.fromId &&
                 portHit.portIndex === this.draggingCable.fromPort) {
        // Released on the same outlet — convert to click-to-connect pending cable
        this.pendingCable = this.draggingCable;
        this.draggingCable = null;
      } else {
        this.draggingCable = null;
      }
      return;
    }

    this.draggingNode = null;
    this.dragActive = false;
    this.draggingKnob = null;
  }

  mouseWheel(delta) {
    const p = this.p;
    const wx = (p.mouseX - this.panX) / this.zoom;
    const wy = (p.mouseY - this.panY) / this.zoom;
    const zoomFactor = delta > 0 ? 0.95 : 1.05;
    this.zoom *= zoomFactor;
    this.zoom = Math.max(0.2, Math.min(3.0, this.zoom));
    this.panX = p.mouseX - wx * this.zoom;
    this.panY = p.mouseY - wy * this.zoom;
  }

  mouseDoubleClicked(mx, my) {
    // If this double-click is part of the gesture that just exited fullscreen
    // (i.e. the first click exited it), don't immediately re-enter.
    if (performance.now() - this._fullscreenExitTime < 400) return;

    const world = this.screenToWorld(mx, my);

    // Double-click on param value: open inline editor (unless controlled)
    const valHit = this.hitTestParamValue(world.x, world.y);
    if (valHit && !this._isControlled(valHit.nodeId, valHit.paramName)) {
      this._openParamInput(valHit.nodeId, valHit.paramName, valHit.paramIndex);
      return;
    }

    const monitorHit = this.hitTestMonitorDblClick(world.x, world.y);
    if (monitorHit !== null) {
      const mod = this.pipeline.graph.nodes.get(monitorHit);
      if (mod && mod.type === 'Monitor') {
        // Attempt second-screen fullscreen on Chrome/Chromium; fall back to inline
        mod.trySecondScreenFullscreen(this.pipeline.glCanvas).then(opened => {
          if (!opened) {
            this.fullscreenMonitor = monitorHit;
          }
        });
      } else {
        this.fullscreenMonitor = monitorHit;
      }
      return;
    }

    // Double-click on empty canvas: open search popup
    const nodeHit = this.hitTestNode(world.x, world.y);
    if (nodeHit === null) {
      this._openSearchPopup(mx, my);
    }
  }

  _handleRightClick(world) {
    const graph = this.pipeline.graph;
    // Check if clicking near a control cable to delete it
    for (let i = graph.controlConnections.length - 1; i >= 0; i--) {
      const cc = graph.controlConnections[i];
      const fromMod = graph.nodes.get(cc.fromId);
      const toMod = graph.nodes.get(cc.toId);
      if (!fromMod || !toMod) continue;
      const from = this.getOutputPortPos(fromMod, cc.fromPort);
      const paramNames = Object.keys(toMod.params);
      const paramIdx = paramNames.indexOf(cc.paramName);
      if (paramIdx < 0) continue;
      const py = this.getParamY(toMod, paramIdx);
      const to = { x: toMod.x + 16, y: py + 4 };
      if (this._distToCable(world.x, world.y, from.x, from.y, to.x, to.y) < 10) {
        graph.controlConnections.splice(i, 1);
        return;
      }
    }
    // Check if clicking near a regular cable to delete it
    for (let i = graph.connections.length - 1; i >= 0; i--) {
      const conn = graph.connections[i];
      const fromMod = graph.nodes.get(conn.fromId);
      const toMod = graph.nodes.get(conn.toId);
      if (!fromMod || !toMod) continue;
      const from = this.getOutputPortPos(fromMod, conn.fromPort);
      const to = this.getInputPortPos(toMod, conn.toPort);
      if (this._distToCable(world.x, world.y, from.x, from.y, to.x, to.y) < 10) {
        graph.connections.splice(i, 1);
        graph.topologicalSort();
        return;
      }
    }
  }

  _distToCable(px, py, x1, y1, x2, y2) {
    // Approximate: sample bezier at intervals
    let minDist = Infinity;
    for (let t = 0; t <= 1; t += 0.05) {
      const dy = Math.abs(y2 - y1);
      const cpOffset = Math.max(40, dy * 0.5);
      const it = 1 - t;
      const bx = it*it*it*x1 + 3*it*it*t*x1 + 3*it*t*t*x2 + t*t*t*x2;
      const by = it*it*it*y1 + 3*it*it*t*(y1+cpOffset) + 3*it*t*t*(y2-cpOffset) + t*t*t*y2;
      const d = Math.hypot(px - bx, py - by);
      if (d < minDist) minDist = d;
    }
    return minDist;
  }

  _hitTestDeleteBtn(wx, wy) {
    const graph = this.pipeline.graph;
    for (const [id, mod] of graph.nodes) {
      if (wx >= mod.x + MODULE_WIDTH - 20 && wx <= mod.x + MODULE_WIDTH &&
          wy >= mod.y && wy <= mod.y + HEADER_HEIGHT) {
        return id;
      }
    }
    return null;
  }

  _duplicateNode(id) {
    const src = this.pipeline.graph.nodes.get(id);
    if (!src) return null;
    const graph = this.pipeline.graph;
    const glCanvas = this.pipeline.glCanvas;
    const mod = createModule(src.type, glCanvas, graph.nextId);
    if (!mod) return null;
    mod.x = src.x + 20;
    mod.y = src.y + 20;
    for (const [k, v] of Object.entries(src.params)) {
      mod.setParam(k, v.value);
    }
    return graph.addNode(mod);
  }

  _deleteNode(id) {
    const mod = this.pipeline.graph.nodes.get(id);
    if (mod) {
      mod.dispose();
      this.pipeline.graph.removeNode(id); // also calls disconnectAllControl
      if (this.selectedNode === id) this.selectedNode = null;
      if (this.fullscreenMonitor === id) this.fullscreenMonitor = null;
    }
  }

  toJSON() {
    return this.pipeline.graph.toJSON();
  }

  fromJSON(data) {
    const glCanvas = this.pipeline.glCanvas;
    this.pipeline.graph.fromJSON(data, (type, id) => {
      return createModule(type, glCanvas, id);
    });
  }
}
