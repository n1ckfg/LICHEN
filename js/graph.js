export class ConnectionGraph {
  constructor() {
    this.nodes = new Map();
    this.connections = [];
    this.controlConnections = [];
    this.sortedOrder = [];
    this.nextId = 0;
  }

  addNode(module) {
    const id = this.nextId++;
    module.id = id;
    this.nodes.set(id, module);
    this.topologicalSort();
    return id;
  }

  removeNode(id) {
    this.nodes.delete(id);
    this.connections = this.connections.filter(
      c => c.fromId !== id && c.toId !== id
    );
    this.disconnectAllControl(id);
    this.topologicalSort();
  }

  connect(fromId, fromPort, toId, toPort) {
    if (this.hasCycle(fromId, toId)) return false;
    // Remove existing connection to this input port
    this.connections = this.connections.filter(
      c => !(c.toId === toId && c.toPort === toPort)
    );
    this.connections.push({ fromId, fromPort, toId, toPort });
    this.topologicalSort();
    return true;
  }

  disconnect(fromId, fromPort, toId, toPort) {
    this.connections = this.connections.filter(
      c => !(c.fromId === fromId && c.fromPort === fromPort &&
             c.toId === toId && c.toPort === toPort)
    );
    this.topologicalSort();
  }

  disconnectAll(nodeId) {
    this.connections = this.connections.filter(
      c => c.fromId !== nodeId && c.toId !== nodeId
    );
    this.topologicalSort();
  }

  getInputConnections(nodeId) {
    return this.connections.filter(c => c.toId === nodeId);
  }

  getOutputConnections(nodeId) {
    return this.connections.filter(c => c.fromId === nodeId);
  }

  connectControl(fromId, fromPort, toId, paramName) {
    // Remove any existing control connection to the same target param
    this.controlConnections = this.controlConnections.filter(
      c => !(c.toId === toId && c.paramName === paramName)
    );
    this.controlConnections.push({ fromId, fromPort, toId, paramName });
  }

  disconnectControl(fromId, fromPort, toId, paramName) {
    this.controlConnections = this.controlConnections.filter(
      c => !(c.fromId === fromId && c.fromPort === fromPort &&
             c.toId === toId && c.paramName === paramName)
    );
  }

  disconnectAllControl(nodeId) {
    this.controlConnections = this.controlConnections.filter(
      c => c.fromId !== nodeId && c.toId !== nodeId
    );
  }

  getControlConnections(nodeId) {
    return this.controlConnections.filter(c => c.toId === nodeId);
  }

  topologicalSort() {
    const adj = new Map();
    const inDegree = new Map();

    for (const id of this.nodes.keys()) {
      adj.set(id, []);
      inDegree.set(id, 0);
    }

    for (const c of this.connections) {
      if (adj.has(c.fromId) && adj.has(c.toId)) {
        adj.get(c.fromId).push(c.toId);
        inDegree.set(c.toId, inDegree.get(c.toId) + 1);
      }
    }

    const queue = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const result = [];
    while (queue.length > 0) {
      const node = queue.shift();
      result.push(node);
      for (const neighbor of adj.get(node)) {
        const newDeg = inDegree.get(neighbor) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }

    this.sortedOrder = result;
  }

  hasCycle(fromId, toId) {
    // Would adding fromId -> toId create a cycle?
    // DFS from toId through existing edges, looking for fromId
    const adj = new Map();
    for (const id of this.nodes.keys()) {
      adj.set(id, []);
    }
    for (const c of this.connections) {
      if (adj.has(c.fromId)) {
        adj.get(c.fromId).push(c.toId);
      }
    }
    // Add proposed edge
    if (!adj.has(fromId)) return false;
    adj.get(fromId).push(toId);

    // DFS from fromId looking for fromId (cycle)
    const visited = new Set();
    const stack = [toId];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === fromId) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      const neighbors = adj.get(current);
      if (neighbors) {
        for (const n of neighbors) {
          stack.push(n);
        }
      }
    }
    return false;
  }

  // A patch refers to modules, params and ports by id, never by name or port
  // number, so any of them can be renamed or reordered (see Patch IDs in
  // ARCHITECTURE.md). type is only there to make the file readable.
  toJSON() {
    const nodes = [];
    for (const [id, mod] of this.nodes) {
      const params = {};
      for (const param of Object.values(mod.params)) {
        params[param.id] = param.value;
      }
      const node = {
        id,
        uid: mod.constructor.uid,
        type: mod.type,
        x: mod.x,
        y: mod.y,
        params,
        collapsed: mod.collapsed || false
      };
      if (mod.seed) node.seed = mod.seed;
      nodes.push(node);
    }
    const output = (c) => this.nodes.get(c.fromId).outputs[c.fromPort].id;
    return {
      nodes,
      connections: this.connections.map(c => ({
        fromId: c.fromId,
        fromPort: output(c),
        toId: c.toId,
        toPort: this.nodes.get(c.toId).inputs[c.toPort].id
      })),
      controlConnections: this.controlConnections.map(c => ({
        fromId: c.fromId,
        fromPort: output(c),
        toId: c.toId,
        param: this.nodes.get(c.toId).params[c.paramName].id
      })),
      nextId: this.nextId
    };
  }

  fromJSON(data, createModuleFn) {
    this.nodes.clear();
    this.connections = [];
    this.controlConnections = [];
    this.nextId = data.nextId || 0;

    for (const nodeData of data.nodes) {
      const mod = createModuleFn(nodeData.uid, nodeData.id, nodeData.type);
      if (!mod) continue;
      mod.id = nodeData.id;
      mod.x = nodeData.x;
      mod.y = nodeData.y;
      mod.collapsed = nodeData.collapsed || false;
      if (nodeData.params) {
        // A param added since the patch was saved would keep the constructor's
        // draw, so it goes back to its declared value and the patch looks as
        // it did.
        for (const [k, v] of Object.entries(mod.declared ?? {})) {
          if (!(mod.params[k].id in nodeData.params)) mod.setParam(k, v);
        }
        // A value whose param has since been removed is skipped
        for (const [k, param] of Object.entries(mod.params)) {
          if (param.id in nodeData.params) mod.setParam(k, nodeData.params[param.id]);
        }
      }
      // The saved params replaced the ones the constructor seeded, so the
      // constructor's seed no longer describes them; a patch saved before
      // seeds existed has none to restore.
      mod.seed = nodeData.seed ?? null;
      this.nodes.set(nodeData.id, mod);
    }

    // Cables are saved with port and param ids. One whose port or param has
    // since been removed is dropped.
    const portIndex = (ports, id) => {
      const i = ports ? ports.findIndex(p => p.id === id) : -1;
      return i < 0 ? null : i;
    };
    for (const c of data.connections) {
      const fromPort = portIndex(this.nodes.get(c.fromId)?.outputs, c.fromPort);
      const toPort = portIndex(this.nodes.get(c.toId)?.inputs, c.toPort);
      if (fromPort === null || toPort === null) {
        console.warn('Dropped a cable whose port no longer exists:', c);
        continue;
      }
      this.connections.push({ fromId: c.fromId, fromPort, toId: c.toId, toPort });
    }

    if (data.controlConnections) {
      for (const c of data.controlConnections) {
        const fromPort = portIndex(this.nodes.get(c.fromId)?.outputs, c.fromPort);
        const params = this.nodes.get(c.toId)?.params ?? {};
        const paramName = Object.keys(params).find(k => params[k].id === c.param);
        if (fromPort === null || !paramName) {
          console.warn('Dropped a cable whose port or param no longer exists:', c);
          continue;
        }
        this.controlConnections.push({ fromId: c.fromId, fromPort, toId: c.toId, paramName });
      }
    }

    this.topologicalSort();
  }
}
