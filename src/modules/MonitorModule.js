import { Module } from './Module.js';
import { registerModule } from '../moduleRegistry.js';

export class MonitorModule extends Module {
  constructor(glCanvas, id) {
    super('Monitor', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.displayTexture = null;
    this.isFullscreen = false;
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    this.displayTexture = inputFBO;
  }

  toggleFullscreen() {
    this.isFullscreen = !this.isFullscreen;
  }

  dispose() {
    this.displayTexture = null;
    super.dispose();
  }
}

registerModule('Monitor', MonitorModule);
