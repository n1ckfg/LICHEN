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

  toJSON() {
    const nodes = [];
    for (const [id, mod] of this.nodes) {
      const params = {};
      for (const [k, v] of Object.entries(mod.params)) {
        params[k] = v.value;
      }
      nodes.push({
        id,
        type: mod.type,
        x: mod.x,
        y: mod.y,
        params
      });
    }
    return {
      nodes,
      connections: this.connections.map(c => ({ ...c })),
      controlConnections: this.controlConnections.map(c => ({ ...c })),
      nextId: this.nextId
    };
  }

  fromJSON(data, createModuleFn) {
    this.nodes.clear();
    this.connections = [];
    this.controlConnections = [];
    this.nextId = data.nextId || 0;

    for (const nodeData of data.nodes) {
      const mod = createModuleFn(nodeData.type, nodeData.id);
      if (!mod) continue;
      mod.id = nodeData.id;
      mod.x = nodeData.x;
      mod.y = nodeData.y;
      if (nodeData.params) {
        for (const [k, v] of Object.entries(nodeData.params)) {
          mod.setParam(k, v);
        }
      }
      this.nodes.set(nodeData.id, mod);
    }

    for (const c of data.connections) {
      if (this.nodes.has(c.fromId) && this.nodes.has(c.toId)) {
        this.connections.push({ ...c });
      }
    }

    if (data.controlConnections) {
      for (const c of data.controlConnections) {
        if (this.nodes.has(c.fromId) && this.nodes.has(c.toId)) {
          this.controlConnections.push({ ...c });
        }
      }
    }

    this.topologicalSort();
  }
}
