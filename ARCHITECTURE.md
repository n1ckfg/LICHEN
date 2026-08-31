## LICHEN (LIveCoding Historical ENvironment) Architecture

### Data Flow

```
js/main.js (p5.js loop)
  → ProcessingPipeline.processFrame()
    → ConnectionGraph.sortedOrder (topological)
      → module.process(graph, glCanvas)  ← each module renders to its outputFBO
```

### Key Files

- `js/main.js` — p5.js entry point; owns `ProcessingPipeline` and `NodeGraphUI`; handles global keyboard shortcuts (Ctrl+A select all, Ctrl+S save patch, Ctrl+O load patch, Delete/Backspace delete selected node, Escape exit fullscreen)
- `js/pipeline.js` — `ProcessingPipeline`: holds the `ConnectionGraph`, drives per-frame processing
- `js/graph.js` — `ConnectionGraph`: DAG of modules; tracks video `connections` and parameter `controlConnections`; re-runs topological sort on every structural change; serializes/deserializes the full patch as JSON. This is the source of truth for patch state.
- `js/moduleRegistry.js` — global module registry; `registerModule(typeName, class)` / `createModule(typeName, glCanvas, id)`
- `js/ui.js` — `NodeGraphUI`: full node graph editor drawn on the p5.js P2D canvas, with a DOM sidebar palette and right-click search popup; handles pan/zoom, node drag, cable wiring, parameter knobs, and monitor preview rendering
- `js/modules/Module.js` — base class for all modules; defines common behavior for shaders, FBOs, and parameters
- `js/shaders/vert.js` — the shared vertex shader used by all modules for screen-quad rendering
- `workflows/` — contains JSON patches (connection graph state, module types, and parameter values) that can be loaded via Ctrl+O

### Module System (`js/modules/`)

All modules extend `Module` (base class in `js/modules/Module.js`) and call `registerModule()` at the bottom of their file. Modules must be explicitly imported in `js/main.js` to be registered.

Every module that produces video output:
1. Calls `this.createShader(fragSrc)` and `this.createOutputFBO()` in its constructor
2. Overrides `process(graph, glCanvas)` to render into `this.outputFBO` using its GLSL shader
3. Reads upstream video via `this.getInput(graph, portIndex)` which returns the upstream module's `outputFBO`

Modules can also export control values by setting `this.controlValues['portName'] = value` during `process()`. These values are read via `this.getControlValue(portIndex)` and can be routed to downstream module parameters via parameter cables (`controlConnections`).

The UI renders each param in the `params` object: `{ paramName: { value, min, max, step, label } }` as a draggable knob.

Each node header has a collapse toggle in the upper right ("−" when expanded, "+" when collapsed). A module may also set `this.historicalInfo = 'Name'` in its constructor; this adds a "?" button to the left of the collapse toggle that opens an info popup (2× the node's size, centered on the node, dismissed by any click outside it). The popup content comes from the entry with a matching `name` in `docs/historical-info.json`: the popup's heading is that entry's `title` followed by its `year` in parentheses (the title falls back to the `historicalInfo` name when the entry or its title is missing; the year is omitted when absent), and its text is the entry's `body`. Modules leaving `historicalInfo` at its default `null` show no button.

The popup is a **DOM overlay** (`.info-popup`, styled in `css/style.css`), not canvas text, so an entry's `title` and `body` are both rendered as HTML markup — links, emphasis, lists, images. `NodeGraphUI._updateInfoPopup()` runs each frame from `draw()`: it repositions and `scale()`s the element to track the node's pan/zoom, clamps it to the viewport, and hides it while a module is fullscreened. Mouse and wheel events inside the popup are stopped from reaching p5's window-level handlers so links stay clickable and long entries scroll instead of zooming the graph; anchors get `target="_blank"` so following one doesn't tear down the patch.

### Module Categories

- **Sources**: Camera, Cloudy, Conway, GRASS, GridGuys, InkDrops, NAPLPS, Oscillator, Protozoa, TimeTunnel, VideoPlayer
- **Core**: AdderMultiplier, ColorEncoder, Comparator, Differentiator, FunctionGenerator, SyncGenerator, ValueScrambler
- **Effects**: BooleanLogic, BufferSmear, Cyberlace, DeeSeventySix, Delay, Dither, FilmGrain, GameBoy, Glitch, HSFlow, HyperCard, LuminanceDelay, Maelstrom, Mosaic, PixelVision, RuttEtra, Slitscan, SpatialSlice, TVLines, UnrealBloom, VHSC
- **Utility**: Brcosa, Levels, Sharpen, VideoMixer
- **Output**: Monitor

### Shaders (`js/shaders/`)

Fragment shaders are stored as JS template literal exports (e.g., `export const oscillatorFrag = \`...\``). `js/shaders/vert.js` exports the vertex shader `vertSrc` shared by all modules. Most modules import their own fragment shader from here.

## Adding a New Module

1. Create `js/shaders/mymodule.js` exporting the fragment shader source
2. Create `js/modules/MyModule.js` extending `Module`, defining `inputs`, `outputs`, `params`, and `process()`; call `registerModule('MyModule', MyModuleClass)` at the end
3. Import `'./modules/MyModule.js'` in `js/main.js`
4. Add the type name to the appropriate category in `MODULE_CATEGORIES` in `js/ui.js`

## GRASS Module

The GRASS module (`js/modules/GRASSModule.js`) is a complete embedded GRASS interpreter — an emulation of the Datamax UV-1 / Sandin Image Processor's GRASS language (from the FakeGRASS project). It has no input ports and one video output.

**Embedded source:** All FakeGRASS subsystems live in `js/modules/grass/` (flattened from FakeGRASS's `lang/`, `graphics/`, and `ui/` directories). No import path changes were needed since the relative structure is preserved.

**Rendering path:** The GRASS 2-bit framebuffer is converted to a `p5.Image` each frame via palette lookup (`_updateFBImage()`), then uploaded to the module's WebGL `outputFBO` as a texture via the passthrough shader. The terminal/REPL overlays are NOT in the video output — they are rendered directly on the main P2D canvas only when the module is fullscreened.

**Fullscreen behavior:**
- Double-click the node preview to enter fullscreen (same hit-test logic as Monitor)
- When fullscreened, all keyboard input is captured and routed to `mod.handleKey()` via `js/main.js keyPressed`
- Mouse position is converted to GRASS coordinates (`$X1`/`$Y1`) each frame via `updateMouseFromCanvas()`
- ESC (with no editor open) exits fullscreen; ESC inside the GRASS EDIT macro editor saves the macro
- Terminal + REPL overlays render over the video in fullscreen mode
- Clicking exits fullscreen (same as Monitor)

**js/ui.js integration:** `getModuleHeight` and `_drawModule` treat GRASS like Monitor (large preview, `MONITOR_PREVIEW_W × MONITOR_PREVIEW_H`). `hitTestMonitorDblClick` checks for both `'Monitor'` and `'GRASS'` types.

## NAPLPS Module

The NAPLPS module (`js/modules/NAPLPSModule.js`) decodes North American Presentation Level Protocol Syntax (.nap) files containing vector graphics instructions.

**Decoding:** Relies on the external `js/modules/naplps/naplps.js` decoder logic. It accepts file drops through a hidden HTML file input, creating draw commands progressively with a configurable playback speed.
**Rendering path:** Commands are executed into a 2D `p5.Graphics` buffer using p5 drawing commands (`pg.rect`, `pg.vertex`, etc.), tracking color and progressive drawing state, which is then mapped to the module's WebGL `outputFBO` via the passthrough shader.

## GridGuys Module

The GridGuys module (`js/modules/GridGuysModule.js`) provides an autonomous simulation using a ping-pong shader technique to evolve cellular-automata-like agents across the screen.

**Simulation path:** It uses two internal framebuffers (`fboA` and `fboB`) to run a custom vertex/fragment simulation pass (`js/shaders/gridguys-simulation.js`) that tracks the odds of agent spread in 8 cardinal directions, guided by an autonomous target cursor (`js/modules/gridguys/target.js`).
**Rendering path:** The resulting buffer state is passed through a secondary render pass (`js/shaders/gridguys-render.js`) mapped to the module's main `outputFBO`.

## Conway Module

The Conway module (`js/modules/ConwayModule.js`) implements Conway's Game of Life using GPU-based ping-pong simulation.

**Simulation path:** Uses two framebuffers (`fboA` and `fboB`) for ping-pong state updates. The simulation shader (`js/shaders/conway.js:conwaySimulationFrag`) counts neighbors using toroidal (wrap-around) boundary conditions and applies standard B3/S23 rules.

**Rendering path:** The render shader (`conwayRenderFrag`) pixelates the simulation state based on the `cellSize` parameter and maps dead/alive cells to configurable colors.

**Fullscreen interaction:**
- Double-click the node preview to enter fullscreen
- Click/drag to draw cells, right-click to spawn patterns (glider, lwss, pulsar, etc.)
- Scroll wheel adjusts cell size
- Keyboard: SPACE pause/play, R randomize, C clear, P cycle patterns, +/- adjust speed
- ESC exits fullscreen

## Protozoa Module

The Protozoa module (`js/modules/ProtozoaModule.js`) generates autonomous watercolor-like bleed effects using a multi-pass shader pipeline.

**Simulation path:** Uses four framebuffers (`fb1`-`fb4`) in a circular feedback loop with four distinct shader passes:
1. **Diffusion** (`js/shaders/protozoa.js:protozoaDiffuseFrag`) - Laplacian diffusion spreads color using heat equation approximation
2. **Bleed** (`protozoaBleedFrag`) - Anisotropic bleeding simulates paper fiber absorption with FBM-based paper texture
3. **Feedback** (`protozoaFeedbackFrag`) - Creates ripple effects based on intensity gradients with temporal persistence
4. **Banding** (`protozoaBandingFrag`) - Chromatic separation and color banding to prevent whiteout

**Color injection:** Auto-spawns HSV color blobs at random positions with configurable spawn rate and size. Blobs fade over time (life decay).

**Rendering path:** Final display pass (`protozoaDisplayFrag`) combines the middle buffer state with tone mapping, gamma correction, and subtle vignette, output to the module's `outputFBO`.

## InkDrops Module

The InkDrops module (`js/modules/InkDropsModule.js`) is a source: drops of ink blooming into wet paper. It is a single stateless fragment shader (`js/shaders/inkdrops.js`) with no framebuffer history — everything is a closed-form function of time, so it costs one full-screen pass per frame.

**Drop model:** eight slots are compiled into the shader; `drops` gates how many are live. Each slot spawns on a jittered 4x2 grid, spreads as a decelerating bounded front (`R = spread * (1 - exp(-age*0.45))`, so a drop can never flood the frame), leaves four trailing rings behind the leading annulus, and fades to exactly zero at `life` seconds before respawning in a new cell. The cell rotates by 3 each generation (coprime with 8) so no slot camps a corner. Drops are alpha-composited with `over()`, keeping coverage in [0,1] however many overlap.

**Fullscreen interaction:** double-click the node preview to enter fullscreen, then click to drop ink at the cursor; ESC exits. `js/ui.js mousePressed` routes the click to `handleMouseDown()` for `Conway` and `InkDrops` rather than exiting fullscreen.

**Port note:** the WebGL2 original was GLSL ES 3.00; LICHEN is WebGL1, so the shader is downconverted (`out vec4 O` to `gl_FragColor`, `#version` dropped). Coordinates stay on `gl_FragCoord` exactly as the original and as `Conway` do, which is also what makes the click mapping match Conway's letterbox fit.

## TimeTunnel Module

The TimeTunnel module (`js/modules/TimeTunnelModule.js`) is a source: a rotating video-feedback tunnel whose whole animation repeats exactly every `loop` seconds.

**Exact looping:** the tunnel is a feedback accumulation, so the loop can't be closed by rewinding the clock — the buffer would still hold the old state. Instead two independent feedback buffers ("worlds") run half a cycle out of phase. Each restarts from black once per cycle, at the moment its own blend weight is zero and flat, so the restart is invisible; the output is always dominated by the mid-life world. The cycle phase is accumulated per frame (`this.cycles += dt / loop`) rather than derived from an absolute clock, so turning the `loop` knob changes the rate without jumping the cycle.

**Rendering path:** each world ping-pongs a pair of framebuffers through `js/shaders/timetunnel.js:timetunnelFrag`, which advects the previous frame along a twist that shears with radius (the inner turns faster than the outer, which is what winds the feedback into arms) and adds fbm-warped ripples and a bright core. `timetunnelBlendFrag` then cross-dissolves the two worlds into the module's `outputFBO`.

**No Game of Life:** the WebGL sketch this was ported from drove `swirl`, `ripple`, `speed` and a dye injection from a Game of Life grid, but that grid never reached its shader — it was uploaded as raw 0/1 bytes in a `gl.ALPHA` texture, so a live cell arrived as `1/255`, `dye = smoothstep(0.6, 1.0, 0.0039)` was identically 0, and every GoL-driven term sat on a constant. The simulation is therefore not reproduced here; the three constants it was stuck on are exposed as the `swirl`, `ripple` and `speed` knobs instead, whose defaults match the original.

## LuminanceDelay and Slitscan Modules

Both modules implement time-based effects that require random access to a ring buffer of past input frames. The original WebGL2 reference (ShaderPadTests `slitscan-slow-luminance.html` and `slitscan-wiggle-spatial.html`) stores history in a `sampler2DArray`, which isn't available in WebGL1. LICHEN emulates this with a 2D **tile atlas**: a single framebuffer holding an 8×8 grid of 64 downscaled history frames (tile size = `glCanvas / 4` per axis, so the atlas is `glCanvas.width × 2` by `glCanvas.height × 2`).

**Ring buffer write:** Two atlases ping-pong each frame. The shared `js/shaders/atlas-write.js` shader reads the previous atlas into the new one, replacing only the pixels inside the current write tile with the upstream input. After the write pass the pointers are swapped so `atlasA` always holds the latest history.

**Output pass:**
- `LuminanceDelay` (`js/modules/LuminanceDelayModule.js`, `js/shaders/luminance-delay.js`) samples the current tile for luminance, maps it through `divisions` / `framesPerDivision` to a per-pixel frame delay, then samples the delayed tile. Negative `divisions` inverts so bright regions lag instead of dark ones.
- `Slitscan` (`js/modules/SlitscanModule.js`, `js/shaders/slitscan.js`) partitions the output along `axis` (Y or X) into `strips` bands, each delayed proportionally to its index by `delay` frames per strip.

Both modules clear their atlases on construction so the early frames show progressive fill rather than garbage memory.

## Development Conventions

- **State Management**: The `ConnectionGraph` is the source of truth for the patch state.
- **Rendering**: Modules should always render to their `outputFBO` during `process()`. The `Monitor` and `GRASS` modules provide previews by blitting their FBOs to the main P2D canvas in `js/ui.js`.
- **Parameters**: Module parameters are normalized or use specific ranges defined in the `params` object. The UI handles scaling these values for display.
- **Coordinate System**: p5.js uses a 2D coordinate system for the UI (top-left 0,0), while the WebGL `glCanvas` uses standard GL coordinates (centered 0,0 or screen-space depending on usage).

