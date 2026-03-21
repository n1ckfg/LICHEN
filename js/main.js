import { ProcessingPipeline } from './pipeline.js';
import { NodeGraphUI } from './ui.js';
import './modules/AdderMultiplierModule.js';
import './modules/BooleanLogicModule.js';
import './modules/BufferSmearModule.js';
import './modules/CameraModule.js';
import './modules/ColorEncoderModule.js';
import './modules/ComparatorModule.js';
import './modules/DelayModule.js';
import './modules/DifferentiatorModule.js';
import './modules/FilmGrainModule.js';
import './modules/FunctionGeneratorModule.js';
import './modules/GameBoyModule.js';
import './modules/GlitchModule.js';
import './modules/GRASSModule.js';
import './modules/GridGuysModule.js';
import './modules/HSFlowModule.js';
import './modules/HyperCardModule.js';
import './modules/MonitorModule.js';
import './modules/MosaicModule.js';
import './modules/NAPLPSModule.js';
import './modules/OscillatorModule.js';
import './modules/PixelVisionModule.js';
import './modules/RuttEtraModule.js';
import './modules/SpatialSliceModule.js';
import './modules/SyncGeneratorModule.js';
import './modules/TimeTunnelModule.js';
import './modules/TVLinesModule.js';
import './modules/UnrealBloomModule.js';
import './modules/ValueScramblerModule.js';
import './modules/VHSCModule.js';
import './modules/VideoPlayerModule.js';

let pipeline, ui, glCanvas;

const sketch = (p) => {
  p.setup = () => {
    const canvas = p.createCanvas(p.windowWidth, p.windowHeight);
    canvas.elt.addEventListener('contextmenu', (e) => e.preventDefault());

    glCanvas = p.createGraphics(640, 480, p.WEBGL);
    pipeline = new ProcessingPipeline(glCanvas);
    ui = new NodeGraphUI(pipeline, p);
  };

  p.draw = () => {
    p.background(26, 26, 46);
    pipeline.processFrame();
    ui.draw();
  };

  p.mousePressed = (e) => {
    ui.mousePressed(p.mouseX, p.mouseY, p.mouseButton);
  };

  p.mouseDragged = (e) => {
    ui.mouseDragged(p.mouseX, p.mouseY);
  };

  p.mouseReleased = (e) => {
    ui.mouseReleased(p.mouseX, p.mouseY);
  };

  p.doubleClicked = (e) => {
    ui.mouseDoubleClicked(p.mouseX, p.mouseY);
  };

  p.mouseWheel = (e) => {
    ui.mouseWheel(e.delta);
    return false;
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };

  p.keyPressed = () => {
    // When a GRASS module is fullscreened it owns all keyboard input
    if (ui.fullscreenMonitor !== null) {
      const fsmod = pipeline.graph.nodes.get(ui.fullscreenMonitor);
      if (fsmod && fsmod.type === 'GRASS') {
        // ESC while editor is open saves the macro (editor handles it); stay fullscreen
        // ESC while editor is closed exits fullscreen
        if ((p.keyCode === 27) && !fsmod.editor.active) {
          ui.fullscreenMonitor = null;
        } else {
          fsmod.handleKey(p.key, p.keyCode, p);
        }
        return false;
      }
      // Non-GRASS fullscreen: ESC exits
      if (p.key === 'Escape') {
        ui.fullscreenMonitor = null;
        return false;
      }
      return false;
    }
    if (p.key === 'Delete' || p.key === 'Backspace') {
      if (ui.selectedNode !== null) {
        ui._deleteNode(ui.selectedNode);
        return false;
      }
    }
    if (p.key === 's' && (p.keyIsDown(p.CONTROL) || p.keyIsDown(91))) {
      const data = ui.toJSON();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.download = `lichen-patch_${timestamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      return false;
    }
    if (p.key === 'o' && (p.keyIsDown(p.CONTROL) || p.keyIsDown(91))) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const data = JSON.parse(ev.target.result);
          ui.fromJSON(data);
        };
        reader.readAsText(file);
      };
      input.click();
      return false;
    }
  };
};

new p5(sketch);
