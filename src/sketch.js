import { ProcessingPipeline } from './pipeline.js';
import { NodeGraphUI } from './ui.js';
import './modules/CameraModule.js';
import './modules/MonitorModule.js';
import './modules/OscillatorModule.js';
import './modules/ComparatorModule.js';
import './modules/FunctionGeneratorModule.js';
import './modules/AdderMultiplierModule.js';
import './modules/DifferentiatorModule.js';
import './modules/ColorEncoderModule.js';
import './modules/SyncGeneratorModule.js';
import './modules/ValueScramblerModule.js';
import './modules/TVModule.js';
import './modules/FilmModule.js';
import './modules/VHSCModule.js';
import './modules/PixelVisionModule.js';
import './modules/GameBoyModule.js';
import './modules/HyperCardModule.js';
import './modules/DelayModule.js';
import './modules/GlitchModule.js';
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
    if (p.key === 'Escape' && ui.fullscreenMonitor) {
      ui.fullscreenMonitor = null;
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
      a.download = 'sandin-patch.json';
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
