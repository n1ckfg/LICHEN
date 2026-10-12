import { Module } from './Module.js';
import { registerModule } from '../moduleRegistry.js';

// Patches save the operation as its index, so a new one is appended, never inserted
const OPS = ['Add', 'Subtract', 'Multiply', 'Divide'];

// Arithmetic on two control values: out = A op B. Each operand is its control
// input pin's value when a control output is cabled there, and its own A or B
// param when not (see Control Modules in ARCHITECTURE.md).
export class CalculatorModule extends Module {
  static uid = '2d57cf6d';

  constructor(glCanvas, id) {
    super('Calculator', glCanvas, id);
    this.inputs = [{ id: '8923', name: 'a', type: 'control' }, { id: '90c7', name: 'b', type: 'control' }];
    this.outputs = [{ id: 'b8d1', name: 'out', type: 'control' }];
    this.params = {
      op: {
        id: 'c2d1', value: 0, min: 0, max: OPS.length - 1, step: 1, label: 'Op',
        widget: 'dropdown', valueLabels: OPS,
      },
      a: { id: 'cd44', value: 0, min: -10, max: 10, step: 0.01, label: 'A' },
      b: { id: 'd820', value: 0, min: -10, max: 10, step: 0.01, label: 'B' },
    };
  }

  // A cabled pin replaces its param, which keeps its own value for when the
  // cable goes
  _operand(graph, portIndex, name) {
    const input = this.getControlInput(graph, portIndex);
    return input ? input.value : this.params[name].value;
  }

  process(graph, glCanvas) {
    const a = this._operand(graph, 0, 'a');
    const b = this._operand(graph, 1, 'b');
    let out;
    switch (Math.round(this.params.op.value)) {
      case 1: out = a - b; break;
      case 2: out = a * b; break;
      case 3: out = a / b; break;
      default: out = a + b;
    }
    // A knob cable would set its param to NaN from one, and a scope its
    // samples, so dividing by zero gives 0
    this.controlValues.out = Number.isFinite(out) ? out : 0;
  }
}

registerModule('Calculator', CalculatorModule);
