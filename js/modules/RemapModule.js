import { Module } from './Module.js';
import { registerModule } from '../moduleRegistry.js';

// Maps a control value from one range to another: out = Out Min + (value − In
// Min) / (In Max − In Min) × (Out Max − Out Min). Each end of a range is its
// control input pin's value when a control output is cabled there, and its own
// knob when not, as Calculator's operands are (see Control Modules in
// ARCHITECTURE.md).
export class RemapModule extends Module {
  static uid = 'e2dfc827';

  constructor(glCanvas, id) {
    super('Remap', glCanvas, id);
    this.inputs = [
      { id: '0e97', name: 'value', type: 'control' },
      { id: 'dfae', name: 'inMin', type: 'control' },
      { id: '2434', name: 'inMax', type: 'control' },
      { id: '0725', name: 'outMin', type: 'control' },
      { id: 'f74f', name: 'outMax', type: 'control' },
    ];
    this.outputs = [{ id: '7b7b', name: 'out', type: 'control' }];
    this.params = {
      inMin: { id: '501d', value: 0, min: -10, max: 10, step: 0.01, label: 'In Min' },
      inMax: { id: '5fc0', value: 1, min: -10, max: 10, step: 0.01, label: 'In Max' },
      outMin: { id: '1f3b', value: 0, min: -10, max: 10, step: 0.01, label: 'Out Min' },
      outMax: { id: '15a4', value: 1, min: -10, max: 10, step: 0.01, label: 'Out Max' },
    };
  }

  // A cabled pin replaces its knob, which keeps its own value for when the
  // cable goes
  _end(graph, portIndex, name) {
    const input = this.getControlInput(graph, portIndex);
    return input ? input.value : this.params[name].value;
  }

  process(graph, glCanvas) {
    // Value has no knob, so with nothing cabled it is 0
    const value = this.getControlInput(graph, 0)?.value ?? 0;
    const inMin = this._end(graph, 1, 'inMin');
    const inMax = this._end(graph, 2, 'inMax');
    const outMin = this._end(graph, 3, 'outMin');
    const outMax = this._end(graph, 4, 'outMax');
    // An empty input range has no position in it, so it gives Out Min
    const span = inMax - inMin;
    const t = span === 0 ? 0 : (value - inMin) / span;
    const out = outMin + t * (outMax - outMin);
    // A knob cable would set its param to NaN from one, as with Calculator
    this.controlValues.out = Number.isFinite(out) ? out : 0;
  }
}

registerModule('Remap', RemapModule);
