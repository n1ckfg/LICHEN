import { ProcessingPipeline } from './pipeline.js';
import { NodeGraphUI } from './ui.js';
// - - - SOURCES - - -
import './modules/CameraModule.js';
import './modules/GRASSModule.js';
import './modules/GridGuysModule.js';
import './modules/NAPLPSModule.js';
import './modules/OscillatorModule.js';
import './modules/ProtozoaModule.js';
import './modules/VideoPlayerModule.js';
// - - - CORE - - -
import './modules/AdderMultiplierModule.js';
import './modules/ColorEncoderModule.js';
import './modules/ComparatorModule.js';
import './modules/DifferentiatorModule.js';
import './modules/FunctionGeneratorModule.js';
import './modules/SyncGeneratorModule.js';
import './modules/ValueScramblerModule.js';
// - - - EFFECTS - - -
import './modules/BooleanLogicModule.js';
import './modules/BufferSmearModule.js';
import './modules/DeeSeventySixModule.js';
import './modules/DelayModule.js';
import './modules/DitherModule.js';
import './modules/CyberlaceModule.js';
import './modules/FilmGrainModule.js';
import './modules/GameBoyModule.js';
import './modules/GlitchModule.js';
import './modules/HSFlowModule.js';
import './modules/HyperCardModule.js';
import './modules/LuminanceDelayModule.js';
import './modules/MosaicModule.js';
import './modules/PixelVisionModule.js';
import './modules/RuttEtraModule.js';
import './modules/SlitscanModule.js';
import './modules/SpatialSliceModule.js';
import './modules/TimeTunnelModule.js';
import './modules/TVLinesModule.js';
import './modules/UnrealBloomModule.js';
import './modules/VHSCModule.js';
// - - - UTILITY - - -
import './modules/BrcosaModule.js';
import './modules/LevelsModule.js';
import './modules/SharpenModule.js';
import './modules/VideoMixerModule.js';
// - - - OUTPUT - - -
import './modules/MonitorModule.js';

let pipeline, ui, glCanvas;

/**
 * Parse and validate a shareable URL hash.
 * Returns { success: true, data } or { success: false, error }.
 */
function parseShareableURL() {
  const hash = window.location.hash;
  if (!hash || hash.length <= 1) {
    return { success: false, error: 'No hash in URL' };
  }

  const encoded = hash.slice(1); // Remove leading #
  if (!encoded) {
    return { success: false, error: 'Empty hash' };
  }

  try {
    const jsonStr = decodeURIComponent(escape(atob(encoded)));
    const data = JSON.parse(jsonStr);

    // Validate basic structure
    if (!data || typeof data !== 'object') {
      return { success: false, error: 'Invalid patch data: not an object' };
    }
    if (!Array.isArray(data.nodes)) {
      return { success: false, error: 'Invalid patch data: missing nodes array' };
    }
    if (!Array.isArray(data.connections)) {
      return { success: false, error: 'Invalid patch data: missing connections array' };
    }

    return { success: true, data };
  } catch (e) {
    return { success: false, error: 'Failed to decode URL: ' + e.message };
  }
}

const sketch = (p) => {
  p.setup = () => {
    const canvas = p.createCanvas(p.windowWidth, p.windowHeight);
    canvas.elt.addEventListener('contextmenu', (e) => e.preventDefault());

    glCanvas = p.createGraphics(640, 480, p.WEBGL);
    pipeline = new ProcessingPipeline(glCanvas);
    ui = new NodeGraphUI(pipeline, p);

    // Try to load patch from URL hash
    const urlPatch = parseShareableURL();
    if (urlPatch.success) {
      try {
        ui.fromJSON(urlPatch.data);
        // Clear the hash after successful load to avoid reloading on refresh
        history.replaceState(null, '', window.location.pathname);
      } catch (e) {
        console.error('Failed to load patch from URL:', e);
        // Continue with empty patch - don't block normal operation
      }
    } else if (window.location.hash.length > 1) {
      // Only log error if there was actually a hash (not just empty or missing)
      console.error('Failed to parse URL patch:', urlPatch.error);
    }
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
    // Let menu scroll naturally when mouse is over it
    const palette = document.getElementById('module-palette');
    if (palette && palette.matches(':hover')) {
      return true; // Allow default scroll behavior
    }
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
      // Non-GRASS fullscreen: ESC exits and stops recording
      if (p.key === 'Escape') {
        if (fsmod && fsmod.isRecording && fsmod.isRecording()) {
          fsmod.stopRecording();
        }
        ui.fullscreenMonitor = null;
        return false;
      }
      return false;
    }
    if (p.key === 'Delete' || p.key === 'Backspace') {
      if (ui.selectedNodes.size > 0) {
        for (const id of [...ui.selectedNodes]) {
          ui._deleteNode(id);
        }
        return false;
      }
    }
    if (p.key === 'a' && (p.keyIsDown(p.CONTROL) || p.keyIsDown(91))) {
      ui.selectAll();
      return false;
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
