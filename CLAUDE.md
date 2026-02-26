# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Running the App

Requires `http-server` (`npm install -g http-server`).

- **macOS**: `./run.command` — starts `http-server` and opens the browser automatically
- **Windows**: `run.bat`
- **Manual**: `http-server` then open `http://127.0.0.1:8080`

No build step. The app uses ES modules loaded directly by the browser.

## Architecture

LICHEN is a browser-based modular video synthesizer inspired by the Sandin Image Processor. Modules are connected in a node graph; each frame, the pipeline processes modules in topological order, each rendering to its own WebGL framebuffer.

### Core Data Flow

```
sketch.js (p5.js loop)
  → ProcessingPipeline.processFrame()
    → ConnectionGraph.sortedOrder (topological)
      → module.process(graph, glCanvas)  ← each module renders to its outputFBO
```

**Key files:**
- `sketch.js` — p5.js entry point; owns `ProcessingPipeline` and `NodeGraphUI`; handles global keyboard shortcuts (Ctrl+S save patch, Ctrl+O load patch, Delete/Backspace delete selected node, Escape exit fullscreen)
- `pipeline.js` — `ProcessingPipeline`: holds the `ConnectionGraph`, drives per-frame processing
- `graph.js` — `ConnectionGraph`: DAG of modules; re-runs topological sort on every structural change; serializes/deserializes the full patch as JSON
- `moduleRegistry.js` — global module registry; `registerModule(typeName, class)` / `createModule(typeName, glCanvas, id)`
- `ui.js` — `NodeGraphUI`: full node graph editor drawn on the p5.js P2D canvas, with a DOM sidebar palette; handles pan/zoom, node drag, cable wiring, parameter knobs, and monitor preview rendering

### Module System (`modules/`)

All modules extend `Module` (base class in `modules/Module.js`) and call `registerModule()` at the bottom of their file. Modules must be explicitly imported in `sketch.js` to be registered.

Every module that produces video output:
1. Calls `this.createShader(fragSrc)` and `this.createOutputFBO()` in its constructor
2. Overrides `process(graph, glCanvas)` to render into `this.outputFBO` using its GLSL shader
3. Reads upstream video via `this.getInput(graph, portIndex)` which returns the upstream module's `outputFBO`

`params` is a plain object: `{ paramName: { value, min, max, step, label } }`. The UI renders each param as a draggable knob.

**Module categories (as defined in `ui.js`):**
- Sources: Camera, VideoPlayer, Oscillator
- Core: Comparator, FunctionGenerator, AdderMultiplier, Differentiator, ColorEncoder, SyncGenerator, ValueScrambler
- Effects: TV, Film, VHSC, PixelVision, GameBoy, HyperCard, Delay, Glitch
- Output: Monitor

### Shaders (`shaders/`)

Fragment shaders are stored as JS template literal exports (e.g., `export const oscillatorFrag = \`...\``). `shaders/vert.js` exports the single shared vertex shader `vertSrc` used by all modules. Most modules import their own fragment shader from here.

### Adding a New Module

1. Create `shaders/mymodule.js` exporting the fragment shader source
2. Create `modules/MyModule.js` extending `Module`, defining `inputs`, `outputs`, `params`, and `process()`; call `registerModule('MyModule', MyModuleClass)` at the end
3. Import `'./modules/MyModule.js'` in `sketch.js`
4. Add the type name to the appropriate category in `MODULE_CATEGORIES` in `ui.js`

### ZGRASS Module

The ZGRASS module (`modules/ZGRASSModule.js`) is a complete embedded ZGRASS interpreter — an emulation of the Datamax UV-1 / Sandin Image Processor's ZGRASS language (from the FakeGRASS project). It has no input ports and one video output.

**Embedded source:** All FakeGRASS subsystems live in `modules/zgrass/` (flattened from FakeGRASS's `lang/`, `graphics/`, and `ui/` directories). No import path changes were needed since the relative structure is preserved.

**Rendering path:** The ZGRASS 2-bit framebuffer is converted to a `p5.Image` each frame via palette lookup (`_updateFBImage()`), then uploaded to the module's WebGL `outputFBO` as a texture via the passthrough shader. The terminal/REPL overlays are NOT in the video output — they are rendered directly on the main P2D canvas only when the module is fullscreened.

**Fullscreen behavior:**
- Double-click the node preview to enter fullscreen (same hit-test logic as Monitor)
- When fullscreened, all keyboard input is captured and routed to `mod.handleKey()` via `sketch.js keyPressed`
- Mouse position is converted to ZGRASS coordinates (`$X1`/`$Y1`) each frame via `updateMouseFromCanvas()`
- ESC (with no editor open) exits fullscreen; ESC inside the ZGRASS EDIT macro editor saves the macro
- Terminal + REPL overlays render over the video in fullscreen mode
- Clicking exits fullscreen (same as Monitor)

**ui.js additions for ZGRASS:** `getModuleHeight` and `_drawModule` treat ZGRASS like Monitor (large preview, `MONITOR_PREVIEW_W × MONITOR_PREVIEW_H`). `hitTestMonitorDblClick` checks for both `'Monitor'` and `'ZGRASS'` types.
