## LICHEN (LIveCoding Historical ENvironment) Architecture

### Data Flow

```
main.js (p5.js loop)
  → ProcessingPipeline.processFrame()
    → ConnectionGraph.sortedOrder (topological)
      → module.process(graph, glCanvas)  ← each module renders to its outputFBO
```

### Key Files

- `main.js` — p5.js entry point; owns `ProcessingPipeline` and `NodeGraphUI`; handles global keyboard shortcuts (Ctrl+S save patch, Ctrl+O load patch, Delete/Backspace delete selected node, Escape exit fullscreen)
- `pipeline.js` — `ProcessingPipeline`: holds the `ConnectionGraph`, drives per-frame processing
- `graph.js` — `ConnectionGraph`: DAG of modules; re-runs topological sort on every structural change; serializes/deserializes the full patch as JSON. This is the source of truth for patch state.
- `moduleRegistry.js` — global module registry; `registerModule(typeName, class)` / `createModule(typeName, glCanvas, id)`
- `ui.js` — `NodeGraphUI`: full node graph editor drawn on the p5.js P2D canvas, with a DOM sidebar palette; handles pan/zoom, node drag, cable wiring, parameter knobs, and monitor preview rendering
- `modules/Module.js` — base class for all modules; defines common behavior for shaders, FBOs, and parameters
- `shaders/vert.js` — the shared vertex shader used by all modules for screen-quad rendering

### Module System (`modules/`)

All modules extend `Module` (base class in `modules/Module.js`) and call `registerModule()` at the bottom of their file. Modules must be explicitly imported in `main.js` to be registered.

Every module that produces video output:
1. Calls `this.createShader(fragSrc)` and `this.createOutputFBO()` in its constructor
2. Overrides `process(graph, glCanvas)` to render into `this.outputFBO` using its GLSL shader
3. Reads upstream video via `this.getInput(graph, portIndex)` which returns the upstream module's `outputFBO`

The UI renders each param in the `params` object: `{ paramName: { value, min, max, step, label } }` as a draggable knob.

### Module Categories

- **Sources**: Camera, GRASS, GridGuys, NAPLPS, Oscillator, VideoPlayer
- **Core**: AdderMultiplier, ColorEncoder, Comparator, Differentiator, FunctionGenerator, SyncGenerator, ValueScrambler
- **Effects**: BooleanLogic, BufferSmear, DeeSeventySix, Delay, FilmGrain, GameBoy, Glitch, HSFlow, HyperCard, Mosaic, PixelVision, RuttEtra, SpatialSlice, TimeTunnel, TVLines, UnrealBloom, VHSC
- **Utility**: Brcosa, Levels, VideoMixer
- **Output**: Monitor

### Shaders (`shaders/`)

Fragment shaders are stored as JS template literal exports (e.g., `export const oscillatorFrag = \`...\``). `shaders/vert.js` exports the vertex shader `vertSrc` shared by all modules. Most modules import their own fragment shader from here.

## Adding a New Module

1. Create `shaders/mymodule.js` exporting the fragment shader source
2. Create `modules/MyModule.js` extending `Module`, defining `inputs`, `outputs`, `params`, and `process()`; call `registerModule('MyModule', MyModuleClass)` at the end
3. Import `'./modules/MyModule.js'` in `main.js`
4. Add the type name to the appropriate category in `MODULE_CATEGORIES` in `ui.js`

## GRASS Module

The GRASS module (`modules/GRASSModule.js`) is a complete embedded GRASS interpreter — an emulation of the Datamax UV-1 / Sandin Image Processor's GRASS language (from the FakeGRASS project). It has no input ports and one video output.

**Embedded source:** All FakeGRASS subsystems live in `modules/grass/` (flattened from FakeGRASS's `lang/`, `graphics/`, and `ui/` directories). No import path changes were needed since the relative structure is preserved.

**Rendering path:** The GRASS 2-bit framebuffer is converted to a `p5.Image` each frame via palette lookup (`_updateFBImage()`), then uploaded to the module's WebGL `outputFBO` as a texture via the passthrough shader. The terminal/REPL overlays are NOT in the video output — they are rendered directly on the main P2D canvas only when the module is fullscreened.

**Fullscreen behavior:**
- Double-click the node preview to enter fullscreen (same hit-test logic as Monitor)
- When fullscreened, all keyboard input is captured and routed to `mod.handleKey()` via `main.js keyPressed`
- Mouse position is converted to GRASS coordinates (`$X1`/`$Y1`) each frame via `updateMouseFromCanvas()`
- ESC (with no editor open) exits fullscreen; ESC inside the GRASS EDIT macro editor saves the macro
- Terminal + REPL overlays render over the video in fullscreen mode
- Clicking exits fullscreen (same as Monitor)

**ui.js integration:** `getModuleHeight` and `_drawModule` treat GRASS like Monitor (large preview, `MONITOR_PREVIEW_W × MONITOR_PREVIEW_H`). `hitTestMonitorDblClick` checks for both `'Monitor'` and `'GRASS'` types.

## Development Conventions

- **State Management**: The `ConnectionGraph` is the source of truth for the patch state.
- **Rendering**: Modules should always render to their `outputFBO` during `process()`. The `Monitor` and `GRASS` modules provide previews by blitting their FBOs to the main P2D canvas in `ui.js`.
- **Parameters**: Module parameters are normalized or use specific ranges defined in the `params` object. The UI handles scaling these values for display.
- **Coordinate System**: p5.js uses a 2D coordinate system for the UI (top-left 0,0), while the WebGL `glCanvas` uses standard GL coordinates (centered 0,0 or screen-space depending on usage).

