import { Module } from './Module.js';
import { registerModule } from '../moduleRegistry.js';

// One fixed value on a control output, to set several knobs from one place or
// to feed Calculator (see Control Modules in ARCHITECTURE.md)
export class ConstantModule extends Module {
  static uid = '5cfafd47';

  constructor(glCanvas, id) {
    super('Constant', glCanvas, id);
    this.outputs = [{ id: '7e12', name: 'out', type: 'control' }];
    this.params = {
      value: { id: '832c', value: 0.5, min: 0, max: 1, step: 0.01, label: 'Value' },
    };
  }

  process(graph, glCanvas) {
    this.controlValues.out = this.params.value.value;
  }
}

registerModule('Constant', ConstantModule);
