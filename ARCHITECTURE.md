## LICHEN (LIveCoding Historical ENvironment) Architecture

### Data Flow

```
js/main.js (p5.js loop)
  → ProcessingPipeline.processFrame()
    → ConnectionGraph.sortedOrder (topological)
      → module.process(graph, glCanvas)  ← each module renders to its outputFBO
```

### Key Files

- `js/main.js` — p5.js entry point; owns `ProcessingPipeline` and `NodeGraphUI`; handles global keyboard shortcuts (Ctrl+A select all, Ctrl+S save patch, Ctrl+O load patch, Delete/Backspace delete selected node, Escape exit fullscreen); also parses and loads shareable patch data from the URL hash.
- `js/pipeline.js` — `ProcessingPipeline`: holds the `ConnectionGraph`, drives per-frame processing, and keeps glCanvas at the patch's frame size (see Frame Size)
- `js/frame.js` — the default frame size, the bounds a typed one is held to, and `letterbox()`, which places the frame in a canvas of another shape (see Frame Size)
- `js/graph.js` — `ConnectionGraph`: DAG of modules; tracks video `connections` and parameter `controlConnections`; re-runs topological sort on every structural change; serializes/deserializes the full patch as JSON. This is the source of truth for patch state.
- `js/moduleRegistry.js` — global module registry; `registerModule(typeName, class)` / `createModule(typeName, glCanvas, id)` for the UI, and `createModuleByUid(uid, glCanvas, id, savedType)` for loading patches. It checks every module's ids (see Patch IDs)
- `js/ui.js` — `NodeGraphUI`: full node graph editor drawn on the p5.js P2D canvas, with a DOM sidebar palette and right-click search popup; handles pan/zoom, node drag, cable wiring, parameter knobs, and monitor preview rendering
- `js/modules/Module.js` — base class for all modules; defines common behavior for shaders, FBOs, and parameters, plus seeded randomization and trigger params
- `js/stringseed.js` — `StringSeed`, the SSoT seed-to-choice mapping behind `Module.randomize()` (ported from the StringSeedGenerator project)
- `js/shaders/vert.js` — the shared vertex shader used by all modules for screen-quad rendering
- `coi-serviceworker.js` — a service worker that cross-origin isolates the page, so ONNX Runtime's WASM backend can run threads (see Cross-Origin Isolation)
- `workflows/` — contains JSON patches (connection graph state, module types, and parameter values) that can be loaded via Ctrl+O
- `tools/convert-workflows.mjs` — converts patches saved before ids to the id format, using the frozen table in `tools/legacy-ids.json` (see Patch IDs)
- `tools/new-uids.mjs` — gives a module class a fresh `static uid` and fresh ids for its params and ports, as step 3 of Adding a New Module asks
- `tools/patch-to-gles3.mjs` — turns a patch into a standalone node-gles3 script that plays it fullscreen with no UI (see Exporting to node-gles3)
- `tools/pix2pix-onnx.py` — converts a pix2pix generator, exported to fp32 ONNX or as a PyTorch checkpoint, into the int8/fp16 file Pix2Pix loads (see Pix2Pix Module)

### Module System (`js/modules/`)

All modules extend `Module` (base class in `js/modules/Module.js`) and call `registerModule()` at the bottom of their file. Modules must be explicitly imported in `js/main.js` to be registered.

Every module that produces video output:
1. Calls `this.createShader(fragSrc)` and `this.createOutputFBO()` in its constructor
2. Overrides `process(graph, glCanvas)` to render into `this.outputFBO` using its GLSL shader
3. Reads upstream video via `this.getInput(graph, portIndex)` which returns the upstream module's `outputFBO`

A module frees what it holds in `dispose()`: streams, workers, windows, audio output, DOM panels and buffers. It runs when a deleted node's fade-out ends, and for every node in the graph when a patch is loaded (`NodeGraphUI.fromJSON()`), before the new patch's nodes are built. Until 2026-11-12 a load only dropped the old nodes, so a patch's Camera kept its stream and the camera's light on after another patch replaced it. Loading every workflow twice in headless Chrome had left 10 streams live and 10 video elements in the page. It now leaves only the loaded patch's.

Modules can also export control values by setting `this.controlValues['portName'] = value` during `process()`. These values are read via `this.getControlValue(portIndex)` and can be routed to downstream module parameters via parameter cables (`controlConnections`).

A control value is one number a frame, and a parameter cable applies it after every module has processed. Some sources carry more, such as a whole loop of audio samples each frame:
- **Control signals:** a control output can also publish a loop in `this.controlSignals['portName']`, as `{ samples, sampleRate, z, color }`. `samples` is a `Float32Array` in −1..1. `z` (blanking, XYscope's −1 off and 1 on) and `color` (0xRRGGBB a sample) are optional lanes the same length, or `null`. It should still set a numeric `controlValues` entry for the same port, because a knob cable sees only that.
- **Control input pins:** an input declared `{ name, type: 'control' }` is drawn green, as is a cable into it, and takes a control output's cable. The cable is stored in `connections`, like a video cable, so the topological sort runs the source first, in the same frame. `this.getControlInput(graph, portIndex)` returns `{ value, signal }`: the source's control value and its control signal, or `null` for the signal if it has none. It returns `null` when nothing is cabled to the pin, or when a video output is.

Latk's, NAPLPS's, RuttEtra's, Skeleton's and Yellowtail's X and Y outputs, and Twoscilloscope's and ESP32's X and Y pins, are the only ones so far (see Latk Module, NAPLPS Module, RuttEtra Module, Skeleton Module, Yellowtail Module and ESP32 Module). Calculator's `a` and `b`, Remap's five pins, and Conway's and InkMarkers' X and Y are control input pins too, but read only the value (see Random, Constant, Calculator and Remap Modules, Conway Module and InkMarkers Module).

The UI renders each param in the `params` object: `{ paramName: { id, value, min, max, step, label } }` as a draggable knob. A param may add `valueLabels: [...]`, an array indexed by the rounded param value; when it has an entry for the current value the knob shows that name instead of the number.

**Typed values.** Double-clicking a knob's value opens a text field (`NodeGraphUI._openParamInput()`). A number typed there isn't held to the param's `min` and `max`. `Module.setParam(name, value, clamp = true)` clamps by default, so a knob drag, a cable and a module's own code stay in range, and the field passes `clamp` false:
- **The knob:** a value past the range draws its arc at the end it is past, and a drag starts from that end, so the first move brings it back into range.
- **Patches:** the typed value saves as it is. `fromJSON()` and duplicating a node set it with `clamp` false too, so it reloads and copies as typed. No workflow saved a value outside its param's range before this, so they all load as they did.
- **Exceptions:** drop-downs and triggers have no field. VideoToasting's Inputs clamps a typed count too, since it has only six ports.
- **Sizes:** a typed size is used as asked. p5 cuts a framebuffer the GPU can't make, so Restore's Width at 100000 works at 8192 in SwiftShader. A negative Width or Height on Restore or Resample is Input, as 0 is.

Checked in headless Chromium on a Raspberry Pi. Every knob param of every module, set one range past each end, ran three frames with no exception and no control output that wasn't finite. A typed value saved and loaded as typed.

A param that also sets `widget: 'dropdown'` is drawn as a drop-down menu instead of a knob. Every named-mode param uses one: AdderMultiplier `mode`, Blur `mode`, Calculator `op`, Camera `device`, `resolution`, `fps` and `mirror`, Crop `mode`, DepthAnything `size`, `colormap` and `invert`, Displacer `xChannel`, `yChannel` and `edges`, Dither `mode` and `color`, Edges `mode`, ESP32 `color` and `grid`, FunctionGenerator `curve`, InfrDrawings `model` and `mode`, InkMarkers `tip` and `paper`, Inpainter `view`, LUT `preset`, Matte `matte`, OpticalFlow `view`, Oscillator `waveform` and `direction`, Panorama `projection`, Pix2Pix `model` and `mode`, QTVR `projection`, Resample `mode`, Restore `model`, `size` and `clamp`, RuttEtra `format` and `method`, Sharpen `posterize`, Skeleton `trace` and `hold`, Slitscan `axis`, SlowscanJam `blend`, `effect` and `sync`, SyncGenerator `mode`, Twoscilloscope `view`, `effect` and `sound`, VideoMixer `mode`, VideoToasting `effect` and Whitney `sketch`. Its `valueLabels` are the menu's options, and `min`/`max`/`step` should still run `0`…`valueLabels.length - 1` in steps of 1. It is still a plain numeric param, so it saves, loads and duplicates like a knob does. The menu reads `valueLabels` when it opens, so a module may change its options at runtime, as Camera and DepthAnything do. It should set `max` to match. The row shows a small inlet dot where the knob would be, then the label, then a box with the selected option. An option too long for the box is cut short with an ellipsis; the menu itself grows to show it in full. Clicking the box opens the menu, which is a **DOM overlay** (`.param-dropdown`, styled in `css/style.css`). `NodeGraphUI._updateDropdownMenu()` keeps it pinned under the box through pan and zoom every frame, and opens it upward when there is no room below. Choose an option with a click, or with the arrow keys and Enter; Escape or any click outside closes it. The menu catches keys with a capture-phase `keydown` listener on `window`, which runs before p5's own handler, so Backspace/Delete can't delete the node while it is open. A control cable plugs into the inlet dot as it would into a knob and drives the value through the usual `min + cv × (max − min)` scaling, so a module has to round the value itself, the same way the box does: `Math.round` in JS, or `x < k + 0.5` thresholds in GLSL (not `Math.floor`). While a cable is connected the box shows the live option and won't open. With no cable, the dot is only a cable target: dragging it does not change the value.

A param that sets `widget: 'trigger'` is drawn as a momentary button instead of a knob. It uses the same row as a drop-down: an inlet dot, then the label, then a button where the drop-down's box would be. Declare it as `{ value: 0, min: 0, max: 1, step: 1, label, widget: 'trigger' }`. Clicking the button calls `mod.fireTrigger(name)`. That records the time in `mod.triggeredAt[name]` and then calls `mod.onTrigger(name)`, which modules override to act on the trigger. A control cable fires it too. `ProcessingPipeline` fires the trigger on the cable's rising edge, when the value it applies crosses the param's midpoint (0.5) from below. The button still fires on a click while a cable is connected, since firing never touches the value. Its text is `mod.triggerText(name)`, which is empty by default and cut short with an ellipsis when it is too long. It is drawn fully lit on the first frame after it fires, however slow that frame is, then fades back over 250 ms. As with the drop-down, dragging the unconnected dot does nothing. A trigger's value is saved like any other param, but it only records where the last cable left it.

### Seeded Randomization

`Module.randomize(seed)` sets params from a hex seed using the SSoT (String Seed of Thought) protocol in `js/stringseed.js`. It is based on Misaki & Akiba (2025) and ported from the StringSeedGenerator project. The protocol works like this:
- A param opts in with a `random` key. `random: true` draws from its whole `min`…`max` range, and `random: [lo, hi]` draws from a narrower one. Either way, the candidates are the param's `step` grid over that range.
- Each opted-in param is one axis, in declaration order. Axis *i* reads the *i*-th 4-character slice of the seed.
- That slice is read as a hex integer and taken modulo the axis's candidate count, which picks the value. Any choice can be checked by hand with `echo $((16#<slice> % <n>))`.
- Called with no argument, `randomize()` draws a fresh seed from `crypto.getRandomValues`, two bytes per axis, so no two axes share a slice.
- Resolving the same seed against the same param table always gives the same values.

The seed is kept on `mod.seed`. A node whose `mod.seed` is set saves it as `seed` in the patch JSON, and duplicating a node copies it. On load, `fromJSON` restores the saved seed and the saved param values, and does not re-resolve the seed, because knobs may have moved since it was drawn. A patch saved before seeds existed loads with `mod.seed = null`.

A module adopts this by adding `random` to its params. It may call `this.randomize()` at the end of its constructor, and may add a trigger param with `onTrigger()` calling `this.randomize()` and `triggerText()` returning `this.seed`. Cloudy, Coils, Crystalline, InkDrops, Protozoa and SpiralGalaxy all do all three, each with the trigger named `reseed` and labelled Seed, last in its params. The seed sets params only. Anything a module draws from `Math.random` stays unseeded.

Each node header has a collapse toggle in the upper right ("−" when expanded, "+" when collapsed). A module whose type name matches an entry's `name` in `js/historical-info.json` also gets a "?" button to the left of the collapse toggle, so adding an entry named after a module is enough to give it one. A module can point at an entry with another name by setting `this.historicalInfo = 'Name'` in its constructor, as the Sandin modules share `Sandin`; that name then shows the button even with no entry. `NodeGraphUI._infoName(mod)` resolves the name: `historicalInfo` when set, else the type when an entry has it, else `null` for no button. The button opens an info popup (2× the node's size, centered on the node, dismissed by any click outside it). The popup's heading is the entry's `title` followed by its `year` in parentheses (the title falls back to the resolved name when the entry or its title is missing; the year is omitted when absent), and its text is the entry's `body`.

The popup is a **DOM overlay** (`.info-popup`, styled in `css/style.css`), not canvas text, so an entry's `title` and `body` are both rendered as HTML markup — links, emphasis, lists, images. `NodeGraphUI._updateInfoPopup()` runs each frame from `draw()`: it repositions and `scale()`s the element to track the node's pan/zoom, clamps it to the viewport, and hides it while a module is fullscreened. Mouse and wheel events inside the popup are stopped from reaching p5's window-level handlers so links stay clickable and long entries scroll instead of zooming the graph; anchors get `target="_blank"` so following one doesn't tear down the patch.

### Node Previews

A node shows its output (a Monitor its input) in a preview on the 2D canvas. The 2D canvas can only take a WebGL picture by copying glCanvas with `drawImage`, and in Chrome each copy made after glCanvas has changed costs about 0.85 ms of GPU time at pixel density 2. Previews used to fill glCanvas with each node's picture in turn and copy it, which made them most of the frame: 17 of 21 ms in a 19-node patch. Now `draw()` plans every preview of the frame first (`_planPreviews()`):
- **Tiles:** each preview gets its own tile of glCanvas, the size it shows on screen, in device pixels: the pixels whose centres it covers, cut to the canvas. A preview off screen gets none.
- **Pages:** tiles that don't fit on glCanvas together go on a later page, in drawing order. One page usually holds them all.

`_drawPreview()` draws a tile's page into glCanvas (`previewFrag`, under `blendMode(REPLACE)`) when the first of its tiles is needed, and copies the tile at the identity transform, one device pixel to one. glCanvas is then copied once a frame instead of once a node.

**Same picture.** `previewFrag` samples each framebuffer where Chrome's `drawImage` sampled the full-size copy: at each device pixel's centre, bilinear, with no mipmaps. Chrome fills only the pixels whose centres the picture covers, and fades an edge pixel by the smaller of its two coverages, which the tile does too. In headless Chrome, test patterns come out within 2 levels of the old copy at pixel density 2 and 3 at density 1, edges included. In the workflows' previews, 98–100% of preview pixels are within 2 levels. Most of the rest are a preview's first or last row, where Chrome sometimes samples a partly covered pixel somewhere else. Two changes are deliberate:
- **Transparency:** a picture with alpha below 1 was blended over whatever glCanvas held, which was the last node's preview. A tile replaces what is there, so the picture now shows over the preview's black. Delay does this, for example, and so does Image with no file loaded.
- **Outlines:** each copy used to flush the 2D canvas, which changed how Chrome antialiased the edges of some knob arcs and port rings, mostly at zoom 2 and above, by up to 117 levels on single edge pixels. They now draw as they would with no previews at all.

**Full-size copies.** Fullscreen, the second-screen window, the recording and the screenshot copy a picture whole, from the canvas `_fullSize()` gives them:
- **A picture that fits glCanvas:** `_blitFBO()` fills glCanvas with the framebuffer, which leaves no page in it, and glCanvas is the copy, as it always was. It draws under `blendMode(REPLACE)`, as the tiles do. It used to blend, so where a picture's alpha was below 1 the preview tiles still on glCanvas showed through, as thumbnails in its top-left corner. Delay's dark areas have alpha 0.1, so Delay showed it most, in fullscreen and in a Monitor's second-screen window, recording and Screenshot. In fullscreen the leaked tiles faded over about a second, since nothing draws previews there; through a Monitor they were the current ones. Checked in headless Chrome at pixel density 1 and 2, with each frame's preview tiles on glCanvas, for every node in `workflows/`: all 248 opaque pictures match the old blend on every value. Each of the 32 translucent ones (Delay, and BufferSmear, TimeTunnel, Glitch and Brcosa carrying alpha below 1) now matches the picture blitted alone onto a cleared glCanvas.
- **A bigger one:** an upscaling Restore's or Resample's output has more pixels than glCanvas (see Restore Module). It is drawn into glCanvas a tile at a time with `previewFrag`, one pixel to one, and each tile is copied to its place on a 2D canvas of the picture's size. That canvas is the copy.

`_drawFBO()` draws the copy on screen. A preview tile that won't fit on glCanvas is drawn that way too, which can't happen at the UI's zoom limits. Fullscreen and the second-screen window letterbox every picture to the frame's shape (see Frame Size), and the recording still stretches it to the Monitor's Width and Height. Monitor's Screenshot button, under Record, stretches it the same way and saves it as a PNG (`MonitorModule.saveScreenshot()`). It copies when clicked, outside `draw()`: glCanvas keeps no picture between frames, but a copy made in the same task as the drawing reads it.

Checked in headless Chrome on an M2 Max, at pixel density 1 and 2:
- **Pictures that fit:** a fullscreen Monitor, its recording from fullscreen and from the node view, and its second-screen copy all match commit 4970850 on every pixel.
- **Bigger ones:** the copy matches Restore's framebuffer on every pixel at 1440×1080, 1920×1440, 2560×1440, 1281×961 and 3840×2160. So does a recording at the same Width and Height, from fullscreen and from the node view, and a fullscreen window of 1440×1080 device pixels. Copied through glCanvas, as before, that window differed from the framebuffer on 35% of values at density 1, by up to 26 levels.

Each tile costs a copy of glCanvas, about 1 ms. At density 1, where glCanvas is 640×480 at the default frame size, showing a bigger picture can therefore cost more than making it:

| Picture | Tiles at density 1 | Tiles at density 2 |
| --- | --- | --- |
| 1440×1080 | 9 | 4 |
| 1920×1440 | 9 | 4 |
| 2560×1920 | 16 | 4 |
| 3840×2160 | 30 | 9 |

With a fullscreen Monitor on a Restore M and nothing else in the patch, the page held 60 fps up to 1920×1440 at density 1 and up to 2560×1920 at density 2. It gave 38 fps at 2560×1920 and 21–22 fps at 3840×2160 at density 1, and 36–38 fps at 3840×2160 at density 2.

### Module Categories

- **Sources**: Camera, Image, Mesh, VideoPlayer
- **Utility**: Blur, Brcosa, Channel, ChromaKey, Crop, Delay, Dither, Edges, Example, Inpainter, Levels, LUT, Matte, Mosaic, OpticalFlow, Resample, Restore, Sharpen, Transform, VideoMixer
- **Control**: Calculator, Constant, Random, Remap, Skeleton
- **Generative**: Cloudy, Coils, Conway, Crystalline, GridGuys, InkDrops, LetterForms, Protozoa, SpiralGalaxy, Whitney, Yellowtail
- **Emulation**: DeeSeventySix, ESP32, InkMarkers, RuttEtra, SlowscanJam, Twoscilloscope
- **Sandin**: AdderMultiplier, ColorEncoder, Comparator, Differentiator, FunctionGenerator, GRASS, Oscillator, SyncGenerator, ValueScrambler
- **Effects**: BooleanLogic, BufferSmear, Cyberlace, Displacer, FilmGrain, GameBoy, Glitch, HSFlow, HyperCard, LuminanceDelay, Maelstrom, PixelVision, Slitscan, SpatialSlice, TimeTunnel, TVLines, UnrealBloom, VHSC, VideoToasting
- **img2img**: DepthAnything, InfrDrawings, Pix2Pix
- **Formats**: Latk, NAPLPS, Panorama, QTVR, VRML
- **Output**: Monitor

### Shaders (`js/shaders/`)

Fragment shaders are stored as JS template literal exports (e.g., `export const oscillatorFrag = \`...\``). `js/shaders/vert.js` exports the vertex shader `vertSrc` shared by all modules. Most modules import their own fragment shader from here.

### Framebuffers

Unasked, p5 1.9 gives a framebuffer 2× MSAA wherever the user agent contains "safari", which Chrome's does, plus a float depth-stencil buffer. At 1280×960 that is about 44 MB a framebuffer, against 4.9 MB for its colour alone, and `end()` resolves the colour and the depth every time. A quad that covers the whole frame uses neither. So `Module.createFramebuffer(options)` makes one with `{ antialias: false, depth: false }` unless the options say otherwise, and `createOutputFBO()` uses it. Every module makes its framebuffers this way except where it draws geometry, whose edges MSAA smooths:
- **p5's default:** Latk, Mesh, RuttEtra, Skeleton, Twoscilloscope and Whitney draw into their output with `glCanvas.createFramebuffer()`, unchanged.
- **Their own options:** QTVR, VRML and SlowscanJam's screen, as before.

Firefox's user agent has no "safari", so it always drew these framebuffers this way. In the 19-node patch, a frame went from 4.7 to 3.1 ms at pixel density 2. In headless Chrome, every module fed colour bars on every input outputs the same as before on every pixel after 60 frames, at pixel density 1 and 2, except one pixel each of Coils and Protozoa, by one level. Both come from the quad's diagonal. Under MSAA, a pixel the diagonal crosses is shaded by both triangles and the two results averaged, and their interpolated `vTexCoord` differ by rounding.

### Frame Size

Every module renders at the frame size, glCanvas's logical size, times the pixel density. It is 640×480 (`DEFAULT_FRAME_WIDTH`, `DEFAULT_FRAME_HEIGHT` in `js/frame.js`) until a patch says otherwise. A patch sets it with its Monitors' Buffer Width and Buffer Height (`bufferWidth`, `bufferHeight`, the first two knobs, 64–3840 by 2160 in steps of 8). These are the frame in logical pixels, not the recording's size, which is still Width and Height.

**One size a patch.** There is one glCanvas, so all of a patch's Monitors share one value. `ProcessingPipeline._syncFrameSize()` runs at the start of every `processFrame()` and decides it:
- **A Monitor that changed:** a Monitor whose Buffer Width or Height differs from what it held last frame sets the size, whether a knob, a typed value or a cable changed it. Each Monitor's last values are kept in a `WeakMap`.
- **A patch just loaded:** `ConnectionGraph.fromJSON()` counts loads in `graph.loads`. Once a load leaves no Monitor seen before, the first Monitor in the patch's node order sets the size, or a patch with no Monitor goes back to 640×480.
- **Otherwise** the size stays. A Monitor added to the patch takes it up: its constructor sets its buffer knobs to glCanvas's size, and so does the next sync.

The size is then rounded and held to 16–4096 (`MIN_FRAME_SIZE`, `MAX_FRAME_SIZE`; past 4096 a browser's WebGL canvas may not allocate), and written back to every Monitor with `clamp` false, so they all show the size in use. A Monitor's `declared` values are the default 640×480, so a patch saved before the buffer knobs existed loads them at 640×480, which is how it ran: `ConnectionGraph.fromJSON()` puts back the `declared` value of a param a patch lacks (see Patch IDs). `tools/patch-to-gles3.mjs` takes the first Monitor's size the same way.

**Resizing.** A new size calls `ProcessingPipeline.resizeFrame(w, h)`. That calls `glCanvas.resizeCanvas(w, h, true)`, which reallocates every framebuffer made without a size of its own, clears it, and resets glCanvas's camera and viewport, then `mod.frameResized(w, h)` on every node. `Module.frameResized()` does nothing, and only a module that sized or drew something itself overrides it:
- **Buffers sized from the frame:** LuminanceDelay and Slitscan resize their atlases, UnrealBloom its mip chain, and Image and NAPLPS their P2D graphics. Camera sets its video element's size to the frame, which changes only how the element would display: the texture is uploaded at the stream's own resolution, which only the Resolution menu changes (see Camera Module).
- **State laid out over the frame:** Yellowtail resizes its graphics and its gestures' wrap, RuttEtra rebuilds its scan-line grid, InkMarkers takes a fresh sheet of paper at the new size, InkDrops clears to bare paper, Conway seeds a new board and DeeSeventySix resets.
- **Drawn only on change:** ESP32 and Skeleton draw their outputs again, since they came back cleared.
- **Pixel params:** Crop's X, Y, Width and Height, Transform's X and Y, and Displacer's X Max and Y Max run over the frame's pixels, so their ranges follow it. A Crop box the full width or height of the old frame stays full.
- **Labels:** DepthAnything's Size options fit the model input's long side to the frame's shape.

So a resize starts every feedback module over, and anything drawn into a buffer is lost. Each module reads the size from glCanvas when it needs it, and nothing else in `js/` assumes 640×480. Fullscreen, Monitor's second-screen window, and every module that takes the mouse in fullscreen (ChromaKey, Conway, Crop, InkDrops, InkMarkers, Transform, Yellowtail) place the frame with `letterbox()`, so a click lands where the picture is. Some numbers keep their own sizes on purpose: Whitney's sketch canvases, InfrDrawings' model inputs and Yellowtail's `TUNED_SHORT_SIDE`, the frame its speeds were tuned at.

**Limits.** Node previews are still a fixed 4:3 box, so a frame of another shape shows stretched in the node graph. Fullscreen, the second-screen window, a recording at the same shape, and the export show it as it is.

Checked in headless Chrome at pixel density 2. Every module but Camera and the four ONNX ones was built at 640×480 and the frame set to 1280×720. No module threw, and every output came back 1280×720 (Resample's is its own size). Each matched a twin built fresh at 1280×720 on the same steady input, except where it draws from random seeds or a clock. RuttEtra, ESP32 and Skeleton only matched after they had `frameResized()` hooks. At 640×480, the modules this changed (LuminanceDelay, Slitscan, UnrealBloom, RuttEtra, Crop, Transform, Displacer, ESP32, Monitor) gave the same output as HEAD's on every pixel. The sync rules were each tried: two Monitors, then a third added, a typed 100000, saving and loading a 1280×720 patch, an old workflow, a patch with no Monitor and a portrait 480×800 frame. In fullscreen at 16:9, a mouse drag on InkMarkers drew where the mouse went.

## Adding a New Module

`node tools/create-module.mjs <Name> [--category <category>]` does all five steps below, starting from `ExampleModule.js` and `example.js`. For `Spiral` it writes `js/modules/SpiralModule.js` and `js/shaders/spiral.js` (a `SpiralGalaxy` would get `spiral-galaxy.js` and `spiralGalaxyFrag`), runs `new-uids.mjs` on the module, imports it in `js/main.js`, and adds it to its category in `MODULE_CATEGORIES` and to `MODULE_COLORS`, in alphabetical order among the category's modules, with the colour most of them use. The category defaults to Effects. It refuses a name that's already a file or a registered type.

1. Create `js/shaders/mymodule.js` exporting the fragment shader source
2. Create `js/modules/MyModule.js` extending `Module`, defining `inputs`, `outputs`, `params`, and `process()`; call `registerModule('MyModule', MyModuleClass)` at the end
3. Give the class a fresh `static uid` (`openssl rand -hex 4`), and each param and port a fresh `id` (`openssl rand -hex 2`). Never copy them from another module, even when starting from its file (see Patch IDs). `node tools/new-uids.mjs js/modules/MyModule.js` does both for a module copied from another.
4. Import `'./modules/MyModule.js'` in `js/main.js`
5. Add the type name to the appropriate category in `MODULE_CATEGORIES` in `js/ui.js`

## Patch IDs

A patch saves modules, params and ports by id, never by name or port number, so any of them can be renamed or reordered without breaking saved patches:
- **Modules.** Each module class declares `static uid = '<8 hex digits>'`. A saved node has `uid`, which `createModuleByUid()` builds it from, and `type`, which is only there to make the file readable. Loading never reads `type`.
- **Params and ports.** Each param and port declares `id: '<4 hex digits>'` next to its name. These only need to be unique within their module, since a node's uid already says which module they belong to. Params, inputs and outputs share that one namespace. A saved node's `params` are keyed by param id. A video cable's `fromPort` and `toPort` are port ids, and a knob cable has `fromPort`, a port id, and `param`, a param id.

**Other data.** A module whose node holds data that isn't a param returns it from `saveState()` as plain JSON, and the patch saves it as the node's `state`. `fromJSON()` hands it back through `loadState()`, after the params, and duplicating a node copies it the same way. The base class saves nothing. ChromaKey's picked colours and Camera's menu choices are the only such data so far (see ChromaKey Module and Camera Module).

Only `ConnectionGraph.toJSON()` and `fromJSON()` see ids. At runtime everything still uses names and port numbers (`this.params.radius`, `getInput(graph, 0)`, `paramName` on a knob cable). `fromJSON()` maps the ids back using the declarations of the module it just built, so a renamed param, a renamed port, or a port moved to a new position all load with their saved values and cables. A saved value for a param that has since been removed is skipped, and a cable to a removed param or port is dropped with a console warning. A uid the registry doesn't know aborts the load.

`registerModule()` throws at startup on a class without its own uid, or with one another class already has. `createModule()` checks a type's param and port ids the first time it builds one, since they are declared in the constructor, and throws on one that is missing, malformed or already used in the module. `EffectMenu.params()` (see Audio Effects) declares its three params with fixed ids, so a module that spreads them in has to avoid those three for its own params and ports.

The rules:
1. Never edit an id once it is committed, and never reuse one, even one whose param or module was deleted.
2. An id names what a saved value means, not just where it goes. When a param's value changes meaning (a new range or unit, drop-down options reordered or removed), or a port changes between video and control, give it a new id. Old patches then load the declared value instead of a number that now means something else. Appending a drop-down option keeps the meaning, which is why the modules below append new options instead of inserting them.

Patches saved before ids, which name modules by type, params by name and ports by number, are converted with `node tools/convert-workflows.mjs <patch.json> ...`. It converts each file in place and leaves alone any file that already has ids. Loading one unconverted fails with a message pointing at the tool. The tool reads `tools/legacy-ids.json`, every module's type name, param names and port order as they were when ids were added. Never regenerate it from later code: an old patch uses the old names.

## Renaming a Module

Patches don't save names (see Patch IDs), so a rename never breaks one:

1. Rename the type everywhere it appears: `super(...)` and `registerModule(...)` in the module, its entries in `MODULE_CATEGORIES` and `MODULE_COLORS` in `js/ui.js`, the `mod.type` checks in `js/ui.js` and `js/main.js`, the import in `js/main.js`, the `type` field of any patches in `workflows/`, and this file. Rename the module and shader files to match with `git mv`, so history follows them.
2. Leave its `static uid` alone, and the ids of its params and ports.

Renaming a param or a port works the same way: change its name and every use of it, and keep its `id`.

## Exporting to node-gles3

`node tools/patch-to-gles3.mjs <patch.json> [out.js] [--gles3 <dir>] [--monitor <node id>]` writes a script for [node-gles3](https://github.com/worldmaking/node-gles3) that plays the patch with no node graph or UI. It runs fullscreen (Escape quits) and shows one Monitor's input in a final buffer of that Monitor's Width x Height, letterboxed to the screen. `--monitor` picks the Monitor; the default is the first one with a cable into it. The script finds node-gles3 in `$NODE_GLES3`, then beside itself, then at the folder `--gles3` named, which defaults to a `node-gles3` folder beside this repo or one of its parents.

The tool knows nothing about any module. It finds each node's source by its uid among the modules `js/main.js` imports, and bundles that file as it is now, with everything it imports, plus `graph.js`, `pipeline.js` and `moduleRegistry.js`, which load and run the patch as the app does. So the export always has the current behaviour of every module, and a module needs nothing extra to be exportable. Underneath is `lichenP5`, a subset of p5.js 1.9.4 written on node-gles3: WEBGL shaders, framebuffers (including float, half-float and antialiased ones), the framebuffer camera and matrix stack, `rect()`, `model()` and `p5.Geometry`, the shapes `beginShape()` makes, blend modes, `p5.Image` textures, P2D `createGraphics()` fills, shapes and images, and `createCapture(VIDEO)` through ffmpeg. It copies p5's behaviour down to what each draw leaves blending and samplers set to (see Set samplers again before every draw). It translates GLSL ES 1.00 shaders to GLSL 3.30, renaming any function or variable a shader declares with a name 3.30 reserves (Protozoa's `noise2`, for one).

The script is self-contained: module code, shaders, libraries and workers are all in it. A file a module fetches at runtime (a LUT preset, Latk's jellyfish, a font) is still read from this repo at the path the page would fetch it from, so linked assets stay where they are. The bundler handles:
- relative static imports, including minified ones
- `import()` of a literal path, or of a template such as `` `./dir/${name}.js` ``, which brings in every file the template could name
- `new Worker(new URL('rel', import.meta.url))`, which gets its own bundle and runs on a worker thread

A file with no import or export statement is a classic script and runs in the global scope, as a `<script>` would, with no `process` in sight, since Emscripten builds take that to mean Node.

The patch renders at the first Monitor's Buffer Width and Height (see Frame Size), and `lichenP5`'s `Graphics.resizeCanvas()` reallocates the framebuffers as p5's does. The pixel density is the shown Monitor's size over the frame size, the larger of the two ratios (2.25 for 1440x1080 over 640x480), so the final buffer's pixels are rendered ones. The app instead uses the display's `ceil(devicePixelRatio)`, so set `--density` to match it.

The script's flags:
- `--windowed`: a 960x720 window instead of fullscreen
- `--hidden`: no window at all
- `--frames <n>`: quit after `n` frames
- `--capture <png>`: save the last frame first
- `--dump <dir>`: save every framebuffer each node holds
- `--fixed <fps>`: the clock modules read moves exactly 1/fps a frame
- `--seed <n>`: `Math.random()` and `crypto.getRandomValues()` repeat
- `--density <d>`: render at density `d`

`--fixed` with `--seed` makes a render repeatable, which is how an export is checked against the app. Step the app the same way in headless Chrome, at a `device_scale_factor` equal to `--density`: stop p5's loop, replace `Math.random()` and `crypto.getRandomValues()` with the same seeded mulberry32 sequence, make `performance.now()` return a clock that starts at 0 when the patch loads, then add 1000/fps to it before each `pipeline.processFrame()`. Then diff the dumps. The six workflows with no Camera or worker matched within 8/255 on all but under 1% of pixels after 300 frames, and most modules match on every pixel. Expect differences only:
- in half-float buffers, which Chrome won't read back into a `Float32Array`
- in noise from a `sin()` hash, which differs between GPUs and grows through feedback
- in modules whose work arrives asynchronously (workers, fetched files), which a loop stepped in one task never lets in

What the runtime can't do, a module can't either. It logs why and stops, and the rest of the patch carries on:
- the ONNX modules (DepthAnything, Pix2Pix, InfrDrawings), whose runtime loads with a `<script>` tag
- a Camera with no ffmpeg (`$LICHEN_CAMERA` replaces ffmpeg's input arguments, and Windows needs it)
- sound, text, strokes, lights, and `createGraphics(WEBGL)`

A patch doesn't keep files picked in a module's panel, so Image, VideoPlayer, QTVR, VRML and NAPLPS show what they would in a freshly opened app before a file is picked.

## GRASS Module

The GRASS module (`js/modules/GRASSModule.js`) is a complete embedded GRASS interpreter — an emulation of the Datamax UV-1 / Sandin Image Processor's GRASS language (from the FakeGRASS project). It has no input ports, one video output, and one param, Speed: the lines a frame a running macro gets (see Running macros).

**Embedded source:** All FakeGRASS subsystems live in `js/modules/grass/` (flattened from FakeGRASS's `lang/`, `graphics/`, and `ui/` directories). No import path changes were needed since the relative structure is preserved.

**Session:** `js/modules/grass/session.js`'s `GrassSession` is the whole machine: screen, terminal, prompt, interpreter, scheduler and command queue, with no p5 or DOM. `GRASSModule` wraps it, keeps its parts under the old names (`mod.terminal`, `mod.env`, ...), and calls `session.frame()` from `process()`. So Node can drive it a frame at a time, as the tests below do.

**Rendering path:** The GRASS 2-bit framebuffer is converted to a `p5.Image` each frame via palette lookup (`_updateFBImage()`), then uploaded to the module's WebGL `outputFBO` as a texture via the passthrough shader. The terminal/REPL overlays are NOT in the video output — they are rendered directly on the main P2D canvas only when the module is fullscreened.

**The beam:** the UV-1's TV showed screen memory at whatever moment the beam passed, so a cursor drawn and then erased in XOR flickered on screen instead of vanishing (lesson 7's DRAW, and lesson 9's `DISP CURS,X,Y,1;DISP CURS,X,Y,1`). The picture shown is `framebuffer.shown`: screen memory as it stood after a random one of the frame's drawing commands, or at the frame's end, chosen from the count the last frame made (`beginFrame()`, `endFrame()`). A frame that draws nothing shows memory as it is, so a still picture is unchanged.

**Fullscreen behavior:**
- Double-click the node preview to enter fullscreen (same hit-test logic as Monitor)
- When fullscreened, all keyboard input is captured and routed to `mod.handleKey()` via `js/main.js keyPressed`
- Joystick 1 is the keyboard and mouse (`updateJoystick()`, called by `NodeGraphUI` each fullscreen frame). The arrow keys push the stick (`$X1`, `$Y1`: −1, 0 or 1), the mouse button is the trigger (`$T1`), and the mouse's position across the screen is the knob (`$K1`: −128 at the left edge to 127 at the right). Out of fullscreen the stick is let go and the knob stays where it was. While a macro runs, the arrow keys only push the stick
- ESC exits fullscreen, and running macros carry on, so the node's output keeps moving in the patch (the Stop button stops them); inside the GRASS EDIT macro editor ESC saves the macro and stays. A macro waiting for INPUT still waits; go back to fullscreen to answer. CTRL+C stops every macro, `.B` and `.F` too, for good, and drops queued commands
- Terminal + REPL overlays render over the video in fullscreen mode
- Clicking is the trigger, so it doesn't exit fullscreen (ESC does)

**Play and Stop:** buttons on the node (`GrassSession.stop()`, `play()`). Stop breaks, as ESC did: the running macro stops and the prompt is free again, prints `[BREAK]`, and queued commands carry on. It stops `.B` and `.F` macros too, so lesson 11's clock stops. Every stopped macro keeps its place (its line, frame of locals and arguments, a WAIT under way), and Play puts them back where they were, printing `[PLAY]` and their names; a middleground one goes after any started meanwhile. A macro waiting for INPUT asks again. Play is dim with nothing stopped, Stop with nothing running. Load, Reset and CTRL+C forget what was stopped.

**Running macros:** commands typed at the prompt and commands from a loaded script join one queue (`session.queue`), and each frame starts queued commands until one holds it. `Interpreter.execTopLevel()` runs each: a line that is just a macro's name, with any arguments (`DRAW`, `GRIDBOXES 30`), starts that macro in the middleground, and anything else runs there and then. A middleground macro:
- runs the Speed param's lines a frame (default 8), so its loops read the joystick as it moves and its drawing shows as it happens
- holds the queue, and the prompt shows no `>`, until it ends or is stopped, as the UV-1 held the attention mark. Lines typed meanwhile run after it, and a script carries on after it
- suspends `.B` macros until it ends (lesson 11). These share the same number of lines a frame between them, one line each in turn
- waits at `INPUT` for a typed answer when no arguments are left. The values go in separated by commas (lesson 8's `0,50,0,0,4`), fill the variables in order and are all set at once; with too few, the next is asked for. `INPUT.STR` takes the line whole. The answer goes after the macro's PROMPT text, which stays open on its line as PROMPT leaves it (`Terminal.atLineStart`)

A macro called any other way (inside an expression, or from another macro) still runs inline as one line of its caller, capped at 100000 lines, and an INPUT there gets 0. Each scheduled macro has its own frame for locals, arguments and ONERROR (`mib`), which a `.B` macro keeps between passes. `WAIT n` stops a macro's lines for n frames. An error stops only the macro it is in, and is reported with the macro's name and, from a script, its line. Setting `$HR`, `$MN` or `$SC` sets the clock, which keeps time from there (lesson 7's CLOCK).

**js/ui.js integration:** `getModuleHeight` and `_drawModule` treat GRASS like Monitor (large preview, `MONITOR_PREVIEW_W × MONITOR_PREVIEW_H`), plus two rows under the preview: the Load and Save buttons, then Play, Stop and Reset (`_grassButtons()` lays them out for drawing and `hitTestGrassScriptBtn()`). `hitTestMonitorDblClick` checks for both `'Monitor'` and `'GRASS'` types.

**Scripts:** a `.grass` file is plain text, what you would type at the prompt, one command per line. A line whose first character is a period is a comment, as in a macro (lesson 8), and is skipped; a quote or bracket in it means nothing. `js/modules/grass/script.js` holds what reads and writes them.

`files/grass/` holds the eleven lessons of the 1981 Datamax UV-1 Zgrass manual (`ref/markdown/`) as demos. Each starts with `$L1=29`, so color 1 shows teal, not the default red. Each keeps its lesson's code, with comments, and ends by running a looping animation built from what the lesson teaches, which holds the prompt until the Stop button. Lesson 11's runs as `.B` and `.F` macros instead, leaving the prompt free; Stop stops it too. Lines that can only fail here (tape, disk, `TXT`, `NB`), the lessons' deliberate mistakes and typos, and anything that would wait for typing are comments instead, or are rewritten (lesson 3 defines TEST instead of opening EDIT; lesson 8's ENDPOINT and PYRDATA take ENTER's typed data as arguments). The animations draw so that any moment of a frame looks right, because the TV shows memory mid-frame (see The beam): a plain loop of boxes or lines (1 CONFETTI, 2 TUNNEL, 4 RADAR), the new place before the old one is wiped (3 SCANNER, 10 SCOPE), XOR drawing that is taken off by drawing it again (5 TAPE, 6 TIMES, 8 SPIN, 11 HANDS and ORBIT), one DISPLAY of a snap with a black border (9 BOUNCE), or only the colors changing (7 MARQUEE).

Scripts are read and written as follows:
- **Load** (`GRASSModule.pickScript()`, `loadScript()`, `GrassSession.load()`): `splitScript()` splits the file into commands. A `[]` or `{}` string runs on over lines, as a macro does, and a quote ends with its line, so a stray one can't swallow the rest of the file. The commands are queued and run in order, as if typed (see Running macros), each echoed with a `+` before its later lines as the UV-1 showed. A script that runs a macro waits for it, so lesson 4 stops at MANYSINES for its three values, and lesson 8's old CZROT rotated until stopped. An error is printed with its line in the file and the rest still runs. The button resets the module first (see Reset), once a file is picked, so a script always starts on a clear screen and an empty workspace; `loadScript()` on its own adds to what is there, as GETTAPE did.
- **Save** (`saveScript()`): `serializeWorkspace()` writes every global as `NAME=[...]` or `NAME=value`, and every array as `ARRAY` plus its non-zero elements, so Loading the file defines them all again. A string goes in `[]`, else `{}`, else quotes, whichever reads back unchanged. Only a string none of them fits is left out, and reported.
- **Reset** (`reset()`): stops every macro and replaces the session with a new one, so the screen, terminal, prompt history, workspace (macros, variables, arrays, snaps), palette and clock are as a newly added node's. Checked in headless Chrome against a new node, field by field. The Speed knob is a patch setting and stays where it is.
- A patch doesn't save the workspace.

**Dialect:** the interpreter follows the lessons' Zgrass:
- `=` assigns, inside any expression (`PRINT A=10%100`, `BOX X=X+20,0,18,18,3`, `IF (N=N+1)<10`), and `==` tests equality. A `=` after something that can't be assigned to is equality. FakeGRASS's `:` still assigns.
- Whitespace matters where it did on the UV-1. A command, a space and a minus with none after it start an argument (`SKIP -4`, `LINE -X,-Y,1`), and `SKIP-4` is a subtraction. A command name, a space and an argument inside an expression nest a call (`PRINT PRINT 10`, `P P 10`). Tokens carry `spaceBefore` for this.
- Arguments may be in parentheses (`PRINT(10,20,30)`). `%` returns fractions. A name may hold `$` after its first letter.
- BOX and SNAP take whole sizes, `BOX XCENTER,YCENTER,XSIZE,YSIZE` as lesson 1 has it (FakeGRASS took half-sizes), so lesson 7's `BOX X,Y,1,20,5` is a 1-pixel-wide line. `Framebuffer.rect()` places the area as DISPLAY places a snap, so a SNAP and a DISPLAY at one spot line up.
- `$HB` counts 8-pixel columns, 0–40 (default 40, all left colors), as lesson 7's "set $HB to 20 and the screen shows the right half colors".
- Abbreviations: an ambiguous command prefix resolves to the match with the shortest minimum length, so `P` and `PR` are PRINT (POINT now needs `POI`). A name that is neither a command nor defined runs the one macro, or reads the one array, it is a prefix of (`Q`, `PY(L)`).
- A macro used as a function (`SQUAREM(?a,?b)`) returns its RETURN value. `INPUT` can fill an array element. `ONERROR label` branches once on an error. `COMPILE a,b` copies macro `a` to `b`. `TIMEOUT n` runs its `.F` macro every `n` frames. A macro called from a `.B` or `.F` task keeps its own GOTOs and SKIPs, and macro lines keep blank lines and quoted strings that run over several lines (`splitMacroLines()`), so SKIP counts them as Zgrass did.
- DISPLAY's displaymodes 0–3 are plop, XOR, OR and AND, as in lesson 9, so two DISPLAYMODE 1s draw and erase. 4 and up keep FakeGRASS's colormode encoding (4, 8 and 12 are XOR, OR and AND).

Checked in Node against all eleven lessons, and in headless Chrome through the buttons, the keyboard and the mouse. All 172 commands in the lesson files run. Each lesson, loaded with the Load button in headless Chrome one after another in one node, animates in the node's preview with no errors, and each Load clears the last lesson's macros, arrays and `.B`/`.F` macros. Stepped in Node, the XOR animations leave nothing behind after a minute. A workspace saved from six of the original lessons (62 names, 4 arrays) loads back identical. Stepped a frame at a time, every macro of lessons 7 and 9 runs as the lessons describe: RANGE prints the trigger, the three DRAWs and COLORS, CHOOSY, STEST and JANEDRAW follow the stick, trigger and knob, CLOCK and JANEDRAW wait for and take typed answers, CBARS and BEHIND draw over frames and end, and both XOR cursors show in some frames and never in all. What still fails is the hardware the lessons assume:
- tape and disk (`PUTTAPE`, `GETTAPE`, `D...`), the `TXT` swap module, and the system macro `NB`
- the UV-1's colours: the palette is LICHEN's, so `$L0`–`$R3` values and the default colours don't match the lessons' (white, red, green, blue; "127 is yellow")
- `PRINT` shows a fraction to the double's full precision (`100/3` prints `33.333333333333336`)

## NAPLPS Module

The NAPLPS module (`js/modules/NAPLPSModule.js`) decodes North American Presentation Level Protocol Syntax (.nap) files containing vector graphics instructions.

**Decoding:** Relies on the external `js/modules/naplps/naplps.js` decoder logic. It accepts file drops through a hidden HTML file input, creating draw commands progressively with a configurable playback speed.
**Rendering path:** Commands are executed into a 2D `p5.Graphics` buffer using p5 drawing commands (`pg.rect`, `pg.vertex`, etc.), tracking color and progressive drawing state, which is then mapped to the module's WebGL `outputFBO` via the passthrough shader.

**Params.** Speed sets how fast each command's points are revealed. Loop Hz (1–100, default 5) is the loops a second on X and Y, as Latk's: a lower rate gives the drawing more samples.

**X and Y.** Like Latk, NAPLPS has X and Y control outputs, which carry what it draws each frame as one loop of XY audio to drive Twoscilloscope (see Latk Module). As each command is drawn, its outline goes into the loop in the command's colour:
- **Polygons, lines and points:** the points revealed so far, closed back to the first, as they are drawn.
- **Rectangles:** their four sides.
- **Arcs:** the full circle, in 72 sides, since the module draws every arc as a circle. The box runs down and to the right of the first point whatever the sign of its size, as p5 draws it.
- **Filled shapes:** the beam can't fill, so they are traced as outlines.
- **Left out:** text, and anything with no length (a single point), which a canvas doesn't stroke either.

Outlines are cut at the canvas edge, as Latk's strokes are. `images/test.nap` is 1,595 filled polygons, which give 1,566 outlines once those with no length are left out. All of them fit in a loop at the default 5 Hz. A busier file loses its shortest outlines first (see Latk's X and Y). Before a file loads, the loop is all blank, so the beam rests unlit in the middle. Adding the outputs left the video unchanged: in headless Chrome, `test.nap` plays back on every pixel as it did before, at three points in its reveal. Twoscilloscope's Original Lines, fed from X and Y, lay over the video's polygons, rectangles and arcs in `test.nap` and in TEIA_TELIDON_ETC's `beer.nap`, `email2.nap` and `memra2.nap`.

## QTVR and VRML Modules

Two Formats sources ported from the p5.js viewers in the vrml-qtvr-viewer project (`p5js/js/qtvr-viewer-p5.js` and `vrml-viewer-p5.js`). Each loads a file with the same hidden `<input type="file">` pattern as Image and NAPLPS, and the node's button shows the loaded file's name. As with Image, the file itself is not saved in patches.

**QTVR** (`js/modules/QTVRModule.js`) views a panorama image from its center. It loads extracted panorama images, not QuickTime `.mov` files. The `projection` drop-down picks how the image is mapped, as the viewer's `mode` did:

| projection | Label | Mapping |
| --- | --- | --- |
| 0 | Equirectangular | Inside of a `sphere()` |
| 1 | Cubemap | Six textured quads, cut with `p5.Image.get()` from a horizontal strip of square faces in px, nx, py, ny, pz, nz order |
| 2 (default) | Cylindrical | Inside of an open `cylinder()` whose circumference spans the image's width |

Loading a file sets `projection` from its shape: 2:1 is equirectangular, 6:1 a cubemap, and anything else a cylindrical strip. `yaw` and `pitch` (degrees) aim the view, `fov` sets the vertical field of view, and `spin` turns the view in degrees per second. Spin builds up an angle inside the module and is added to the Yaw knob, so the knob itself doesn't move. The viewer used a 90° FOV for cubemaps and 75° otherwise; here the one `fov` knob defaults to 75. An image bigger than `MAX_TEXTURE_SIZE` is shrunk to fit on load.

**VRML** (`js/modules/VRMLModule.js`, `js/modules/vrml/`) orbits a VRML97 world. `vrml/VRMLLoader.js` is the viewer's loader, copied unchanged apart from its chevrotain import, which now points at `js/libraries/chevrotain.module.min.js` instead of an import map. The loader bakes the scene into a few vertex-colored `p5.Geometry` objects. `vrml/preprocessVRML.js` holds the viewer's `preprocessVRML()`, copied unchanged, and `decodeVRML()`. The viewer inflated gzipped files (magic bytes `0x1f 0x8b`, which most of its sample `.wrl` files are) with pako. `decodeVRML()` uses the browser's `DecompressionStream` instead, so LICHEN needs no pako. The world is fitted to 50 units round the origin, as in the viewer. It is drawn with y flipped (VRML is y-up) and lit with the viewer's ambient and directional lights, over the file's uniform `Background` colour or black. `yaw` and `pitch` place the camera round the origin, `distance` sets its range (1–200, default 80, matching the viewer's camera and zoom limits), and `spin` works as in QTVR. A file the loader rejects raises an alert and keeps the previous world. The loader's own limits still apply: no textures, lines, points, `ElevationGrid`, `Extrusion`, `Text` or `Inline`, and `PROTO` geometry is stripped.

**Rendering.** Both modules draw 3D with p5's own camera and shaders, straight into `outputFBO`. `Framebuffer.begin()` pushes the renderer state and switches to the framebuffer's own camera, so `perspective()`, `camera()`, the lights, `texture()` and the bound shader all go back to their previous values at `end()`. Each module still calls `resetShader()`, `noLights()` and `noStroke()` after `begin()`, so nothing left bound by another module (or the UI's blit shader) leaks in. `textureMode` is not part of p5's saved state, so the cubemap puts it back after drawing. Both output buffers are created with `{ antialias: true }`, unlike the 2D modules' buffers. Measured in headless Chrome at 640×480, fullscreen output matches the viewer pages pixel for pixel in all three projections. The nettle world differs on under 0.6% of pixels, nearly all along model edges, where only LICHEN's buffer is antialiased.

**Freeing GPU memory.** p5 keeps the GPU copy of every image and geometry it has drawn. On a new load and on `dispose()`, QTVR deletes the textures of its old image and cube faces from the renderer's `textures` map, and VRML calls `freeGeometry()` on its old geometries.

**Fullscreen interaction.** Double-click the node preview to enter fullscreen. Dragging turns the view by moving the Yaw and Pitch knobs, eased the way each viewer was. QTVR uses the three.js OrbitControls settings (a drag across the canvas height turns 90°, and the panorama follows the pointer). VRML uses p5's `orbitControl()` damping (a drag across the short side adds 0.6 rad of velocity, which decays by 0.85 a frame). The wheel zooms: it changes QTVR's `fov` and VRML's `distance`. ESC exits. `js/ui.js` routes press, drag, release and wheel to the module's `handleMouse*`/`handleWheel` methods for both types, as it does for Conway and Yellowtail. A cable on Yaw or Pitch overrides the drag.

## Panorama Module

The Panorama module (`js/modules/PanoramaModule.js`, `js/shaders/panorama.js`) views its video input as a panorama from the centre, as QTVR views a file. It has two inputs, `in` and `d` (see Depth), and one output. The `projection` drop-down picks how the input is mapped:

| projection | Label | Input | Shader |
| --- | --- | --- | --- |
| 0 (default) | Equirectangular | 2:1, longitude across and latitude down | `panoramaEquirectFrag` |
| 1 | Cubemap | A horizontal strip of six square faces, px, nx, py, ny, pz, nz | `panoramaCubemapFrag` |

Yaw, Pitch, FOV and Spin are QTVR's: Yaw and Pitch (degrees) aim the view, FOV (20–120, default 75) is the vertical field of view, and Spin turns the view in degrees a second, added to Yaw without moving the knob.

**Rendering.** Each projection is a fragment shader of its own, one pass over the output. Each pixel casts the ray QTVR's `camera()` and `perspective()` would give it and reads the input where the ray meets the sphere or cube. The input is read by uv, so its size doesn't matter. Sources output at the frame's size, so the panorama is stretched to the frame and mapped back from there. Its detail is the frame's, though: raise the Monitor's Buffer Width and Height for more. To feed a panorama file through Image, set Image's Width and Height to the frame's, so the whole picture fills it.
- **Equirectangular:** inverts QTVR's sphere: p5's `sphere()` uv, mirrored in x and turned a quarter about y. Each read takes the two columns either side and blends them itself, so the left and right edges join across the seam instead of each clamping.
- **Cubemap:** picks the face by the ray's largest axis, and the place on it from the corners that QTVR's `SKYBOX_FACES` gives each tile. A read is held half a texel inside its tile, so a face's edge doesn't blend in the next face of the strip.

**Depth.** With `d` cabled, the panorama is drawn as a cloud of points instead, ported from the three.js viewer in `KINECT/threejs_depth_eqr`. `d` is a depth map in the same projection as `in`, and each point sits on a ray from the centre, at the distance `d` gives there, coloured by `in`. Seen from the centre, every point lands on the pixel whose ray reads the same place, so the picture is the ray-cast one. Moved off the centre, near points shift against far ones. `d` uncabled draws exactly as before.
- **Points:** Equirectangular has the viewer's sphere of 512 × 256 segments, a point at the middle of each, placed by the inverse of `panoramaEquirectFrag`'s mapping. Cubemap has 148 × 148 points on each face, 131,424 in all, about as many as the sphere's 131,072. Their place on the face comes from the same corners as `panoramaCubemapFrag`, and each read is held half a texel inside its face in the same way. The two are separate programs from one source, `panoramaDepthVert(cubemap)`, and each projection's points are built the first time it is drawn, which took about 160 ms in Chrome on an M2 Max.
- **Distance:** the viewer's `getDepthSpherical()` with the constants it ran with (baseline 180, angle 3.143, Maximum 30): `Depth × min(K / asin(d), 30)`, `K = −asin(180 sin 3.143) ≈ 0.256`. It reads `d`'s red channel, as the viewer did. Brighter is nearer, as DepthAnything's Grey is. `d` = 0 goes to Maximum. Depth (0–100, default 20) is the viewer's Displacement, so it scales the whole cloud, and so changes nothing seen from the centre.
- **Drawing:** each point is a square of Point Size logical px (1–30, default 4), drawn as a quad of four vertices at the point's centre. Each vertex's normal says which corner it is, and the shader moves it there in clip space, so the square keeps its size at any distance, as the viewer's `gl_PointSize` did. The viewer's were 15 device px. The default of 4 is about the grid's spacing at 640×480 and FOV 75, so neighbouring points just meet. The points take the viewer's saturation of 1.5 and its alpha of 0.3 (Opacity, 0–1), and are blended over black with depth testing, as three.js draws a transparent material. So the output has a depth buffer, though no MSAA. The ray-cast quad passes the depth test wherever it draws.
- **Viewpoint:** X, Y and Z (−20 to 20) place it in the viewer's world units: +X right, +Y up and −Z ahead at Yaw 0. A point with `d` = 1 is about 3.3 units away at Depth 20, and one with `d` = 0.5 about 9.8.

**Fullscreen interaction.** As QTVR's: double-click the node preview to enter fullscreen, drag to turn the view by turning the Yaw and Pitch knobs (the panorama follows the pointer, eased in at 5% a frame), and turn the wheel to zoom by turning FOV. ESC exits. `js/ui.js` routes press, drag, release and wheel to the module's `handleMouse*`/`handleWheel` methods. A cable on Yaw or Pitch overrides the drag. The viewer's WASD moves the viewpoint by turning X, Y and Z. W and S move along the view, A and D across it, and E and Q up and down the screen. As in the viewer, the speed builds by 0.002 units a frame while a key is held, up to 0.04, counted in 60ths of a second so it is the same at any frame rate. `js/main.js` routes key presses to `handleKey()` and releases to `handleKeyUp()`. ESC and the window losing focus let go of every key, since a key released elsewhere never comes up here.

**Checked** in headless Chrome on an M2 Max, at pixel density 1 and 2. QTVR was given a p5.Image of the same pixels as Panorama's input, a 1024×512 grid for Equirectangular and a 1536×256 strip for Cubemap, and both were set to six views, from straight ahead to near each pole and across the equirectangular seam. In every view Panorama matched QTVR to a mean of under 0.5 levels, with 98.7% of pixels or more within 8 levels. What differs is QTVR's sphere facets near the poles, its antialiased cube edges, and the seam, where QTVR clamps. The same drags and wheel through `NodeGraphUI`'s mouse methods left both modules' Yaw, Pitch and FOV equal. A patch saves and loads again as the same JSON, and a patch of Oscillator, Panorama and Monitor exported with `tools/patch-to-gles3.mjs` runs.

**Depth checked** in headless Chrome on an M2 Max, at pixel density 1 and 2, in five views from straight ahead to near each pole and across the seam:
- **`d` uncabled:** the output matches HEAD's module on every byte, in both projections.
- **From the centre:** with a constant `d`, Opacity 1 and an input whose colour follows the direction each texel stands for, every lit pixel of the cloud matches the ray-cast picture through the points' saturation. Equirectangular is within 3 levels at Point Sizes 1 and 3. So is Cubemap, except for under 0.6% of lit pixels, all within 1.5° of a cube edge, where a square point covers pixels whose rays meet the next face.
- **Off the centre:** near squares over a far background shift against it, and leave holes where nothing was behind them.
- **Keys:** W held for a second at Yaw 0 moved Z by −2.02, E moved Y up, nothing moved once they were let go, and W at Yaw 90 moved X. A patch with `d` cabled saves and loads again as the same JSON.
- **Cost:** under 1 ms a frame for either projection at density 2, at Point Size 4 or 15, measured by throughput.

A patch with `d` cabled, exported with `tools/patch-to-gles3.mjs`, runs and draws the cloud.

## Camera Module

The Camera module (`js/modules/CameraModule.js`) is a source that outputs a webcam through p5's `createCapture()`. Three drop-downs choose what it asks `getUserMedia` for:

| Param | Label | Options |
| --- | --- | --- |
| `device` | Device | Default, then each video input `enumerateDevices()` lists, by name |
| `resolution` | Resolution | Default, then standard sizes from 160×120 to 3840×2160 that fit the device's range |
| `fps` | Frame Rate | Default, then 5, 10, 15, 24, 25, 30, 50, 60, 90, 120 and 240 fps where they fit the device's range |

**Default.** With all three at Default, Camera asks for `{ video: true }`, as it did before the menus, so a new node and a patch saved before them behave as they always did. A camera's default is usually 640×480.

**Options.** A browser can list a camera's devices but not its modes. It gives only the range of each setting, through `track.getCapabilities()`. So Resolution and Frame Rate offer fixed lists, cut to that range once the capture is open, and are reread when the device changes. Chrome scales and crops to any size inside the range and drops frames to any lower rate, so an option it lists is delivered as asked. Where `getCapabilities` is missing, the lists aren't cut. The browser gives names and ids only once the camera is allowed, so until then Device offers Default alone. A `devicechange` listener lists the devices again when one is plugged in or out.

**Asking.** A size and rate are sent as `ideal`, so the browser gives the nearest it can. A device is sent as `exact` when it is listed and `ideal` when it isn't, so a missing camera falls back to another instead of failing. Every change closes the capture and opens a new one, since a running track can't change device. The output holds its last frame until the new stream is ready. A capture replaced before it is ready stops its stream when that arrives, so the camera doesn't stay on.

**Patches.** The options differ from machine to machine, so a menu's index means nothing on its own. `saveState()` saves what was chosen: the device's id and name, the size as `[w, h]` and the rate, with `null` for Default, or no state at all when all three are Default. `loadState()` points the menus at them again, and the capture opens after the task that built the node, so it opens once, with the saved choices:
- **A device:** matched by id, then by name, since ids differ between machines and browser profiles. One that isn't there shows as "*name* (not found)", and the stream comes from another camera until it is plugged in.
- **A size or rate outside the device's range:** added to the menu as it was saved, and the browser gives the nearest.

**Mirror.** A fourth drop-down, Mirror (Off, the default, or On), flips the output left to right, as a selfie view shows a camera. It asks the browser for nothing, so changing it doesn't reopen the capture. Its options are the same on every machine, so it is a plain param, saved by index, not part of the state. A patch saved before it loads Off, as it ran. On draws through `passthroughMirrorFrag`, a program of its own beside the passthrough, so Off draws exactly as before. A uniform-driven select in a shared shader can change how Chrome's compiler rounds it, and RuttEtra's output moved by a few pixels when one was added. Checked in headless Chrome with its fake camera, on one paused frame, at pixel density 1 and 2. Off matched HEAD's Camera on every value, and On matched Off flipped on every value. A Constant cabled to Mirror gave On at 0.7 and Off at 0.3, and a patch saved with On reloaded On.

**Downstream.** The stream's resolution is only what is uploaded. As with any source, the output is the frame's size (see Frame Size), and the picture is stretched to fill it by bilinear sampling, with no averaging, so a stream much larger than the frame aliases. In the node-gles3 export, the camera is ffmpeg at the frame's size, and the menus do nothing there.

Checked in headless Chrome with its fake camera: the menus listed the device and cut Frame Rate to its 20 fps limit; 1280×720 and 15 fps gave a track of exactly that, while the output stayed 640×480; a patch saved with all three reloaded and asked once, with the same constraints. A foreign patch showed its missing device as not found and got 3840×2160 for a saved 7680×4320. A saved name with another id matched the local device. Duplicating copied the choices, setting all three back to Default saved no state, `tunnel_camera.json` asked for `{ video: true }`, and three reopens in a row left one live stream.

## Image Module

The Image module (`js/modules/ImageModule.js`) is a source that loads a still image file and outputs it as video.

**File loading:** Uses the same hidden `<input type="file">` pattern as NAPLPS and VideoPlayer, accepting any image format the browser supports (`accept="image/*"`). The node's "Load Image…" button triggers the picker via `pickFile()`. On load, `p5.loadImage()` decodes the file into a `p5.Image` stored as `this.img`.

**Parameters:** `width` and `height` are set to the image's native pixel dimensions on load. The user can then adjust them via the knobs; `process()` redraws the image into the `p5.Graphics` buffer at the current param dimensions, centered on a black background, every frame.

**Rendering path:** The 2D `p5.Graphics` buffer is mapped to the module's WebGL `outputFBO` via the passthrough shader, identical to Camera and VideoPlayer.

## Mesh Module

The Mesh module (`js/modules/MeshModule.js`, `js/modules/mesh/readGLTF.js`, `js/shaders/mesh.js`) is a Source. It loads a glTF 2.0 model, Draco-compressed or not, and draws it through an orbiting camera. The node starts with `elephant_draco.glb`, bundled in `files/mesh/` from node-gles3's `meshes/`. "Load .glb…" picks another, and the button then shows its name. A `.gltf` that names its buffers and images as separate files is picked together with them; the picker takes several files. As with Latk, the file itself is not saved in patches.

**Reading.** `readGLTF()` follows node-gles3's `glutils.geomFromGLTF()`, which `example-gltfdracoload.js` uses, but reads every triangle primitive of every mesh the scene reaches, not just the first. It puts each through its node's transform, and its normals through the inverse transpose, so the whole model is in one space; a skinned mesh skips its node's transform, and is drawn in its bind pose. Strips and fans become triangle lists, and a primitive with no normals gets smooth ones from its faces. Only positions, normals, `COLOR_0`, `TEXCOORD_0` and the material's base colour factor and texture are read. Points, lines, skins, morph targets, animation and the rest of the material are ignored.

**Draco.** A primitive with `KHR_draco_mesh_compression` is decoded by Google's Draco decoder, `js/libraries/draco/draco_wasm_wrapper.js` and `draco_decoder.wasm`, copied from node-gles3's `lib/draco/`. As in three.js's DRACOLoader, each attribute is decoded as its accessor's component type and normalized if the accessor says so. The wrapper is imported the first time a Draco file is read, and the wasm then compiled asynchronously, since Chrome won't compile wasm over 4 KB synchronously on the main thread, as node-gles3 does. The wrapper is a classic script, edited in two places so it also works imported as an ES module: `$jscomp.getGlobal(this)` falls back to `globalThis`, where an ES module's `this` is undefined, and a last line puts `DracoDecoderModule` on the global scope. The decoder module has a `then()` of its own, which calls back with the module, so a promise resolved with it never settles; `loadDraco()` resolves with `{ draco }` instead.

**Params.**

| Param | Label | Range | Default | Sets |
| --- | --- | --- | --- | --- |
| `yaw` | Yaw | −180–180° | 0 | The camera's orbit |
| `pitch` | Pitch | −89–89° | 8.6 | Latk's home pitch |
| `distance` | Distance | 0.05–50 | 2.1 | Camera distance in radii of the model's bounding box, as in Latk |
| `spin` | Spin | −90–90°/s | 0 | Turns the view, added to Yaw, as in Latk |
| `light` | Light | 0–1 | 1 | 0 draws the colours unlit, 1 fully lit |

**Rendering.** The camera is Latk's `OrbitCamera`, fitted to the model's bounding box. Each primitive is a `p5.Geometry` drawn with `model()` through `meshVert`/`meshFrag`, which take the camera's matrix as `uMVP` rather than p5's matrices, and flip clip y for the framebuffer's orientation. Every vertex gets a colour and a uv, white and 0 where the file has none. The colour is the vertex colour times the base colour factor times the texture, which is bound before each draw, with a 1×1 white framebuffer standing in for a primitive with none (see Set every sampler). glTF colours are linear, so they are multiplied in linear light and encoded to sRGB, the texture being decoded first. Faces are double-sided, lit by one light over the camera's left shoulder with an ambient of 0.2. The texture repeats, as glTF's default sampler does, through `fract()`.

**Fullscreen interaction.** As in Latk: double-click the node preview to enter fullscreen, drag to orbit by turning the Yaw and Pitch knobs, turn the wheel to zoom by turning Distance, and double-click to go back to the home view. ESC exits.

Checked in headless Chrome on an M2 Max at pixel density 1 and 2, with `elephant_draco.glb`, `elephant.glb`, `grasshopper_draco.glb`, `rigging06.glb` and `rigging06_draco.glb` (a textured, skinned mesh). The two elephants differ on under 0.01% of pixels, along edges, from Draco's quantization. A patch of Mesh into Monitor exported with `tools/patch-to-gles3.mjs` draws the Draco elephant.

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

**X and Y.** Two control input pins drive a pen that draws as the mouse does, live cells with the mouse's radius of one Cell Size. They take 0..1 values, with Y up, as Latk's X and Y outputs give them, so a beam's place on the canvas is the pen's: `x × width` across and `(1 − y) × height` down.
- **Pen down:** while either pin is cabled, the pen draws every frame, a line from where it was last frame to where it is now, as a drag does. The frame it goes down it draws a dot. A pin with nothing cabled in stays at 0.5, the centre.
- **Pen up:** with both unplugged, or a value that isn't finite, the pen lifts, and the next line starts afresh.
- **Values only:** like Calculator's pins, they read a source's value, not its loop. Latk's X and Y draw where the beam is each frame, which jumps around the drawing.
- **One pass:** the simulation shader's spawn is a segment (`u_spawnPos` to `u_spawnEnd`), so each frame's line is one pass. The mouse still spawns dots, with the two ends the same, which reduces to the old circle exactly.
- **Doesn't step the board:** every mouse spawn's pass also steps the board a generation, even while paused. The pen's pass sets `u_evolve` to 0, which keeps every cell but those it draws, so the board steps only as Running and Speed say.

Checked in headless Chrome on a virtual clock: a drag and a right-click pattern on a running board give the same output as HEAD's module on every pixel. Constants of 0.25 and 0.75 put a dot centred at (160, 120) on 640 × 480. On a paused random board, ten frames of the pen changed only cells under it. Two Oscillators, 1 Hz on X and 2 Hz on Y, drew a figure of eight in one unbroken line.

## Protozoa Module

The Protozoa module (`js/modules/ProtozoaModule.js`, `js/shaders/protozoa.js`) is a source: a watercolour pigment field, carried on a slow liquid current, suspended in a scene of snakes in a swamp. The output is graded like a medical image: one tinted grey channel with two complementary colour accents.

**Simulation.** The field lives in a pair of half-float framebuffers (`state`) pinned at 340 texels on the short axis, whatever the output size (`PROTO_SIM_SHORT`). Each frame runs four passes round the persistent chain, so the live field lands back in `state[0]` without a swap:

| Pass | Shader | What it does |
| --- | --- | --- |
| 1. advect + inject | `protozoaInjectFrag` | Carries the field on the current and the snakes' wakes, then adds the colony blobs |
| 2. diffuse | `protozoaDiffuseFrag` | Laplacian spread |
| 3. bleed | `protozoaBleedFrag` | Spread along a static paper-fibre texture, plus drying loss |
| 4. feedback | `protozoaFeedbackFrag` | Ripple displacement across intensity gradients, decaying toward the wash colour |

Outside the chain, `protozoaBandingFrag` adds a slowly drifting vein-like network of channel separation, `protozoaDisplayFrag` tone-maps it with a soft temporal trail, two `protozoaMeanFrag` passes reduce its pigment density to one mean for the auto-exposure, and `protozoaSceneFrag` composes the swamp, the snakes and the field into `outputFBO`.

**The current.** The advect pass moves the field along the curl of a slowly evolving noise potential, so the flow is divergence-free: pigment swirls and shears but never piles up or thins out. The potential fades to zero at the frame border, which turns the current along the edges instead of dragging in the clamped edge texels. Every segment of the two 2D snakes adds a wake: the curl of a local stream function whose flow at the segment's centre is the segment's own motion this frame (times `WAKE`), turning back round its sides. The field is read with a Catmull-Rom filter clamped to its four nearest texels, because a bilinear read blurs a little on every frame it moves, which over a pigment's lifetime would quadruple the diffusion. `flow` scales both the current and the wakes. The current runs on scene seconds, so Speed sets the pace of the water too.

**Smooth motion.** Several terms used to change abruptly from frame to frame, and together they made the frame-to-frame change look like noise. Measured as mean |second difference| over mean |first difference| of luma at 60 fps, the ratio went from 1.69 (white noise is about 1.7) to 0.72:
- The film grain was redrawn every frame and added before the gamma lift, so in the shadows it was most of the change in the whole image. It is now a fixed one-level dither at the end.
- The swamp's gas bubbles were hashed straight on the clock, which moved them every frame. Their `smoothstep()` also swapped its edges whenever the pulse crossed 0.5, which is undefined in GLSL; in practice it dropped the waterline by 0.1 per bubble about once a second. They now rise, swell in and out over their own lifetime, and respawn only while invisible. The waterline keeps the old average drop of 0.15, so the snakes keep their size.
- The 3D value noise behind the swamp gas, and the 2D noise in the bleed and banding passes, had wrong corner offsets, so neighbouring cells disagreed at their faces. The gas showed seams sliding across the frame, and popped whenever its z crossed an integer.
- The feedback ripple took `normalize()` of a near-zero gradient in flat areas, which gave them a direction set by rounding noise plus a fixed diagonal drift. It now soft-normalises, fading the displacement out where the field is flat.

**Grade.** At the end of the scene pass the whole image collapses to luminance, is levelled out to a scan's contrast (`GREY_LO`/`GREY_HI`), and is tinted faintly (`GREY_TINT`) a quarter-turn round the wheel from the accents, so the tint leans toward neither. The colonies come back on top like a two-channel fluorescence overlay: cool pigment (algae, teal, duckweed) in `hue`, warm pigment (ochre, rust) in its complement. Where the two mix they cancel back toward grey, so only clear colonies carry colour, and accents never cover the snakes. `hue` turns the accent pair and the grey's tint together. The banding pass's old `sin(50x) * sin(50y)` lattice showed as a regular grid of dots under this grade, which is why it is now a vein network.

**Seed:** works as Crystalline's does (see Seeded Randomization). A new node starts from its own seed, and the Seed trigger draws a new one. All eleven params are seeded: `hue` over its full range, and the rest over narrower ranges. These avoid a frozen clock at speed 0, an empty field at deposit 0, and feedback toward 0.9, where the trails fade as fast as they are laid. The colony paths are fixed, so a seed changes how the pigment behaves and what colours it takes, not where the colonies swim.

## InkDrops Module

The InkDrops module (`js/modules/InkDropsModule.js`, `js/shaders/inkdrops.js`) is a generative module: a sheet of cold-press paper worked in watercolour. Splashes bloom and shatter, fat drops fall in from off-screen and soak out huge, and a wet rag is dragged across the sheet, lifting pigment back off. Ported from the WebGL2 sketch `splottissimo.html`.

**Three passes over a persistent sheet.** Unlike the stateless first version, the module keeps an accumulation buffer (the "sheet") that two framebuffers ping-pong, because every pass reads the whole sheet to write the next one:

| Pass | Shader | What it does |
| --- | --- | --- |
| bake | `inkDropsBakeFrag` | Drops that have finished settling are stamped permanently into the sheet: previous sheet x their transmittance |
| lift | `inkDropsLiftFrag` | Evaporation plus the solvent wipe, both walking the sheet back toward paper white. The wipe's coverage is parked in the sheet's alpha, which nothing else uses |
| main | `inkDropsMainFrag` | Paper + baked stains + the drops still wet on the surface, composited into `outputFBO` |

Bake runs only on frames where a drop settles; lift runs whenever a wipe is live or enough evaporation has banked up. Colour is Beer-Lambert transmittance (`pigment()`), so overlapping washes multiply rather than add.

**CPU-side simulation** (`InkDropsModule.js`): drops carry a radius, settle curve, squash, tendril and fragmentation animation, and are packed into `uA`/`uB`/`uC` uniform arrays (up to `INK_MAXD` = 32 wet at a time) each frame. A splash schedules a shattered core plus 8-16 flung shards; a cluster schedules a knot of drops; `bigStain()` drops a fat one in from above that falls, lands and soaks. Wipes (`uRing`, up to `INK_MAXR` = 12) retire oldest-first into spare slots so a live one is never yanked mid-fade. The two palettes are re-cast into one hue family by `harmonize()`, which keeps each palette's internal spacing but squeezes its widest deviation down to the `hue`/`hueVar`/`sat` knobs; it is recomputed only when those knobs move.

**Port notes:**
- The sketch is GLSL ES 3.00 and LICHEN is ES 1.00: `texture` becomes `texture2D`, `fragColor` becomes `gl_FragColor`, and the `continue` skips are written as plain conditionals.
- The bake pass multiplied into its target with `blendFunc(ZERO, SRC_COLOR)`. Here it ping-pongs and multiplies the previous sheet in the shader instead, which keeps the pass independent of p5's blend state. The passes still run under `blendMode(REPLACE)`, because they write meaningful alpha that p5's default blend would otherwise fold into the colour; `framebuffer.end()` pops the blend mode back.
- **Two uv spaces, and they must not be confused.** `texUV()` addresses the framebuffer itself (`v = y / H` is exactly the row being written) and is the only uv that may read the sheet back — reading through the flipped one mirrors the whole sheet on every ping-pong, which shows up as violent frame-to-frame flicker. `sheetUV()` flips y for the composition, because the UI blits the output with v flipped, and that flip is what keeps the falling stains falling downward.
- `uRes` comes from `Module.fragResolution()` (see Pixel Density below). Everything here is in `gl_FragCoord` space, which runs over *physical* pixels; passing the logical size squeezes the sheet into one quadrant and makes the feedback passes read off the edge.
- The sheet starts as bare paper, which takes a GL pass (`p5`'s `clear()` premultiplies, so clearing to white with zero alpha is not available): the lift shader with a full step of evaporation and no wipes resolves to white with zero coverage, so `clear()` just runs that twice.

**Seed:** works as Crystalline's does (see Seeded Randomization). All ten params are seeded: `hue` over its full range, and the rest over narrower ranges. These avoid a frozen clock at speed 0, a sheet that barely holds a stain at fade 5, and a `hueVar` near 0.5, which spreads the palette round the whole wheel. Where each drop lands is still drawn from `Math.random`, so a seed fixes the palette and pacing, not the sheet itself.

**Fullscreen interaction:** double-click the node preview to enter fullscreen; click to throw a cluster, a splash and (at most every 0.7 s) a wipe; C clears the sheet back to bare paper; ESC exits. `js/ui.js mousePressed` routes the click to `handleMouseDown()` for `Conway` and `InkDrops` rather than exiting fullscreen, and `js/main.js keyPressed` routes keys the same way it does for `GRASS` and `Conway`.

## InkMarkers Module

The InkMarkers module (`js/modules/InkMarkersModule.js`, `js/modules/inkmarkers/panel.js`, `js/shaders/inkmarkers.js`) is an Emulation source: Copic-style alcohol markers on paper, ported from the Ink Markers Studio sketch (`ink-markers`). It has X and Y control input pins and one video output. Strokes are drawn in fullscreen, with the mouse or a pen, or by a pen that X and Y drive (see X and Y).

**Params.**

| Param | Label | Range | Default | Sets |
| --- | --- | --- | --- | --- |
| `tip` | Tip | Chisel, Bullet, Brush, Fine | Chisel | The tip's width (1.5, 1, 1.2, 0.4 × Size), pressure curve and edge profile |
| `size` | Size | 1–48 px | 13 | Stroke width in frame pixels, before tip and pressure. The sketch's 24 on its 1200 px canvas, at 640 (the default frame) |
| `flow` | Flow | 0.1–1 | 0.5 | Ink a pass lays down |
| `bleed` | Bleed | 0–1 | 0.6 | Alcohol spread and the blur of the overlay layer |
| `paper` | Paper | Smooth, Cold Press, Marker Pad, Kraft | Marker Pad | The paper. Changing it starts a fresh sheet, as in the sketch |
| `r`, `g`, `b` | R, G, B | 0–255 | 0 | The current colour |
| `clear` | Clear | trigger | | Wipes the sheet back to bare paper |
| `reseed` | Seed | trigger | | Randomizes every param but Paper (see Seed) |

Flow and bleed are taken when a stroke starts, so turning them mid-stroke changes the next one (but see X and Y). Tip and colour are read as the stroke is drawn, so a cable on R, G or B changes a stroke while it is drawn, as the sketch's colour picker did.

**X and Y.** Two control input pins drive a pen that draws as the mouse does, as Conway's do (see Conway Module). They take 0..1 values, with Y up, so the pen is at `x × width` across and `(1 − y) × height` down:
- **Pen down:** while either pin is cabled, the pen draws every frame, a line from where it was last frame to where it is now, as a drag does, at the mouse's pressure of 0.5. A pin with nothing cabled in stays at 0.5, the centre. As with a click, the frame it goes down draws nothing until it moves.
- **Pen up:** with both unplugged, or a value that isn't finite, the stroke ends and is baked into the sheet, and the next one starts afresh.
- **Flow and Bleed:** a stroke keeps the Flow and Bleed it started with, and the pen can stay down for as long as the pins stay cabled. So when either has moved since, the pen lifts and goes straight back down where it was, and the new values take effect. A cable on either therefore ends a stroke every frame it moves the value.
- **Values only:** like Conway's, they read a source's value, not its loop. Latk's X and Y draw where the beam is each frame, which jumps around the drawing.

The pin pen and the mouse each keep a stroke of their own, so both can draw at once into the same wet layer. A bake takes in everything wet, so when one stroke ends, the other goes into the sheet as far as it has got, and carries on in the wiped layer. A pen held down for minutes would keep millions of points, so after each pass a stroke keeps only its last two drawn points, all the next pass reads.

Checked in headless Chrome: Constants of 0.25 and 0.75, with X then moved to 0.75, drew a line along y = 120 from x = 160 to 480 on 640 × 480. Unplugging both ended the stroke and baked it. Two values swept at 0.5 and 1 Hz drew a figure of eight in one unbroken line while the mouse drew across it, and turning Flow mid-figure took effect.

**Rendering.** Four framebuffers, which the sketch had as `createGraphics(WEBGL)` layers:
- **Paper** (`inkMarkersPaperFrag`): FBM paper, drawn when Paper changes, at a fresh `Math.random` seed.
- **Wet stroke** (`inkMarkersStrokeVert`/`Frag`): the stroke being drawn, as triangle strips built from its points, two passes each, the second jittered by 0.3 of the point's size. Only the points added since the last frame are drawn, under p5's `BLEND`, which is premultiplied over (`ONE, ONE_MINUS_SRC_ALPHA`), so a stroke that crosses itself builds up. The vertex shader takes frame pixels with y down and places them itself, ignoring p5's matrices. It is p5's default framebuffer less depth, so MSAA smooths the strips.
- **Sheet** (`accumA`/`accumB`): the finished strokes. When a stroke ends, `inkMarkersBlendFrag` composites it over the sheet into the other buffer, the two swap, and the wet stroke is wiped. Alpha 0 is bare paper.
- **Output**: the same composite of the wet stroke over the sheet, redrawn only on frames where something changed.

The blend shader is the sketch's: alcohol spread, a multiply layer of 1–3 passes by density, a blurred overlay layer, and darkening at the stroke's edges. Its pixel offsets, and the paper's grain, are given a resolution 1200 px wide, the sketch's canvas, so they keep the same share of the frame. Mouse, pen and pin events only add points to a stroke; `process()` draws them. The sketch's `marker.js` (whose wetness reached no shader), `brush.js` and `texture.js` were unused, and are not ported.

**Fullscreen interaction.** Double-click the node preview to enter fullscreen. Drag to draw; the wheel changes Size; 1–4 pick the tip, `[` and `]` change Size by 2, C clears, Ctrl/Cmd+S saves a PNG, ESC exits. Pen pressure comes from pointer events, which p5's mouse events don't carry, so the module listens for `pointerdown` and `pointermove` on window, in the capture phase. As in the sketch, a pointer is taken to have pressure when its first reading is neither 0 nor 0.5. A mouse draws at 0.5.

**Toolbar.** `InkMarkersPanel` is the sketch's sidebar as a DOM overlay, shown only in fullscreen: tip and paper buttons, Size, Flow and Ink Bleed sliders, the colour, Clear, Save Image and Seed. The current colour indicator opens a colour wheel, with hue round the disc, saturation out from the centre and a brightness slider under it, and the 17 palette squares set the colour too. Every control writes the params, and `sync()` reads them back each frame, touching only what changed, so the dials, cables and Seed show on the toolbar as well. The wheel keeps its own hue and saturation, so they survive a pick of black or grey. The panel stops `mousedown`, `click`, `dblclick`, `wheel` and `touchstart` from reaching p5's window handlers, so a click on it draws nothing. `mouseup` still goes through, so a stroke dragged over the panel still ends.

ui.js calls `showFullscreenUI()` each fullscreen frame. A frame without that call hides the panel in `process()`, so the panel hides however fullscreen ends, a patch loaded over it included. Save Image reads `outputFBO.loadPixels()` without flipping it (see Framebuffer Orientation), and `dispose()` removes the panel and the pointer listeners.

**Seed.** Works as Crystalline's does (see Seeded Randomization), over Tip, Size (3–40), Flow (0.3–1), Bleed and R, G and B. Paper is left out because a change of paper wipes the sheet. The module doesn't randomize when it is made, so a new node starts with the sketch's black chisel on marker pad. Strokes are not saved in patches, as Yellowtail's are not.

## SpiralGalaxy Module

The SpiralGalaxy module (`js/modules/SpiralGalaxyModule.js`) is a source: a rotating video-feedback tunnel whose whole animation repeats exactly every `loop` seconds.

**Exact looping:** the tunnel is a feedback accumulation, so the loop can't be closed by rewinding the clock — the buffer would still hold the old state. Instead two independent feedback buffers ("worlds") run half a cycle out of phase. Each restarts from black once per cycle, at the moment its own blend weight is zero and flat, so the restart is invisible; the output is always dominated by the mid-life world. The cycle phase is accumulated per frame (`this.cycles += dt / loop`) rather than derived from an absolute clock, so turning the `loop` knob changes the rate without jumping the cycle.

**Rendering path:** each world ping-pongs a pair of framebuffers through `js/shaders/spiralgalaxy.js:spiralgalaxyFrag`, which advects the previous frame along a twist that shears with radius (the inner turns faster than the outer, which is what winds the feedback into arms) and adds fbm-warped ripples and a bright core. `spiralgalaxyBlendFrag` then cross-dissolves the two worlds into the module's `outputFBO`.

**No Game of Life:** the WebGL sketch this was ported from drove `swirl`, `ripple`, `speed` and a dye injection from a Game of Life grid, but that grid never reached its shader — it was uploaded as raw 0/1 bytes in a `gl.ALPHA` texture, so a live cell arrived as `1/255`, `dye = smoothstep(0.6, 1.0, 0.0039)` was identically 0, and every GoL-driven term sat on a constant. The simulation is therefore not reproduced here; the three constants it was stuck on are exposed as the `swirl`, `ripple` and `speed` knobs instead, whose defaults match the original.

**Seed:** works as Crystalline's does (see Seeded Randomization). All five params are seeded over narrower ranges. These avoid a frozen tunnel at speed 0, no arms at swirl 0, a dark tunnel at ripple 0, and the top of `trail`, where the white core keeps swelling: it covers 6% of the frame at the default 0.92 and 13% at 0.99. Because a new node starts from a seed, it no longer opens on the original sketch's look. Setting the knobs to their declared defaults still reproduces it.

## Cloudy Module

The Cloudy module (`js/modules/CloudyModule.js`, `js/shaders/cloudy.js`) is a source. Camera rays cut a slice through drifting 3D fbm noise at `depth`, and the slice is lit as a surface.

**Seed:** works as Crystalline's does (see Seeded Randomization). All eight params are seeded: `colorShift` over its full range, and the rest over narrower ranges. These avoid a frozen clock at speed 0 and both ends of `depth`, where the cloud flattens into a white haze (−2) or sinks into the dark background (2).

## Coils Module

The Coils module (`js/modules/CoilsModule.js`, `js/shaders/coils.js`) is a source ported from the WebGL sketch `fooz.html`. It ray-marches a liquid helix: a tube wound round a wriggling, bending axis and smooth-blended with a smaller copy of itself, seen from a slow orbit.

**Params.** Each of the sketch's constants is a knob, and each knob defaults to the sketch's value:

| Param | Label | Default | Sets |
| --- | --- | --- | --- |
| `speed` | Speed | 1 | The clock's rate |
| `turns` | Turns | 5 | Turns of the coil per 6 units of height |
| `radius` | Radius | 1.1 | The coil's radius |
| `thick` | Tube | 0.28 | The tube's radius |
| `lobes` | Lobes | 1 | Gain on the two twisting ripples round the tube's cross-section |
| `bulge` | Bulge | 0.06 | The swelling that travels along the coil |
| `wriggle` | Wriggle | 0.35 | The sway of the whole coil |
| `bend` | Bend | 1 | Gain on the slow lean of the coil's axis |
| `melt` | Melt | 0.35 | The smooth-min radius where the two coils merge. At 0 it is a plain union |
| `dist` | Dist | 2.6 | Camera distance. The camera's height and the march's reach (12 units at the default) move with it, so it works as a dolly |
| `orbit` | Orbit | 1 | Orbit rate, as a multiple of the sketch's 0.25 rad/s |
| `hue` | Hue | 0 | Turns the palette |
| `stepScale` | Step | 0.9 | The fraction of the field each march step takes |
| `steps` | Steps | 96 | The march budget, up to 160 |

The clock and the orbit angle are both accumulated (`time += dt × speed`), so turning Speed or Orbit doesn't jump the animation.

**Torn ribbons.** The sketch's field is far from a true distance, and that is its look. The coil's centre moves sideways about 5.8 units per unit of height, but `sdCoil()` measures only across the horizontal slice. So the field can overestimate the distance nearly six times over. The march steps 0.9 of it, tunnels through most of the tube, and draws it as torn, streaming ribbons. Any step that lands inside the tube also counts as a hit. Turning Step down to about 0.2, with Steps at 160, fills the ribbons back in toward a solid tube. More turns, a wider coil or a thinner tube tear it further.

**Port notes:**
- The screen uv comes from `vTexCoord` rather than `gl_FragCoord`, so the shader is independent of pixel density.
- `calcNormal()` takes its differences backwards, so the normal points into the tube. It is kept as written: flipping it changes every pixel the coil covers.
- The sketch's vignette goes negative in the corners of a frame wider than about 1.7:1, where `pow()` is undefined, so it is floored at 0.
- `smin()` divides by its radius, so Melt is floored at 1e-4 in the shader.

**Checked against the sketch.** The comparison ran in headless Chrome at 640×480, with the defaults and the clock held at 3, 17.5 and 42 s. All but 0.1–0.2% of pixels match the sketch to within 2 levels. The rest are isolated pixels where the torn march magnifies float rounding.

**Seed:** works as Crystalline's does (see Seeded Randomization). Twelve params are seeded: `hue` over its full range, and the rest over narrower ranges. These avoid a frozen clock at speed 0, and coils wound so tight, wide or thin (`turns` above 6, `thick` below 0.2) that the march tears them down to a few threads. Step and Steps are the march rather than the coil, so the seed leaves them alone.

**Cost.** At 1280×960 (a retina display) on an M2 Max, a frame costs 3.5 ms at the defaults, and 4.9 ms at Step 0.2 with 160 Steps.

## Crystalline Module

The Crystalline module (`js/modules/CrystallineModule.js`, `js/shaders/crystalline.js`) is a source: a ray-marched signed distance field built from 3D Voronoi cells that generates a faceted, iridescent crystal. The crystal assembles, holds, then shatters along its own cell boundaries, and reassembles on a continuous loop.

**Cycle and Control Export:** The animation loop is divided into three phases: assemble (shards fly together), hold (intact crystal), and shatter (crystal flies apart). This cycle runs over `cycle` seconds. The module calculates a burst amount (0 for intact, 1 for fully burst) and exports this as a control value (`burst`), allowing the cycle to drive downstream parameters via control cables.

**Rendering path:** The fragment shader performs sphere-tracing through a Voronoi-based distance field. During the burst phase, each cell is displaced along a hashed direction. The normal and material properties are calculated in the un-displaced field so shards retain their original facets and colors as they fly apart.

**Seed:** every new Crystalline calls `randomize()` in its constructor (see Seeded Randomization), so no two start alike. The Seed trigger at the bottom of the params shows the current seed and draws a new one when clicked or fired by a cable. Patching its own `burst` output into it re-seeds the crystal halfway through every shatter, where `burst` rises through 0.5. Eight params are seeded: `hue` over its full range, and `speed`, `cycle`, `scale`, `burst`, `dist`, `orbit` and `glow` over narrower ranges. The narrower ranges keep a random draw away from the knobs' degenerate ends, such as speed 0 (frozen) and cycle 5 (frantic). `steps` is a ray-march budget rather than part of the look, so the seed leaves it alone.

## Whitney Module

The Whitney module (`js/modules/WhitneyModule.js`, `js/shaders/whitney.js`) is a source. It ports the five Processing sketches in `processing_selects` from the Whitney-Music-Box-Examples project, all of them drawings of John Whitney's incremental drift, and the `sketch` drop-down picks one:

| sketch | Label | Original | Dots | Frame rate |
| --- | --- | --- | --- | --- |
| 0 (default) | Music Box | `whitney_I`, Jim Bumgardner's Whitney Music Box | 48 | every frame |
| 1 | WhitneyScope | `whitney_II` | 400 | every frame |
| 2 | Arabesque | `whitney_III_arabesque`, Paul Rother's program for *Digital Harmony* | 360 | 24 fps |
| 3 | Column A | `whitney_IV_columna`, also Rother's | 60 | 10 fps |
| 4 | Column BC | `whitney_V_columnbc`, also Rother's | 360 | 24 fps |

Patches save the sketch as its index, so a new one is appended to `SKETCHES`, never inserted. `speed` scales the clock, which is accumulated (`time += dt × speed`), so turning it doesn't jump the drawing, and a negative speed runs it backward. `offset` moves the start through the sketch's cycle: 30 s for Music Box, 60 s for Column A, and 600 s for Arabesque and Column BC. `size` scales the dots. Choosing a sketch restarts its clock, as launching the original would. Each sketch's own canvas (500×500, 600×600, 640×480, 280×192 and 500×500) is fitted inside the output and centred. Music Box's grey line runs on to the output's right edge rather than stopping at the edge of its square.

**Not ported:**
- The Music Box's sound. It sent notes over TCP to Pure Data. What remains is the flash and swell it draws when a dot sounds.
- WhitneyScope's mouse. Offset stands in for its height, and its click toggle for `classicStyle` is gone.

**WhitneyScope's Offset.** The original sets `startTime = -cycleLength × mouseY / height`, and its clock moves so slowly that the mouse is what really drives it. The mouse height sets every dot's angle (`a = 2π × k × mouseY / height` for dot weight `k`), so simple fractions of the window draw Whitney's stars, and others scatter. Offset 0 stands for a tenth of the way down (`SCOPE_MOUSE_Y`), where the dots form a ten-armed star. Offset 0.4 stands for halfway down, where every angle is 0 or π and the dots lie on one line. At the very top, where Processing's `mouseY` starts, the dots stay collapsed on the centre for minutes.

**One draw call.** The module draws a `p5.Geometry` of 401 quads, built once and never re-uploaded: quad 0 is the Music Box's line, and quad *q* is dot *q* − 1.
- **Vertex shader:** places each quad from its index and a few uniforms. It works out position, diameter and colour as the sketch's `draw()` does, `int` casts included, so dots still snap to the sketch's pixel grid. Quads past the sketch's dot count go outside the clip volume.
- **Fragment shader:** draws an antialiased disc with a one-physical-pixel edge, premultiplied for p5's `BLEND`.
- **Geometry id:** the geometry is given its own `gid` (see Development Conventions).

**Precision.** The sketches' angles grow without bound. WhitneyScope's `sin(a × timer)` reaches about 10^7 rad, far past what float32 can hold on a GPU. `_state()` therefore reduces the clock in double precision to the cycle fractions each sketch needs, such as `fract(timer² / 2πN)`. The shader multiplies that by the dot's whole-number weight and takes `fract` again, which loses nothing, because a whole number of extra turns changes nothing. The Music Box's crossing test (the original's `tines[]`) runs in JS: a dot flashes whenever its count of whole turns changes, whichever way the clock moves. The time since then reaches the shader as `uSince[48]`, capped at the flash's 500 ms.

**Frame rates and redraws.** Arabesque, Column A and Column BC call `frameRate()`, so each of their frames shows the clock as it stood when the frame began and holds for 1/fps. The module also skips drawing whenever nothing that reaches the shader has changed, during a held frame or at Speed 0. Column A therefore draws 10 times a second.

**Checked against the sketches.** The comparison ran in headless Chrome against literal JS transcriptions of each `draw()`, in double precision and drawn with Canvas2D, at pixel density 1 and 2.
- **Overlap:** the lit pixels overlap with an IoU of 0.97–1.0, up to 10^7 s into the clock.
- **Dot positions:** run in double precision, the shader's maths puts every dot exactly where the transcription does, except for exact ties. A tie is a dot that sits exactly on a pixel boundary, such as every Column BC dot at a whole cycle.
- **float32 rounding:** on the GPU, up to 0.6% of dots land 1 px from the transcription, because they fall within rounding of a boundary. No dot is further off.

At 1280×960 on an M2 Max, a drawn frame costs about 0.34 ms, the same for every sketch. Cloudy costs 1.7 ms.

## LetterForms Module

The LetterForms module (`js/modules/LetterFormsModule.js`, `js/shaders/letterforms.js`, `js/modules/letterforms/alphabet.js`) is a source ported from bitcraftlab's Processing sketch `ParametrizeM.pde`, a tribute to Vera Molnár's series with letter forms. It tiles a grid with one stroked capital, each tile turned a further quarter turn along the diagonals (`rotate(PI/2 × ((x + y) % 4))`), and runs an odometer through the sketch's parameter space. The sketch draws only an M; the module draws any letter from A to Z.

**Params.** Letter starts on the sketch's M. Stroke, Columns and Invert default to the sketch's declared values, and their ranges are its parameter space:

| Param | Label | Default | Range | Sets |
| --- | --- | --- | --- | --- |
| `letter` | Letter | 12 (M) | 0–25 | The capital, A to Z. A knob whose `valueLabels` name the letter. A cable or a typed value is rounded to the nearest letter, and held to A and Z |
| `stroke` | Stroke | 5 | 1–20 | The stroke's width, in the canvas's pixels |
| `columns` | Columns | 10 | 1–20 | Tiles across. Rows are as many as fit |
| `invert` | Invert | 0 | 0–1 | 0 draws black on white, 1 white on black. Between them, as from a cable, both go grey, as the sketch's `255 × invert` would |
| `rate` | Rate | 60 | 0–60 | The odometer's steps per second. 0 holds still |

**The alphabet.** `alphabet.js` holds each letter as a list of strokes, each a polyline, in the tile's own space: its centre at 0 and its edges at ±1, y down. M is the sketch's own five vertices. The other 25 are drawn to match it. Every letter spans the whole box. Corners a letter would round (B, C, D, G, J, O, P, Q, R, S, U) are cut at 45° on the half-unit grid instead, so the alphabet is as angular as the M. `letterSegments()` flattens a letter into segments, and the shader reads them from a `vec4` table of `MAX_SEGMENTS` (9, Q's count) with a count, so a new letter form needs no shader change unless it has more segments. In the turning grid some letters tile alike: W is M turned half a turn, and Z is N turned a quarter, so each pair gives the same grid, shifted by a tile.

**The odometer.** The sketch's `Params.animate()` takes one step a frame, at Processing's 60 fps. Each step adds 1 to Stroke. A wheel that runs past its max goes back to its min and carries one step into the next: Stroke, then Columns, then Invert. Letter isn't one of its wheels, so the odometer never changes the letter. The module moves the knobs themselves, so they show where it is and a patch saves the step it was on. Its phase is accumulated (`phase += dt × rate`), so turning Rate doesn't skip steps, and a small tolerance keeps Rate 60 at 60 fps to exactly one step a frame. A cable on one of the three knobs is applied after the module runs, so it wins, and the odometer steps on from the cable's value.

**Drawing.** The sketch's 500×500 canvas is fitted inside the output and centred, as Whitney fits its sketches, and the background colour fills the rest. The shader works in the canvas's pixels, y down, so the sketch's grid maths carries over as written: tile `d = 480 / columns`, `floor(480 / d)` rows, origin `(10, (500 − d × rows) / 2)`. Processing strokes the M with round joins and caps, so a pixel is lit where its distance to the letter's segments is under half the stroke. That is the union of one capsule a segment, exactly the shape Processing draws. Each pixel checks its own tile and the tiles around it, as far as half a stroke can reach (at most 4 each way). The edge is antialiased over one physical pixel, and the pass reads `vTexCoord`, so it is independent of pixel density. Two departures:
- **Fractional Columns:** the sketch already treats Columns as a float (`d = (w − maxStroke) / columns`, `ceil(columns)` columns drawn), so a cable zooms the grid smoothly and a column appears once it fits. Below 1 the sketch would draw no rows; this draws one.
- **Overlaps:** Processing composites each stroke's antialiased edge over the last, so the legs that neighbouring tiles share come out slightly darker at the edge. The distance field is a single union, so they don't.

**Checked against the sketch.** The comparison ran in headless Chrome against a Canvas2D transcription of the sketch's `draw()`, with the same transforms, round joins and caps, supersampled 8× (4× at pixel density 2) and box-filtered. Six settings of the M, from one M at Stroke 1 to 20 columns at Stroke 20, inverted and not, gave a lit-pixel IoU of 0.995–1.0 at pixel density 1 and 2. 94–99.6% of pixels match within 2 levels; the rest are edge pixels, where a one-pixel distance ramp differs from true area coverage. Each of the 26 letters, stroked from `alphabet.js` in the same transcription at Stroke 3–20 and 3–10 columns, gave an IoU of 0.990–1.0, with 93–99.9% of pixels within 2 levels. The M drew the same before and after the alphabet was added, and a patch saved before it loads with M. Over 900 steps at Rate 60 and 60 fps, the odometer went through the sketch's sequence one step a frame. A patch exported with `tools/patch-to-gles3.mjs` draws the same grid.

## Blur Module

The Blur module (`js/modules/BlurModule.js`, `js/shaders/blur.js`) blurs its input with one of three classic approaches, chosen by the `mode` drop-down:

| mode | Label | Approach |
| --- | --- | --- |
| 0 (default) | Gaussian | Separable two-pass convolution. Taps are paired so each bilinear fetch covers two texels at the right blend, halving the fetches with no change to the kernel. |
| 1 | Kawase | Bjørge's dual filter (SIGGRAPH 2015): a pyramid of half-size buffers, a 5-tap filter on the way down and an 8-tap filter on the way up. Cheap at any radius, with a soft, creamy falloff. |
| 2 | Bokeh | A golden-angle disc gather, like an out-of-focus lens: round discs with a slightly bright rim, where Gaussian and Kawase give glows. |

`radius` (0–100 output pixels) sets the size, `highlights` how much bright areas bloom, and `mix` blends from the input (0) to the blur (1).

**One size across modes.** Every mode blurs to the same spread, sigma = radius / 2, so switching modes changes the blur's character and not its size. Gaussian uses that sigma directly. For Bokeh the radius is solved from its own sample set's variance, since the rim ring and rim weight make a disc spread a little wider than a plain disc's radius / 2. Kawase has no radius of its own, so `KAWASE_SIGMA` holds each pyramid depth's spread, measured as the second moment of a 1-pixel line's response. Between depths, the module crossfades the two depths around the target, weighted so the mix's variance lands on it exactly. Measured on a 1-pixel line, all three come within 2% of radius / 2 from radius 2 to 100, at both pixel densities, and preserve the line's energy to within 1%.

**Linear light and highlights.** The prep pass converts to linear light at full resolution, and every kernel works there, so a blurred bright area keeps its brightness instead of greying out. It also expands each pixel toward HDR with an inverse Reinhard curve on its brightest channel, and the composite compresses back with the matching Reinhard curve. The pair is an exact inverse, so flat areas come back unchanged, while inside the blur a highlight carries up to 1 / (1 − alpha) times its light and blooms over dark areas. `highlights` is exponential in that factor: ×1 at 0, about ×8 at 0.5, ×64 at 1. Downscaling has to come after linearising: averaging first would turn a 1-pixel line and its dark neighbour into 0.5^2.2 rather than 0.5, losing more than half its energy.

**Working scale.** To keep large radii cheap, Gaussian and Bokeh run at a reduced scale (1, 2, 4 … 32) once the kernel would outgrow `GAUSS_MAX_SIGMA` or the Bokeh disc limit. The prep buffer is halved in linear light down to that scale, the kernel runs there, and the composite upsamples. Halving and upsampling blur by a known amount, which comes off the kernel so the total spread doesn't change as the scale steps. Bokeh adds three things:
- A 1-texel tent pre-filter, so a highlight smaller than the gap between samples stamps a smooth disc instead of a speckled one.
- A cubic B-spline upsample, so a disc gathered far below full resolution doesn't show blocky texels.
- A fixed sample count per scale (64 at full scale, 128 below), since a new count reshuffles the whole pattern and flickers on small highlights. Through the top quarter of each scale's range it crossfades toward the next scale's result and reaches it before the switch, so the change in edge profile between scales never lands as a step. Sweeping `radius` in 0.5 steps shows no jumps in any mode.

**Edges.** Taps past the image edge are dropped and the rest renormalised, instead of clamped. Clamping repeats the edge texel, which at a coarse scale stands for a wide average, so the border would visibly change each time the radius stepped to a new scale (and streak besides).

**Cost.** At 1280×960 (a retina display) on an M2 Max, every mode at every radius runs in 0.4–1.5 ms per frame. Kawase is the most expensive at large radii, because of the pass overhead across its pyramid levels. Buffers are half float when the context supports it, so the linear-light darks don't band.

## Channel Module

The Channel module (`js/modules/ChannelModule.js`, `js/shaders/channel.js`) builds a picture from the channels of up to three inputs: red from `r`, green from `g` and blue from `b`, each times its gain (R Gain, G Gain and B Gain, −3–3, default 1), clamped to 0–1. A negative gain inverts its channel first, so −1 gives `1 − v`, and turning a gain down through 0 runs from the picture through black to its negative. A grey source gives its brightness to the channel it is cabled to. The output is opaque.

**Inputs.** Each pin feeds only its own channel, and an unplugged channel is black. A lone input on `r` shows only its red channel, two inputs show two channels, and the same picture cabled to all three pins passes through unchanged at gains of 1. With none, the output keeps its last frame, as VideoMixer's does.

**Checked.** In headless Chrome, on random-noise inputs, a lone input on each pin comes out as that one channel exactly, with the other two at 0, and two inputs give their two channels with the third at 0. Three different inputs, and the same input on all three pins, take each channel from its pin exactly. With gains of 0.5, 1.7 and 0, every pixel is `round(input × gain)`, clamped. The two- and three-input cases are unchanged from when a lone input fed all three channels.

## Transform and Crop Modules

Transform (`js/modules/TransformModule.js`) moves, turns and scales its input, and Crop (`js/modules/CropModule.js`) keeps only a box of it. Both work in pixels of the frame (640×480 by default, see Frame Size), with y down, and leave anything outside the picture transparent black, (0, 0, 0, 0) premultiplied, as ChromaKey's and Matte's holes are. A preview shows it as black, and the output's alpha is the shape of the picture, so it can be Matte's `a` with the Alpha matte. Their shaders address the frame through `vTexCoord`, so pixel density doesn't matter.

- **Transform:** X and Y move the picture's centre from the frame's. Rotation turns it clockwise about that centre, in degrees. Scale X and Scale Y are factors, 1.00 for 100%, and a negative one flips that axis. The picture is scaled, then turned, then moved.
- **Crop:** X and Y are the box's top-left corner, and Width and Height its size. A typed negative Width or Height runs the box the other way from the corner. The Mode drop-down sets what the box's picture fills. Floating (0, the default) leaves it where it is, with transparent black round it. Fit (1) stretches it to the whole frame, so its shape follows the frame's rather than the box's. With Fit, the part of a box past the picture's edge is transparent, and a box of no width or height gives a transparent frame. So does a Transform scale of 0.

**Fullscreen interaction.** Double-click the node preview to enter fullscreen. ESC exits. `js/ui.js` routes press, drag, release and (for Transform) the wheel to the module's `handleMouse*`/`handleWheel` methods. A cable on a param overrides what the mouse sets.
- **Transform:** a drag moves the picture with the pointer. An Alt-drag turns it by the angle the pointer sweeps around the picture's centre, so circling clockwise turns it clockwise. `js/main.js` passes the drag's event to `NodeGraphUI.mouseDragged()`, which hands its `altKey` to `handleMouseDrag()`. The wheel multiplies both scales by the same factor, 1.001 per unit of wheel delta, which keeps their ratio. Scrolling up enlarges.
- **Crop:** dragging draws a white box. While it is drawn, fullscreen shows the whole input instead of the output (`fullscreenFBO()`). On release the box, normalised whichever way it was drawn and held to the picture, sets the four params, and flashes three times over 450 ms over the cropped output (`drawFullscreenOverlay()`). In Fit the output no longer shows the box where it was drawn, so the flash is over the input instead, and the fitted output follows it. A box under a pixel wide or high is a click and changes nothing.

Checked in headless Chrome at pixel density 1 and 2: with both at their defaults the output matches the input, and a move, a 90° turn, a scale of 0.5, a flip and a crop each sample the input where they should. Driven through `NodeGraphUI`'s mouse methods, a drag, an Alt-drag, the wheel and a box drawn bottom-right to top-left set the params they should. Crop's Floating, with a 320×240 box, gives the input inside and black outside on every pixel. Fit samples the box across the whole frame and matches the input on every value with the full-frame box. It is black for an empty box and past the picture's edge, and a negative size runs back from the corner.

**Transparent outside.** The outside was opaque black until the alpha change. Checked against that commit in headless Chrome at pixel density 1 and 2, on a radial Oscillator: Crop Floating (100, 80, 320×240), Fit past the picture's edge and a negative size, and Transform moved, turned 30° and scaled 0.5 by −0.7, matched it on every value where the new output has alpha above 0, and every pixel at alpha 0 had been opaque black. Transform at Scale X 0 is alpha 0 everywhere. The box's edges fall where they did: (99, 79) and (420, 320) are alpha 0, and (100, 80) and (419, 319) are 255. That Crop as Matte's `a`, with a second Oscillator as bg, gives fg on every pixel inside the box and bg on every pixel outside it, within one level.

## Resample Module

The Resample module (`js/modules/ResampleModule.js`, `js/shaders/resample.js`) resamples its input to an output of Width × Height real pixels. It has one video input and one output. Before 2026-10-30 it was called Resize; its uid and ids are unchanged, so patches saved with the old name load as Resample. Its Width and Height are Restore's, and behave the same way (see Width and Height in Restore Module):
- **Real pixels:** both are in real pixels, and the output framebuffer has density 1.
- **Input:** both default to 0, which the knob shows as Input, and that axis takes the input's own size. A negative size typed in is Input too.
- **Sizes:** a dragged or cabled knob is rounded to whole pixels, and a typed size is used as it is. Every new size reallocates the output, so a cable on either knob reallocates it on every frame it moves.
- **Downstream:** other modules read the result by uv and write the frame's size, and previews show it at 4:3. Only a Monitor cabled straight to Resample, at the same Width and Height, sees the output's pixels and shape as they are.

**Mode.** A drop-down sets how the input's picture is fitted to the output. It is centred, and where it doesn't reach, the output is opaque black:

| mode | Label | Picture |
| --- | --- | --- |
| 0 (default) | Fit | Stretched to fill Width × Height, as before modes existed |
| 1 | Letterbox | Its shape kept, as wide as the output: bars top and bottom, or cropped top and bottom when the output is wider than the input |
| 2 | Pillarbox | Its shape kept, as tall as the output: bars left and right, or cropped left and right when the output is taller than the input |

So a 4:3 input pillarboxed into 1920×1080 is 1440 pixels wide, with 240 of black each side. Shapes are compared in real pixels, so the input's density doesn't matter. At the input's own size and shape, all three modes give the same output.

**Scaling.** One pass copies the input through the input texture's own bilinear filter, under `blendMode(REPLACE)` so the alpha is copied rather than blended. As with Restore, a size below half the input's aliases, since nothing averages. The output framebuffer has `textureFiltering: NEAREST`, so whatever reads it, previews and fullscreen included, sees its pixels as blocks. A small size such as 160×120 then looks pixelated rather than blurred, as it did when the output was filtered bilinear.

Checked in headless Chrome at pixel density 1 and 2:
- **At Input:** the output is the input's size and matches it on every value, alpha included, with the input at alpha 0.5 too.
- **Other sizes:** 1440×1080 gives a 1440×1080 buffer whose pixels sample the input by uv. One knob alone leaves the other axis at the input's size, and 1365.6 × 767.7 gives 1366×768. Typed in, 5000 × −4 gives 5000 by the input's height. Back at Input, the output is the first one again on every value.
- **Downstream:** a Sharpen after a 1440×1080 Resample still writes the frame's size.
- **Modes:** a 4:3 input pillarboxed into 1920×1080 fills columns 240 to 1679 at full height, with black outside. Letterboxed into 1080×1080 it fills rows 135 to 944; letterboxed into 1920×1080 it is cropped by 180 input rows top and bottom; pillarboxed into 1080×1080 it is cropped at the sides. Letterbox and Pillarbox at Input match the input on every value. A cabled mode of 1.4 rounds to Letterbox.
- **Knob:** dragging Width in the node reallocates the output to the dragged size.

## Restore Module

The Restore module (`js/modules/RestoreModule.js`, `js/modules/anime4k/`, `js/shaders/anime4k/`, `js/shaders/restore.js`) runs the Restore CNNs from bloc97's Anime4K v4.0. They are small convolutional networks trained to rebuild anime line art that blur, resampling and compression have softened. They keep their input's size, so the module can scale its input to another size first and run them there (see Width and Height). Because they were trained on line art, they sharpen edges in any picture, and in camera or generative video they can invent line structure.

**Params.**

| Param | Label | Options | Default | Sets |
| --- | --- | --- | --- | --- |
| `model` | Model | Restore, Restore Soft | Restore | Anime4K's two families: Restore is tuned for blur and upsampling artifacts, Restore Soft for downsampling artifacts and aliasing |
| `size` | Size | S, M, L, VL, UL | M | The network's size; each step costs about twice the last (see Cost). Anime4K's Fast presets use M |
| `clamp` | Clamp | Off, On | On | Anime4K's Clamp_Highlights, which Anime4K recommends always using. After Amount, it pulls each pixel's luminance down to the input's maximum over the 5 × 5 pixels around it, so edges don't ring or overshoot |
| `mix` | Amount | 0–10 | 2 | How far the picture moves from the input (0) toward the restored picture (1), and past it above 1 |
| `width`, `height` | Width, Height | Input, or up to 3840 and 2160 px | Input | The output's size (see Width and Height) |

Patches save Model and Size as indexes, so a new model (Anime4K's GAN ones, say) is appended, never inserted.

**Amount.** Each network ends by adding its output to the input (`return result + MAIN_tex(MAIN_pos)`), so what it computes is a small correction to the picture. At 1 that correction is all Restore does, which is hard to see. On a 640×480 photo, M changed pixels by a mean of 3.9 levels, against 19.7 for Sharpen at its default 5. On the same photo upscaled 2× (a retina display) it changed them by 1.8. Amount scales the correction: the output is `input + Amount × (restored − input)`. The key is still `mix`, as it was when the knob stopped at 1, so older patches load unchanged.
- **Amount 2 and 4:** these change the photo by a mean of 7.6 and 13.6 levels.
- **No added noise:** the correction is near zero in flat areas, so it adds no noise there. On the photo's sky, high-frequency noise stays at 0.5 levels at Amount 3, where Sharpen 5 raises it to 3.2.
- **Why the default is 2:** the networks under-correct. On the photo halved and doubled with bilinear filtering, M scored 25.01 dB against the clean photo at Amount 1, and 25.16 dB at 2.

Two other ways of strengthening it were tried in numpy and dropped. Running the network at half or quarter resolution changed the picture a little less than Amount 1 (means of 3.1 and 3.3), and softened fine detail. Running it twice in a row changed it about as much as Amount 2, at twice the cost.

**Width and Height.** Restore is the one module whose output can be another size than the frame. It scales its input to Width × Height and runs the network at that size, so the network works on the blur the scaling leaves, which is what the Restore family is tuned for.
- **Real pixels:** both are in real pixels, as Monitor's Width and Height are, not in pixels of the logical frame. On a retina display the default frame is already 1280×960, so 1440×1080 is 1.125 times its size there, and 2.25 times on a standard display.
- **Input:** at 0 a knob reads Input, and that axis takes the input's own size. A negative size typed in is Input too, though the knob shows the number. Both default to it, so a new node, and a patch saved before the knobs, give the output they gave before. A Restore at Input after an upscaling one takes that one's size.
- **Whole pixels:** a dragged or cabled knob gives fractions, which are rounded. A typed value is used as it is, so 1366 × 768 works, and so does one past the knob's 3840 × 2160 (see Typed values). Every new size reallocates the module's buffers, so a cable on either knob reallocates them on every frame it moves.
- **Shape:** the input is stretched to fill, whatever the two sizes' shapes. Everything downstream still shows the picture at the frame's shape.
- **Scaling:** there is no scaling pass. Every pass that reads the input is told the input has the output's size, so its taps fall an output pixel apart, and the input texture's own bilinear filter scales it. A size below the input's is read the same way, with no averaging, so below half size it aliases.
- **Downstream:** other modules read the bigger picture by uv, as they read any input, and write the frame's size. The extra pixels are only seen by a Monitor cabled straight to Restore, whose fullscreen, second-screen and recording copies take the picture at its own size (see Full-size copies in Node Previews). A recording is pixel for pixel when Monitor's Width and Height match Restore's.

**Files.** Each model is one of Anime4K's mpv user shaders, copied unchanged from its `glsl/Restore/` at commit 7684e95 into `js/shaders/anime4k/` as a JS default export, MIT licence included. A file is a list of passes, each a block of `//!` directives and a `hook()` that reads named textures through mpv's macros. `anime4k/mpvHook.js` turns each pass into a p5 shader:
- **Textures:** each bound texture becomes a sampler and a size uniform, and the macros read it at the fragment's own uv, offset in texels.
- **Orientation:** mpv puts +y down the image, as a LICHEN framebuffer does (v = 0 is the top row), so offsets carry over unchanged.
- **Scope:** it handles what Restore uses and no more. Every pass is its input's size, and any other WIDTH, HEIGHT, WHEN or hook is rejected.

**Running.** The module runs the passes in order, each into its own half-float buffer of the output's size, which later passes bind by its SAVE name. The features are signed, so 8-bit buffers would lose half of them, and without half-float framebuffers the module passes its input through. With Clamp on, Clamp_Highlights' two statistics passes run first, on the input. `restoreMixFrag` then applies Amount and writes `outputFBO`, keeping the input's alpha. With Clamp on, it also does Clamp_Highlights' clamp, reading the statistics. In mpv the clamp is the file's PREKERNEL pass, after the model. Here it comes after Amount, so a large Amount can't bring back the overshoot it removes. The file is still copied unchanged, and its PREKERNEL pass is compiled but never run. The passes run under `blendMode(REPLACE)`, as Blur's do, since the alpha channel carries a feature like the others.

**Loading.** A model's file is imported the first time any node picks it, since the UL files are 300 KB each, and its compiled passes are shared by every node. As with LUT's presets, the previous model stays on until the new one is ready, and a choice that finishes loading after a newer one is dropped. Until the first model is ready, the output is the input.

**Compiling in the background.** p5 compiles a shader the first time it is bound, and waits for it. With nothing in the GPU's shader cache, that froze the page for 1.0 s on first choosing M, and 6.5 s for UL. macOS keeps compiled Metal shaders, so later sessions took 21–135 ms. `mpvHook.js` therefore compiles with `KHR_parallel_shader_compile`:
1. It issues every compile and link without asking for a result.
2. It polls `COMPLETION_STATUS_KHR` every 5 ms.
3. It gives the finished programs to p5, which skips its own compile when a shader already has one (`Shader.init` in p5 1.9 checks `_glProgram`).

With nothing cached, the main thread then never stalled for more than 5 ms, and the models were ready after 0.5 s (M) and 1.8 s (UL). Without the extension, or if p5's internals change, p5 compiles them itself as before.

**Checked.** An independent numpy implementation reads the weights from the same shader text, line by line, and fails on any line it doesn't recognise. It stores each pass in float16, as the GPU does. The test ran in headless Chrome on an M2 Max: a 640×480 crop of Anime4K's Bird test image, halved and doubled again with bilinear filtering, went from Image into Restore.
- **Every model:** all ten models with Clamp on are within one level of the numpy result on every pixel, at pixel density 1 and 2. So is M with Clamp off, and with Mix 0.4. Mix 0 gives back the input exactly.
- **Orientation:** the input reads back the right way up, and the numpy model offsets +y down the image as mpv does, so the match also shows the convolutions run the right way round.
- **Restoring:** against the clean crop, the degraded input scores 21.06 dB, Restore M 21.89 dB and Restore UL 22.10 dB. Restore Soft, made for other artifacts, gains less: 21.40 dB for M.

These checks ran when Mix stopped at 1 and the clamp ran as a pass before it. Amount was checked in headless Chromium on a Raspberry Pi, through SwiftShader, with a 640×480 photo going into Restore M through a passthrough source:
- **Against numpy:** Amount 0, 1, 2 and 4 with Clamp on, and 2 with Clamp off, are within one level of the numpy result on every pixel, at pixel density 1 and 2. The numpy result applies Amount, then the clamp. Amount 0 gives back the input exactly.
- **Against the old version:** at Amount 1, the output matches the version before Amount on all but 0.16% of pixels, which are one level off. Mix 0 matches exactly.

Width and Height were checked in headless Chrome on an M2 Max, with a 640×480 test picture coming in from Image, at pixel density 1 and 2:
- **At Input:** the output matches commit 4970850, from before the knobs, on every pixel: M, S with Clamp off at Amount 1, Restore Soft L at Amount 4, VL, and UL at Amount 0.4. Width and Height typed in as the input's own size give the same pixels again.
- **Scaled:** the input was scaled to 1440×1080 by the GPU's bilinear filter into a float buffer, and that went into a Restore at Input. A Restore at 1440×1080, fed the input itself, matches it on every pixel: M, M with Clamp off at Amount 1, Restore Soft S at Amount 4, and UL.
- **Sizes:** the output and every pass buffer are the size asked for. One knob alone leaves the other axis at the input's size, 1365.6 × 767.7 gives 1366×768, and a second Restore at Input after one at 1440×1080 is 1440×1080. Turned up to 2560×1920, down to 320×240 and back to Input, a node gives its first output again on every pixel.
- **Patches:** a node saves its Width and Height, and Sharpen and Blur after a 1440×1080 Restore still write the frame's size.

**Cost.** In ms per frame on an M2 Max, with Clamp on:

| Size | Density 1 (640×480) | Density 2 (1280×960) |
| --- | --- | --- |
| S | 0.55 | 1.35 |
| M | 0.81 | 2.4 |
| L | 2.3 | 7.2 |
| VL | 4.7 | 15–18 |
| UL | 15 | 54 |

Restore Soft costs the same, and Clamp adds about 0.2 ms at density 1. UL can't hold 60 fps on its own, and at density 2 neither can VL. The first frame drawn with a newly loaded model took up to 21 ms at density 1 and 69 ms at density 2.

The table is for an output of the frame's size. Cost follows the output's pixel count: measured for M from 1280×960 to 3840×2160, the time per pixel varied by under 10%. So 1440×1080 costs 1.3 times the Density 2 column, 1920×1440 2.25 times, and 3840×2160 6.75 times. Memory follows it too. A pass buffer takes 8 bytes a pixel, and with Clamp on M holds 10 of them and UL 27: 124 MB and 336 MB at 1440×1080, and 664 MB and 1.8 GB at 3840×2160. Showing a bigger output on a Monitor costs more again (see Full-size copies in Node Previews).

## DepthAnything Module

The DepthAnything module (`js/modules/DepthAnythingModule.js`, `js/shaders/depth-anything.js`) runs Depth Anything V2 Small (Yang et al., 2024), a monocular depth model, on its input, as the depth-anything-v2-js project does. Its output is the model's relative depth: in Grey, near is white. It shares InfrDrawings' ONNX Runtime loader (`js/modules/img2img/OnnxModel.js`), which runs the model on WebGPU, or on WASM in ORT's proxy worker.

**Model.** `files/models/depth-anything/depth-anything-v2-small_fp16.onnx`, about 50 MB, is loaded the first time a node runs and shared by every node. Its input size is dynamic, so the one file takes every Size. The other exports were slower on WebGPU, at 518 × 742 in headless Chrome on an M2 Max:
- **fp16:** 78 ms.
- **q4f16:** 259 ms. Its 4-bit `MatMulNBits` layers run on WebGPU, but more slowly here than fp16's.
- **uint8:** 3.7 s. ORT Web 1.30 has no WebGPU kernels for its `MatMulInteger`, `ConvInteger` and `DynamicQuantizeLinear` nodes, so they ran on the CPU.

Fixing the input size when the session starts (`freeDimensionOverrides`) made fp16 about a third slower on WebGPU, so the module leaves it dynamic.

**Params.**

| Param | Label | Options | Default | Sets |
| --- | --- | --- | --- | --- |
| `size` | Size | 238 × 182, 336 × 252, 434 × 322, 518 × 392, 686 × 518 | 336 × 252 | The model's input: depth-anything-v2-js's short sides, 182 to 518, with the long side fitted to the frame's shape (the sizes listed are the 4:3 default's). Both are multiples of the ViT's 14 px patches. 518 is the size the model was trained at |
| `colormap` | Color | Grey, Turbo | Grey | Grey shows near as white. Turbo, depth-anything-v2-js's polynomial fit of Google's Turbo, runs from blue (far) to red (near) |
| `invert` | Invert | Off, On | Off | Swaps near and far |

Patches save Size as its index, so a new size is appended, never inserted.

**Running.** A frame goes through InfrDrawings' four stages:
1. **Input:** the frame shrinks to the Size, with InfrDrawings' input shader.
2. **Reading:** it comes back through a fenced pixel buffer, so the main thread never waits on the GPU.
3. **Depth:** its pixels are normalized by ImageNet's mean and standard deviation and run through the model, which gives relative inverse depth, larger nearer.
4. **Output:** the map is normalized to its own nearest and farthest points, as depth-anything-v2-js does, so its contrast is always full but its scale changes from frame to frame. It is uploaded as an 8-bit grey texture, and `depthAnythingOutputFrag` scales it up to the canvas and applies Color and Invert.

The newest frame waits while the model runs, and older ones are dropped. On WebGPU, ORT warns in the console, when the session starts, that some of the model's nodes were not assigned to WebGPU.

Its runs take turns with InfrDrawings' and Pix2Pix's, in one queue in `OnnxModel.js`. ORT's WebGPU build keeps one run in progress for the whole runtime, not one a session. Each model used to queue only its own runs, so with both modules in a patch, a run of one started during the other's, and both failed ("Session already started", "Session mismatch") and stopped for good. With both fed the same picture on WebGPU, each now gives 66 results in 4 s. On WASM, ORT's proxy worker already ran them one at a time.

**Failures.** A load or a run that fails is tried again, with `Backoff` from `OnnxModel.js`: 1 s after the first failure, doubling with each one after it up to 30 s, and at once after a success. Only the Size a run failed at waits. Its frames read back during the wait are dropped, and choosing another Size runs at once. InfrDrawings works the same way, with its Model in place of the Size, and the model before keeps drawing while a new one waits to load. Before, one failure stopped either module until the page was reloaded.

`OnnxModel.js` also downloads a model before making a session from it, so a download that fails fails the load. A session made from the url used to fail on WebGPU instead, which sent every model after it to WASM for good.

Checked in headless Chrome, with the failures put in by the test:
- **Runs:** three failed runs were tried again after 1.0, 2.0 and 4.0 s, and the next ran.
- **Size:** after a run failed at 434 × 322, choosing 336 × 252 gave a map 66 ms later.
- **Downloads:** a download that failed twice with HTTP 503 was tried again after 1 and 2 s, and the model then loaded on WebGPU.

**Checked** in headless Chrome on an M2 Max, with Vermeer's *Girl with a Pearl Earring* coming in from Image:
- **Against ORT in Python:** the pixels each run was given went through the same model in ONNX Runtime 1.24 on the CPU. On WebGPU, at 238 × 182, 336 × 252 and 686 × 518, the depth correlates at 0.9995–0.9999, and the map as drawn differs by a mean of 1.7–2.7 levels, since WebGPU runs the model in fp16. On WASM, at 336 × 252, it correlates at 0.99999, and differs by a mean of 0.3 levels. ONNX Runtime 1.24 on the CPU loads this model only with its `SimplifiedLayerNormFusion` optimization turned off. ORT Web 1.30 loads it as it is, on both backends.
- **Invert:** with Grey, the output with Invert off and on adds up to 255, to within a level.
- **Patches:** a node saved with Size 518 × 392, Color Turbo and Invert On loads with them, and saves them again.

**Cost.** On WebGPU, inference takes 18 ms at 238 × 182, 21 ms at 336 × 252, 33 ms at 434 × 322, 38 ms at 518 × 392 and 87 ms at 686 × 518. On WASM at 336 × 252 it takes 0.31 s with the page cross-origin isolated (4 threads, see Cross-Origin Isolation), and 1.0 s on one thread. On the main thread a frame costs about 1 ms. A node's first frames cost more, once: compiling its two shaders (about 40 and 25 ms), and its first readback (95 ms), while ORT sets the model up on the GPU.

## Pix2Pix Module

The Pix2Pix module (`js/modules/Pix2PixModule.js`, `js/shaders/pix2pix.js`) runs pix2pix generators (Isola, Zhu, Zhou and Efros, 2017) trained for Latk, as Latk's `latk_ml` add-on ran them. Most turn pictures into line art. Contour turns line art into a shaded picture. It shares InfrDrawings' ONNX Runtime loader and run queue (`js/modules/img2img/OnnxModel.js`). The evaluation behind it is in `docs/REPORT_PIX2PIX.md`.

**Models.** Each is pix2pix's `unet_256` generator: 54.4 M parameters, a fixed 256 × 256 RGB input in −1..1, and RGB out in −1..1. They live in `files/models/pix2pix/`, 54.5 MB each, and are loaded the first time a node picks one, then shared by every node. `tools/pix2pix-onnx.py` made them from Latk's fp32 ONNX exports (217.7 MB each) and PyTorch checkpoints. It exports a checkpoint first, through its own copy of pix2pix's `unet_256`, in eval mode, as Latk ran it:
- **BatchNorm folded:** each of the 7 BatchNormalizations is folded into the ConvTranspose before it. The deepest one's `running_var` reaches 207,805, above fp16's 65,504, and `onnxconverter-common` clamps anything over 10,000 to 10,000 without asking. Converted unfolded, pix2pix 004 came out a mean of 8 levels off, and up to 194.
- **fp16:** the model runs in fp16, with float32 input and output.
- **int8 weights:** each Conv and ConvTranspose weight is stored as int8, one scale per output channel, behind `DequantizeLinear` and a `Cast` to fp16. In fp16 alone a model is 108.8 MB, over GitHub's 100 MB limit on a file.

The module creates its sessions with the config entry `session.disable_quant_qdq = '1'` (`loadOnnxModel(url, options)`), so ORT turns the weights back into fp16 once, when the session starts. Without it ORT keeps the `DequantizeLinear` nodes and runs them every time, which took a run from 14.2 to 17.7 ms on WebGPU.

**Params.**

| Param | Label | Options | Default | Sets |
| --- | --- | --- | --- | --- |
| `model` | Model | Neural Contours, pix2pix 003, pix2pix 004, pix2pix 002-001, pix2pix 002-002, pix2pix 002-004, Contour, Contour Reverse | Neural Contours | The generator (see What each draws) |
| `mode` | Mode | Default, Invert, Color | Default | Default is the drawing as it comes. Invert inverts it. Color gives the lines in the input's colours, on black, whichever way round the model draws them |

Patches save Model as its index, so a new model is appended, never inserted.

**What each draws.** On a photo, and on a DepthAnything map of it (Latk could feed any of them its render or a depth pass, near white):

| Model | Checkpoint | Draws |
| --- | --- | --- |
| Neural Contours | `neuralcontours_140` | Thin dark contours on white. On depth, clean outlines |
| pix2pix 003 | `pix2pix003-002_140` | Thick light lines on black, with grey fill. On depth, clean light outlines |
| pix2pix 004 | `pix2pix004-002_140` | Bold dark lines on white with coloured fringes. On depth, noise |
| pix2pix 002-001 | `pix2pix002-001_60` | Soft grey shading and lines on white. On depth, shaded relief |
| pix2pix 002-002 | `pix2pix002-002_60` | Bold dark lines on white. On depth, outlines with patterned fill |
| pix2pix 002-004 | `pix2pix002-004_60` | Pale grey shading on white. On depth, embossed outlines |
| Contour | `contour_pix2pix_195` | Takes light lines on black and paints a shaded, sculpted picture, as from pix2pix 003. Dark lines, photos and depth give stripes and noise |
| Contour Reverse | `contour_reverse_pix2pix_195` | Thick light strokes on black, from line art or depth. On a photo, grey blobs |

`pix2pix002-003_60` was converted too, but isn't on the menu. It draws a checkerboard over photos, depth and line art alike. PyTorch draws the same from the checkpoint, so the conversion isn't the cause. Its file is in `files/models/pix2pix/`.

**Running.** A frame goes through InfrDrawings' four stages:
1. **Input:** the frame is squashed to 256 × 256, as Latk did, with InfrDrawings' input shader.
2. **Reading:** it comes back through a fenced pixel buffer.
3. **Drawing:** its pixels are scaled to −1..1 (`x / 127.5 − 1`), in RGB order, as pix2pix trained. Latk passed Blender's RGB pixels through OpenCV's `COLOR_BGR2RGB`, so it gave the models BGR, which changes the drawing by a mean of 3–10 levels.
4. **Output:** the drawing is mapped back to 0..255 (`(y + 1) × 127.5`), uploaded, and stretched back to the canvas by `pix2pixOutputFrag` in the Mode chosen. Each model's `light` flag tells Color which way round its lines are. Contour's picture counts as light, so Color multiplies it by the input.

The newest frame waits while the model runs, and older ones are dropped. Model switching, `Backoff` after a failed load or run, and the previous model drawing while a new one loads all work as in InfrDrawings. The UNet needs both sides to be a multiple of 256. A 1024 × 768 copy ran (85 ms on WebGPU), but its 4 × 3 bottleneck sees far less of the picture than the 1 × 1 one the models trained with, and covered the drawing in speckles and cross-hatching, so the module stays at 256 × 256.

**Checked** in headless Chrome on an M2 Max, with Vermeer's *Girl with a Pearl Earring* coming in from Image:
- **Against ORT in Python:** the pixels each run was given went through the fp32 export in ONNX Runtime 1.31 on the CPU. On WebGPU, at pixel density 1 and 2, the drawings differ by a mean of 0.34 levels (Neural Contours), 0.95–0.96 (003) and 0.93–1.06 (004), with up to 3.8%, 12.9% and 14.0% of values more than 2 levels off and at most 51. On WASM the means are 0.25, 0.90 and 0.89. At 1× the drawings look the same as fp32. Their differences, scaled by 4, show only as faint edges.
- **Orientation:** the model's input correlates with the Image node's output, squashed, at 0.9987 (0.18 flipped), and the output with the drawing scaled up at 1.0000 (0.15–0.23 flipped).
- **Mode:** Default and Invert add up to 255, to within a level. Color is within a level of the lines times the input, for light and dark models.
- **Checkpoints:** each checkpoint's export matches pix2pix's own `UnetGenerator`, from Latk's copy of the code, to within 2.6 × 10⁻⁵, and has the same operators as Latk's ONNX exports. Against PyTorch, on WebGPU at density 1, the five on the menu differ by a mean of 0.57 (002-001), 0.66 (002-002), 0.65 (002-004), 1.38 (Contour) and 0.57 (Contour Reverse) levels, with at most 53.
- **Patches:** nodes saved with Model pix2pix 004 or Contour Reverse, and Mode Invert, load with them.
- **Other models:** with DepthAnything, InfrDrawings and Pix2Pix fed the same picture on WebGPU, they gave 62, 63 and 62 results in 4 s. DepthAnything and InfrDrawings output the same bytes as before `loadOnnxModel()` took options.

**Cost.** On WebGPU a run takes 14–16 ms, so with nothing else running the module keeps up with the frame rate: 232 results in 4 s. Every model costs the same: they share one architecture, and with the GPU busier, all took 29–31 ms back to back. On WASM, through the proxy worker with the page cross-origin isolated, it takes 115–135 ms. On the main thread a frame costs about 1 ms, at pixel density 1 or 2. Creating a session takes about 0.4 s. A model's session, once loaded, stays for the rest of the page's life, as InfrDrawings' do. Its weights are back in fp16 by then, so each model should hold about 109 MB of GPU memory, though this wasn't measured.

## Edges Module

The Edges module (`js/modules/EdgesModule.js`, `js/shaders/edges.js`) is a utility filter porting the four operators from the edge-detection-research project into one shader, selected by the `mode` drop-down:

| mode | Label | Operator |
| --- | --- | --- |
| 0 (default) | Refine Contour | Sobel magnitude through a sigmoid `1/(1+exp(-10*(mag - threshold)))`, giving continuous anti-aliased contour lines rather than a binary mask |
| 1 | Scharr | 3x3 Scharr gradient magnitude, hard-thresholded; better rotational symmetry than Sobel on diagonals |
| 2 | Quantum Walk | 5-tap discrete Laplacian (from arXiv 1411.3958), hard-thresholded on absolute response |
| 3 | Grayscale (debug) | Passes through the luminance the other three operate on, for checking the input signal |

`threshold` is normalized 0-1 (the original's 0-255 slider divided by 255) and means something different per mode, so it is left to the user rather than reset on a mode change - resetting it would also fight any parameter cable patched into the knob.

**Port note:** the reference shaders sampled the red channel (`.r`) for every gradient operator, which is harmless for a webcam feed but wrong downstream of LICHEN's saturated color sources. All four operators here run on luminance instead, using the same `(0.299, 0.587, 0.114)` weights the original grayscale shader defines.

## VideoMixer Module

The VideoMixer module (`js/modules/VideoMixerModule.js`, `js/shaders/video-mixer.js`) composites input B over input A. The operation is chosen with the `mode` drop-down, which defaults to Add. `mix` acts as B's opacity: the output is `mix(A, op(A, B), mix)`, so Blend reproduces the old crossfade exactly, and `mix = 0` passes A through in every mode.

| mode | Label | op(A, B) |
| --- | --- | --- |
| 0 | Blend | B |
| 1 (default) | Add | A + B |
| 2 | Subtract | A − B |
| 3 | Multiply | A × B |
| 4 | Divide | A / max(B, 1/255), so a black B saturates any non-black A to white |
| 5 | Lighten | max(A, B) |
| 6 | Darken | min(A, B) |
| 7 | Difference | \|A − B\| |
| 8 | Color | SetLum(B, Lum(A)): B's hue and saturation, A's luminance |
| 9 | Overlay | 2AB where A ≤ 0.5, else 1 − 2(1 − A)(1 − B): multiplies A's darks and screens its lights |
| 10 | Saturation | SetLum(SetSat(A, Sat(B)), Lum(A)): B's saturation, A's hue and luminance |
| 11 | Luminance | SetLum(A, Lum(B)): A's hue and saturation, B's luminance |

Modes 0–7 and Overlay work on each RGB channel separately. Color, Saturation and Luminance are the W3C Compositing and Blending spec's non-separable modes, with `Lum` weights (0.3, 0.59, 0.11). `SetLum` brings an out-of-range result back with `ClipColor`, which pulls it toward its own grey and so keeps its luminance, instead of clamping each channel separately. New modes are appended rather than inserted, because patches save the mode as its index. `op` is clamped to 0–1 before the mix. Alpha is always crossfaded by `mix`. When only one input is connected, it feeds both A and B.

Mode used to default to Blend. A patch saved before the drop-down existed loads the default, so it now loads as Add. `burning_edges` was one, and its two VideoMixers now save Blend.

## ChromaKey Module

The ChromaKey module (`js/modules/ChromaKeyModule.js`, `js/shaders/chroma-key.js`) removes the colours near a key colour from input `fg` and shows input `bg` through the hole. R, G and B (0–1, default pure green) are the key colour. Tolerance (default 0.2) is how far from it a colour is removed entirely, and Softness (default 0.1) how far past that it fades back in.

**Distance.** Colours are compared in BT.601 YCbCr, with luma at half weight (`LUMA_WEIGHT`). Shading across a backdrop is mostly a change of luma, so it costs less than a change of hue, while greys of different brightness stay apart, as they would not in Cb and Cr alone. A sampled green screen of (30, 180, 60) is 0.10 from a greenish shirt of (70, 170, 90) and 0.38 from skin of (205, 150, 125). That is why Tolerance defaults to 0.2: at 0.3, that skin came out 94% opaque.

**Samples.** The key list is R, G and B followed by the colours added with Eyedropper +, up to 16 in all (`CHROMA_KEY_MAX`). The kept list is the colours picked with Eyedropper −, up to 16. A full list drops its oldest colour. Each pixel finds its nearest key and its nearest kept colour:
- **Removed:** alpha rises along a smoothstep from 0, at Tolerance from the nearest key, to 1 at Tolerance + Softness. At Softness 0 it is a hard edge.
- **Kept:** wherever a kept colour is nearer than every key, the pixel stays, faded over Softness across the midpoint between the two. So − carves a colour out of the keyed range without shrinking it anywhere else, and a backdrop nearer the key than the kept colour stays keyed.

**Inputs.** The output is `mix(bg, fg, alpha)`. With no bg the hole is transparent black, premultiplied, which a preview shows as black. A lone bg passes through, and with neither input the output keeps its last frame, as VideoMixer's does. It is one pass: two texture reads a pixel, and a distance to each sample.

**Fullscreen interaction.** Double-click the node preview to enter fullscreen, which shows the output. A toolbar holds three eyedroppers, a swatch of the key colour, and the counts of added and kept colours:
- **Eyedropper:** a click sets R, G and B to the colour under it and clears both lists, which starts the key over.
- **Eyedropper +:** adds the colour under it to the key list.
- **Eyedropper −:** adds it to the kept list. Clicking where the key has eaten into the subject brings that colour back.

Each click samples `fg`, not the output, as the mean of the 5 × 5 logical pixels round it (Photoshop's 5 by 5 Average). The click is queued, and the next `process()` draws the mean into a 1 × 1 framebuffer with `chromaKeyPickFrag` and reads that pixel back, waiting on the GPU once per click. Sampling through a shader reads any input, whatever its size, format or antialiasing. ESC exits. `js/ui.js` routes the click to `handleMouseDown()` as it does for Conway. The toolbar stops its own mouse events, as the drop-down menu does, so clicking it picks nothing. A cable on R, G or B overrides the Eyedropper.

A double-click in fullscreen used to reach the hidden graph, where it could open a param editor or fullscreen another node under the pointer. Picking colours in quick succession made that easy to hit, so `mouseDoubleClicked()` now stops there for every fullscreen module. Latk still resets its camera.

**Patches.** R, G, B, Tolerance and Softness save as params. The two lists save as the node's `state` (see Patch IDs), so a patch reloads the key it was saved with, and duplicating the node copies them.

**Checked** in headless Chromium on a Raspberry Pi, through SwiftShader, at pixel density 1 and 2:
- **Against a model:** fg was a sweep of 307,200 colours round green, and bg a solid red. A JS model of the formula, in double precision, matched the output to within one level on every value: at the defaults, with a hard edge (Tolerance 0.15, Softness 0), with two added and two kept colours, and with no bg. The exception was one value two levels off, on the hard edge at density 2. A lone bg passed through exactly.
- **Eyedropper:** real mouse events picked each flat region's colour exactly, and the top and bottom of the picture the right way up. Across an edge they picked the mean of the 3 and 2 rows either side, to within one level. − on the greenish shirt brought it back and left the screen keyed, and + on the skin removed it. A click on the toolbar switched tools without picking.
- **Patches:** a patch with both lists saves, loads and saves again as the same JSON, and a duplicate gets its own copies of them.
- **Workflows:** all twelve load and run with no exceptions.

## Matte Module

The Matte module (`js/modules/MatteModule.js`, `js/shaders/matte.js`) composites input `fg` over input `bg` through a matte taken from input `a`. The `matte` drop-down picks what the matte is: Alpha (the default) is `a`'s alpha channel, and Luma is its BT.601 luma, (0.299, 0.587, 0.114). The output is `mix(bg, fg, matte × mix)`, so Mix (0–1, default 1) fades fg in over bg, and Mix 0 passes bg through.

**Choke** (−20 to 20, default 0) is in logical pixels. A positive value chokes the matte: each pixel takes the matte's minimum over a square that many pixels either side, which pulls the edge in and erases specks and lines narrower than twice that. A negative value spreads it with the maximum instead. It works like a simple choker, so a soft edge moves without changing its softness. The square is two separable passes:
- **Across:** `matteChokeFrag` takes the matte from `a` and its extreme along x into a working buffer, as red. The buffer is made the first time Choke leaves 0.
- **Down:** `matteFrag` takes the buffer's extreme along y, then composites.

Taps are a physical pixel apart, so at density 2 a one-pixel line can't fall between them. A fractional radius blends the next tap out in by its fraction, so the edge moves smoothly as the knob turns. A radius stops at 64 physical pixels (`MATTE_MAX_TAPS`). Choke 20 is 60 at density 3, so only a typed value reaches the limit. At Choke 0 the first pass is skipped, and `matteFrag` reads the matte from `a` directly.

**Inputs.** As in ChromaKey, with no bg the hole is transparent black, premultiplied. With no `a`, fg is its own matte, so Luma keys fg by its own brightness. A lone bg passes through, and with neither fg nor bg the output keeps its last frame.

**Checked** in headless Chrome on an M2 Max, at pixel density 1 and 2. fg was a colour sweep, and `a` a soft disc with lines one and two pixels wide and specks in its RGB, and a different pattern in its alpha. A JS model of the two passes, in double precision with the working buffer rounded to 8 bits, matched the output to within one level on every value. The cases were Alpha and Luma at Choke 0, ±3, 2.5, −0.7, 0.3 and ±20; Mix 0, 0.37, 0.5 and 0.8; no bg; no `a`; a lone bg; and a typed Choke of 100. A patch saves and loads again as the same JSON.

## Inpainter Module

The Inpainter module (`js/modules/InpainterModule.js`, `js/shaders/inpainter.js`) fills the transparent areas of its input from the colours round them. It is ported from the Processing sketch in the KINECT project's `Inpainter/`, whose shader is Ruofei Du's Shadertoy 4ty3Dy: jamriska's Laplacian solver, after Jeschke et al. 09. That sketch took its holes from a separate mask image. Here the input's alpha is the mask: a pixel whose alpha is at least Threshold (0.01–1, default 0.5) is known, and the rest are holes. So Crop's and Transform's outside, ChromaKey's and Matte's holes, and anything else with alpha below Threshold get filled.

**The fill.** It is the membrane interpolant of the known colours: the solution of Laplace's equation with the known pixels fixed, and the frame's edge left free. That is what the Shadertoy's solver converges to, but it takes about 128 frames on a still image, and with video its holes would smear. This module solves it every frame on a pyramid of half-float buffers at density 1, halved and rounded up to 1 × 1:
- **Seed:** the input as each known pixel's own colour (rgb / alpha, since colours are premultiplied) with weight 1, and holes as weight 0.
- **Pull:** each level is the weighted mean of the 2 × 2 below it, with weight min(1, Σw), as in Gortler et al.'s pull-push.
- **Push:** from the top down, each level is its known colour over the solved level above, read bilinearly, then Smooth (0–32, default 4) Jacobi steps of Laplace's equation, which keep each texel's known share fixed.

**The output** is the input over the fill, `rgb + (1 − alpha) × fill`, and is opaque. A known pixel's fill is its own colour, so it comes back unchanged, and a soft edge with alpha below Threshold fades into the fill. View (Inpainted, the default, or Mask) shows the mask instead: white where known and black where filled. With no input the output keeps its last frame. An input with nothing known fills black.

**Cost.** Every level takes Smooth + 2 passes, about 11 levels at the default frame, and at this size the draws, not the pixels, take the time. In headless Chrome on an M2 Max, a frame took 2.1 ms at Smooth 4 and 3.5 ms at Smooth 8, nearly the same at density 1 and 2.

**Checked** in headless Chrome, at pixel density 1 and 2. The input was a colour pattern with four holes: a hard disc, a soft-edged disc, a line 6 pixels wide and a corner box against the frame's edge. Against an exact sparse solve of the same equation (SciPy), the hole pixels' mean error was 15 levels at Smooth 0 (plain pull-push), 6 at 4, 4.5 at 8 and 3.6 at 16. Known pixels matched the input on every value, and Mask matched the threshold on every pixel. A Transform turned 30° and scaled 0.5 × 0.6 filled the 70% of the frame round it, with its opaque pixels unchanged. A frame resized to 1280 × 720 kept working, and a patch saves and loads again as the same JSON. Two things were tried and dropped: weighting a coarse texel by its share known (Σw / 4) doubled the error, and giving level k 2^k times Smooth's steps cost as much as raising Smooth for the same accuracy.

## OpticalFlow Module

The OpticalFlow module (`js/modules/OpticalFlowModule.js`, `js/shaders/optical-flow.js`) measures dense optical flow between consecutive frames of its input: for every pixel, how far it moved since the last frame. It is pyramidal Lucas-Kanade, ported from the lk-optical-flow sketch, all in fragment shaders. Flow is in pixels of the logical frame, +x right and +y down, and says where a pixel came from: `curr(x) ≈ prev(x − f)`.

**Pipeline, each frame:**
1. **Pyramid.** The input's luma is blurred by a separable 5-tap Gaussian into level 0, and each level after it is a 2×2 box of the one before, to five levels. Level 0 is the logical frame at density 1, so the work doesn't grow 4× on a retina display. The pyramid is always built to five levels, so changing Levels never finds the previous frame's pyramid short a level. The current and previous pyramids swap each frame instead of the previous one being rebuilt.
2. **Gradients.** Each level used gets the current frame's central-difference `Ix`, `Iy` once, with its luma alongside in the same texel.
3. **LK, coarse to fine.** From the coarsest level used down to level 0, each level starts from the coarser level's flow, scaled by the two levels' size ratio. Each pass matches the window round a pixel against the previous frame shifted by that pixel's flow so far, the same shift for the whole window (Bouguet). It solves the Gaussian-weighted 2×2 system `A d = b` and adds `d`. Iterations runs this pass that many times a level, each from the last, with the window shifted again.
4. **Smooth** mixes level 0's flow with last frame's result: `mix(now, last, smooth)`.
5. **View** draws the output, and the input is copied to keep for Warp.

The first frame, and the first after a resize, is compared with itself, so it shows no motion.

**Params:**

| Param | Range | Default | |
| --- | --- | --- | --- |
| View | drop-down | Arrows | See below |
| Levels | 1–5 | 4 | Pyramid levels used. Motion much beyond about 2^Levels pixels a frame is missed |
| Window | 3–15, odd | 9 | LK window, in texels of each level |
| Range | 1–100 px | 15 | Speed shown at full colour, and the ±full scale of Vectors |
| Spacing | 8–64 px | 16 | Distance between arrows |
| Texture | 0–8 | 0.5 | Grey levels a texel luma must change by in a window's flattest direction for its motion to be solved |
| Iterations | 1–5 | 2 | LK passes a level |
| Smooth | 0–0.99 | 0 | Temporal smoothing of the flow |

**Views:**

| View | Shows |
| --- | --- |
| Color | Hue by direction, saturation by speed (full at Range). Still areas are grey |
| Magnitude | A heat ramp of speed |
| Arrows | One arrow a Spacing cell over the input, coloured as Color, two cells long at Range |
| Warp | The previous frame pulled along the flow, `prev(x − f)`, mixed 65/35 with the current frame. Where the flow is right this matches the current frame |
| Vectors | x in red, y in green, encoded as Displacer reads them: 128 is still, 0 and 255 are −Range and +Range (127/128 of it). Blue is 128 |

**Into Displacer.** Cable Vectors to Displacer's `map`, with X From Red, Y From Green, and X Max and Y Max equal to Range. With the current frame in `in`, Displacer then outputs `curr(x + f)`, which is the previous frame again; with −Range it pushes the picture on along its motion. In the check below, the previous frame came back within 0.11 levels on average.

**Arrows on the GPU.** The sketch read the flow back with `loadPixels()` and drew arrows with p5 lines, which stalls the GPU every frame and can't export (strokes aren't in node-gles3's runtime). Here the view shader draws them. An arrow is capped at two cells long, so a pixel tests only the arrows of the 5×5 cells round its own, against three segments each, antialiased to one device pixel.

**Changes from the sketch:**
- **Window shifted as a whole.** The sketch corrected `It` by the prior flow to first order (`It + Ix·pf.x + Iy·pf.y`), which falls apart for the large priors the pyramid hands down. Warping each window pixel by its own prior, the obvious fix, doesn't converge either: a window then solves for its pixels' mean residual, so noise in the prior field survives every iteration. Shifting the window by its centre's flow, as Bouguet does, converges.
- **Smallest eigenvalue, not the determinant.** The sketch solved where `det(A) > 1e-4`. That test is in absolute units, so at full resolution on smooth texture no window passed and level 0 never refined anything (Levels 1 gave exactly zero everywhere). The module divides `A` and `b` by the window's weights and solves where `A`'s smaller eigenvalue exceeds (Texture / 255)², which also rejects edges, whose motion along the edge is unknowable. Below the threshold the coarser level's flow stands.
- **Half float.** Working buffers are half float where the context can draw to them (as in Blur and Inpainter). Otherwise they are 8 bits with signed values offset to 128, which the sketch used throughout: gradients at ±0.5 full scale, flow at ±50 px, so 0.39 px steps. Flow is held to a quarter of each level's longer side, or ±50 px in 8 bits.
- **Not in the sketch:** Iterations, Texture, Smooth, Vectors, and the size ratio between levels (the sketch doubled, which is off when a level's size is odd).

**Checked** in headless Chrome at pixel density 1 and 2, on a procedural texture moved rigidly by a known amount each frame, with a flat grey patch and with ±2 levels of noise. Flow was read back from Vectors at Range 32, so 0.25 px steps, away from the borders and the patch:
- **Defaults, with noise.** Translations of (1, 0), (3, 2), (12, 7) and (−20, 10) px came back with median error 0–0.25 px, and 94%, 93%, 87% and 85% of pixels within 0.5 px at density 1 (97%, 96%, 91% and 88% at density 2). Without noise, at one iteration a level, (−20, 10) had median error 0.9 px and 37% within 0.5 px; at 2 iterations 88%.
- **Texture.** At Texture 0, noise made up flow inside the flat patch, wrong by a median 3–31 px, more than the motion itself. At 0.5 the patch read as still, which is all a textureless area can say. On this deliberately smooth texture, Levels 1 solves little at Texture 0.5. Real footage is busier at level 0.
- **8 bits.** The 8-bit fallback came within 0.5 px on 80–98% of pixels.
- **Rotation.** The field turned round the point where rotation and translation cancel, where it should.
- **Elsewhere.** A resize to 1280×720 reallocated the buffers and stayed as accurate (99.5% within 0.5 px). A patch saves its params by id. Exported to node-gles3 with SpiralGalaxy as the source, after 60 frames at a fixed 30 fps the output matched Chrome's within 16 levels, and within 8 on all but 0.03% of pixels.

**Cost.** On an M2 Max at defaults, about 0.5 ms a frame at 640×480; Window 15 costs about 2 ms. LK is 2–3 fetches per window texel per iteration, so cost grows with Window², Iterations and the frame's area.

## VideoToasting Module

The VideoToasting module (`js/modules/VideoToastingModule.js`) ports the 14 NewTek Video Toaster transitions from the VideoToasting project. Each effect's shader has two buses, A for the outgoing source (the Toaster's Main bus) and B for the incoming one (its Preview bus), and wipes between them on its own loop. The `effect` drop-down picks the effect, `speed` scales its clock, and `inputCount` (Inputs) sets how many video inputs the node has, from 2 to 6, named A–F. With more than two connected, the module steps through them, two at a time. As in VideoMixer, a lone input feeds both buses.

**Inputs.** The knob shows the first n of `INPUT_PORTS`. Inputs share one row across the node, and past six their ports' hit areas overlap. A and B kept their ids, so a patch saved before the knob loads with those two:
- **Cables:** the knob won't remove a port with a cable in it. `setParam()` keeps the count at least `portsInUse`, which `process()` counts each frame. Nothing else drops a cable on a port that has gone, and `toJSON()` would throw on one. A patch's params load before its cables, so a saved cable on F finds its port.
- **Ids:** `checkIds()` sees only the ports a new node has, A and B, so the ids of C–F aren't checked at startup.

**Stepping through inputs.** The buses take two of the connected inputs, in port order, skipping empty ports. Each effect in `js/shaders/videotoasting/index.js` says how. Its clock is cut into segments of `segment` seconds, segment k starting at `offset + k × segment`, and each effect is one of two kinds:
- **Chain** (Push/Pull, Swap, Neon Bands, Camera Iris, Tumble, Blinds 3 Expand): segment k takes input k to input k + 1, with input k on the bus `outgoing` names for it, its letters taken in turn. Each segment starts on the picture the last one ended on, so the inputs follow one another with no cut but Tumble's own. Push/Pull, Swap and Neon Bands end on B alone and start on A alone; Camera Iris closes from B onto A and opens from A onto B; Blinds 3 Expand passes through black; and Tumble's buses each change half way through the other's turn.
- **Reveal** (the other eight): A stays on the first input, and B shows the next of the rest each segment. B changes unseen in Bear and Giraffe, while the shape is off screen, and in Squeeze/Zoom, as its frame shrinks through nothing on its way to flipping. Elsewhere B is always on screen, so its change is a cut in B's part of the frame: in Blinds as the slats jump back at the wrap, in Split and Trajectory where B is smallest (a fifth of the frame, and a 0.2-wide box), and in Trails and Transporter in the blob.

`uTime` reaches the shader as a 32-bit float, so the module picks the buses from `Math.fround(time)`. A chain effect's wrap and its bus change then fall on the same frame. Picked from the 64-bit time, a frame just before the wrap can show the input after next.

**Two inputs.** With two inputs, the reveal effects, Tumble and Camera Iris give the same output as before the Inputs knob on every pixel. Push/Pull, Swap, Neon Bands and Blinds 3 Expand now go back from B to A on every other loop, where they used to jump back to A at the wrap.

Checked in headless Chrome on an M2 Max, with solid-colour inputs sampled on a 64 × 48 grid every frame:
- **Against the old module:** at two inputs, with ports C and D empty, for 8 s of each effect. The differences are the four above, from their second loop on.
- **Order:** with up to four inputs, every effect shows them in order. At three and four, its biggest one-frame cut and the biggest share of a source appearing from nowhere match its two-input ones, except the reveal cuts above. Started at 36000 s, the results were the same.
- **Boundaries:** at the 32-bit floats either side of 300 segment boundaries per effect, out to about 28 hours, no frame showed a source from outside its segment. Moving Push/Pull's offset by 0.01 s, or dropping `Math.fround`, made hundreds of frames do so.

**Effect files.** Each effect is its own fragment shader in `js/shaders/videotoasting/`, kept apart from the main shaders folder. `js/shaders/videotoasting/index.js` lists them in the order of the VideoToasting project's `index.html`, and that list supplies the drop-down's options. Patches save the effect as its index, so a new effect is appended to that list, never inserted. The module creates one p5 shader per effect, and since p5 compiles a shader the first time it is bound, an effect costs nothing until it is chosen.

**Port notes.** The shaders are the originals with three changes: precision is `highp`, the unused `uResolution` uniform is gone, and `uTime` is an accumulated clock (`time += dt × speed`) instead of `frameCount × 0.016`. At speed 1 it runs in seconds, which matches the originals at 60 fps, and turning Speed doesn't jump the effect. Both projects sample with `vTexCoord.y = 0` at the top of the image, so nothing needed flipping. As in the originals, shapes are drawn in uv space without aspect correction, so the circles in Bear, Camera Iris, Trails and Transporter stretch to the frame.

## Displacer Module

The Displacer module (`js/modules/DisplacerModule.js`, `js/shaders/displacer.js`) works like After Effects' Displacement Map. It displaces input `in` by the brightness or colour of input `map`. Each output pixel reads one channel of the map at its own position and turns it into a signed amount, `d = (255 v − 128) / 128`. A map value of 0 is the full negative shift, 128 none, and 255 the full positive one (127/128 of it). The pixel then samples the input that far away:

`out(x, y) = in(x + d_x × X Max, y + d_y × Y Max)`

Sampling ahead moves the picture the other way, as in After Effects. Where the map is white and X Max is positive, the image slides left, and with Y Max positive it slides up. X Max and Y Max are in pixels of the logical frame, from minus to plus its width and height (±640 and ±480 by default, see Frame Size), so the result doesn't change with pixel density. Both default to 20.

**Channels.** `xChannel` (X From) and `yChannel` (Y From) pick the channel that drives each axis. Their options follow After Effects' "Use For" menu, in its order. Patches save the option as its index, so a new one is appended, never inserted.

| Option | Amount from |
| --- | --- |
| Red, Green, Blue, Alpha | That channel. X defaults to Red and Y to Green, as in After Effects |
| Luminance | `(0.299, 0.587, 0.114)` weights |
| Hue, Lightness, Saturation | HSL |
| Full | The full positive shift everywhere, so the whole image slides by X Max and Y Max |
| Half, Off | No shift |

**Edges.** The `edges` drop-down says what a pixel sampled from beyond the frame shows. Clamp (the default) repeats the edge pixels. Wrap tiles the input, which is After Effects' Wrap Pixels Around. Mirror reflects it, and Black shows opaque black. Wrap shows a seam one pixel wide, because the input textures clamp at their edges, so the bilinear filter can't blend across the join.

**Inputs.** A lone input feeds both, as in VideoMixer, so a video connected on its own displaces itself. After Effects' Displacement Map Behavior (centre, stretch or tile the map) and Expand Output have no counterpart here, because every module's output covers the same frame.

**Checked against a model.** The comparison ran in headless Chrome at 640×480. The input held each texel's own uv in a float buffer, so the output read back exactly where every pixel had sampled. That was compared with a JS model of the formula on a map of coloured blocks, grey columns and rows pinned to 128 and 255. Every channel on both axes, and every edge mode at shifts up to a whole frame, matched to within 0.002 px. The exceptions were 80 pixels in Wrap and 48 in Black. All of them sample within 0.00003 px of the frame's edge, so float32 and float64 rounding land on opposite sides of it.

## LUT Module

The LUT module (`js/modules/LUTModule.js`, `js/modules/lut/clf.js`, `js/shaders/lut.js`) applies a colour transform loaded from a Common LUT Format file (`.clf`). It reads Academy/ASC CLF v2 and v3 and SMPTE ST 2136-1. "Load LUT…" opens a file picker, and the button then shows the loaded file's name. `mix` blends from the input (0) to the fully transformed image (1). As with Image and VideoPlayer, the file itself is not saved in patches.

**Presets.** The LUT drop-down (`preset`) picks between the file loaded with the button and the LUTs bundled in `files/luts/`. Option 0 is that file: it reads "None" and passes the input through until a file is loaded, then takes the file's name, and loading a file switches the menu to it. The other options are the `PRESETS` list in `LUTModule.js`, since a static server can't list a directory. Patches save the preset as its index, so a new file is appended to that list, never inserted. Unlike a loaded file, a preset is restored when a patch loads. A preset is fetched and baked the first time any LUT node selects it (about 70 ms for the bundled 25³ files), and the bake is then shared by every node for the rest of the session. The previous LUT stays on until the new one is ready, and a choice that finishes loading after a newer one is dropped, so a cable sweeping the menu always lands on its latest option.

**Reading.** `parseCLF()` parses the XML ProcessList into ops whose parameters are normalized to 0–1, with each node's `inBitDepth`/`outBitDepth` scaling folded in. It covers all seven CLF node types: Matrix, LUT1D (including `halfDomain` and `rawHalfs`), LUT3D (trilinear or tetrahedral), Range, Log, Exponent and ASC_CDL, plus CLF v2's two-entry IndexMap. It validates files the way OpenColorIO's reader does and throws a `CLFError` that names the problem; the module shows that message in an alert and keeps the previous LUT. `compileCLF()` then turns the ops into one function that transforms an RGB value.

**Baking.** The GPU never runs the individual nodes. When a file loads, the module runs that function once per point of a 65×65×65 lattice, which takes about 15 ms for a typical file and 230 ms for the longest chain in OpenColorIO's test files. The result is stored as an 8-bit texture atlas of 65 blue slices. `js/shaders/lut.js` is one fixed shader: bilinear texture filtering interpolates red and green within a slice, and mixing the two neighbouring slices adds blue. Every pixel therefore costs two texture fetches, however many nodes the file chains together.

**Accuracy.** Checked against OpenColorIO 2.5.2 on its CLF test files (`tests/data/files/clf` in the OpenColorIO repo):
- **Reader, before baking:** matches OpenColorIO to about 1e-6 on all 42 files it loads, and rejects all 37 illegal ones.
- **After baking, on 8-bit input:** most files land within 1–3 code values, with a mean under 0.5.
- **Steep curves:** a curve that bends faster than the lattice spacing is approximated. The x^0.45 test curve is off by up to 11 code values near black, and two deliberately extreme test curves by up to 93.
- **Range:** input outside 0–1 is clamped, but LICHEN's 8-bit video never leaves that range.

## Dither Module

The Dither module (`js/modules/DitherModule.js`, `js/shaders/dither.js`) quantizes its input to `levels` steps. The `mode` drop-down chooses how: Bayer (an 8×8 ordered threshold matrix), Blue Noise (a noise threshold built from three octaves of interleaved gradient noise), or Error Diffusion.

The `color` drop-down chooses what is quantized:

| color | Label | Quantizes |
| --- | --- | --- |
| 0 (default) | Grey | Luminance, with weights `(0.299, 0.587, 0.114)`, so the output has `levels` grey steps |
| 1 | RGB | Each channel separately, so 2 levels gives the eight colours of 3-bit RGB |

Grey is the default because Dither only quantized luminance before RGB was added, and a patch saved then has no `color` to restore. Measured in headless Chrome, Grey matches that luminance-only version on every pixel, in all three modes. The shaders do Grey by copying luminance into all three channels and then running the RGB path. Every mode uses the same threshold for all three channels at each pixel, so a grey input stays grey in RGB too.

**Error diffusion runs in parallel.** True Floyd–Steinberg is sequential: each pixel waits for the pixels above it and to its left. Here every pixel runs at once. An init pass quantizes each pixel and stores each channel's error in RGB (as `error * 0.5 + 0.5`). Then `passes` ping-pong passes each re-quantize `original + ditherStrength × error`, where the error is gathered with Floyd–Steinberg weights from the left, top-left, top and top-right neighbours of the previous pass. The error fills all three channels of the ping-pong buffers, leaving no room for the quantized colour, so the last pass writes that colour straight into `outputFBO` instead of its error.

**Noise stops flat areas moving in lockstep.** Because every pixel updates at once, a flat area gathers identical error everywhere. The whole area then flips between black and white from pass to pass, which rendered smooth gradients as solid rings. Both passes therefore add a fixed per-pixel threshold offset (`THRESHOLD_NOISE`, up to ±0.625 of a step) so neighbours decide differently. The offset is hashed from `gl_FragCoord`, so a static input dithers to the same pattern every frame.

**It is still an approximation.** Measured on 8×8 block averages, each channel tracks tone about 30% better than Blue Noise at 2 levels. It still carries 2.5–3× the block error of sequential Floyd–Steinberg, because error only travels a few pixels in 4–8 passes. The strength was tuned against those measurements: weaker lets flat areas fall back into lockstep, and stronger drowns the error feedback in noise. Fading the offset out over the passes, or drawing fresh noise each pass, both measured worse.

## LuminanceDelay and Slitscan Modules

Both modules implement time-based effects that require random access to a ring buffer of past input frames. The original WebGL2 reference (ShaderPadTests `slitscan-slow-luminance.html` and `slitscan-wiggle-spatial.html`) stores history in a `sampler2DArray`, which isn't available in WebGL1. LICHEN emulates this with a 2D **tile atlas**: a single framebuffer holding an 8×8 grid of 64 downscaled history frames (tile size = `glCanvas / 4` per axis, so the atlas is `glCanvas.width × 2` by `glCanvas.height × 2`). A new frame size resizes both atlases and clears them (see Frame Size).

**Ring buffer write:** Two atlases ping-pong each frame. The shared `js/shaders/atlas-write.js` shader reads the previous atlas into the new one, replacing only the pixels inside the current write tile with the upstream input. After the write pass the pointers are swapped so `atlasA` always holds the latest history.

**Output pass:**
- `LuminanceDelay` (`js/modules/LuminanceDelayModule.js`, `js/shaders/luminance-delay.js`) samples the current tile for luminance, maps it through `divisions` / `framesPerDivision` to a per-pixel frame delay, then samples the delayed tile. Negative `divisions` inverts so bright regions lag instead of dark ones.
- `Slitscan` (`js/modules/SlitscanModule.js`, `js/shaders/slitscan.js`) partitions the output along `axis` (Y or X) into `strips` bands, each delayed proportionally to its index by `delay` frames per strip.

Both modules clear their atlases on construction so the early frames show progressive fill rather than garbage memory.

## SlowscanJam Module

The SlowscanJam module (`js/modules/SlowscanJamModule.js`, `js/modules/slowscanjam/`, `js/shaders/slowscanjam.js`) passes video through the Cassette Video codec from the SlowscanJam project. Each field of the input is encoded to the stereo signal, run through Twoscilloscope's audio effects, decoded straight back, and drawn as scanlines on a fading phosphor screen. The signal carries luma on the left channel, chroma on the right (Cb and Cr on alternating lines), and sync pulses marking the field and every line. It is never played: the app's AudioContext, playback queue and waveform view are gone, and the signal exists only as the sample arrays passed from encoder to decoder.

**Params.** The first six are the app's controls, with its defaults:

| Param | Label | Range | Default |
| --- | --- | --- | --- |
| `lines` | Lines | 50–320, in steps of 10 | 200 |
| `fps` | FPS | 1–10, in steps of 0.5 | 6 |
| `lineWidth` | Line Width | 0.5–5 px | 5 |
| `brightness` | Brightness | 0.5–2 | 1 |
| `saturation` | Saturation | 0.5–2 | 1 |
| `blend` | Blend | Normal, Additive | Normal |
| `effect` | Effect | None, then Twoscilloscope's eleven effects | None |
| `fxA`, `fxB` | follow Effect | 0–1 | 0.5, 0.5 |
| `sync` | Sync | Protected, Raw | Protected |

Lines and FPS snap to their steps, so a cable rebuilds the codec only when it crosses one. A rebuild happens at the next field and resets the decoder's sync, as the app's `init()` did. Additive is the app's Blend Mode checkbox: lines add (`ONE, ONE`) instead of covering what is there. With the fade taking 5% every 50 ms, additive fields build up toward white. A line's picture lasts `2 / (FPS × Lines)` seconds less four pulse lengths, so at FPS × Lines of 2500 or more the encoder has no samples left for the picture (19 a line at 10 fps and 200 lines, against 83 at the defaults).

**Files:**
- `slowscanjam/encoder.js` is the app's `SlowscanEncoder`, CPU path, unchanged. The WebGL2 encoder is not ported, because it needs a WebGL2 context of its own per node (browsers cap them) and integer render targets that p5 framebuffers don't offer. The SlowscanJam notes measure the two encoders' signals within about 2e-7 of each other.
- `slowscanjam/decoder.js` is the app's `SlowscanDecoder`. Its sample loop is unchanged apart from how many samples a line keeps (see below). Its renderer and draw loop live in the module.
- `slowscanjam/worker.js` runs both, off the main thread, with the effects between them (see Effects).
- `slowscanjam/PixelReadback.js` reads the source picture back (see Readback below). Skeleton reads its mask with it too.

**A field goes through four stages, one at a time,** and the next starts 1 / FPS seconds after the last, once that one is through:
1. **Downsample:** the input shrinks to the encoder's source picture, 320 × Lines, with a 4 × 4 box of bilinear taps per texel. The app's source was its 320 × 150 camera canvas. The encoder reads `min(height, lines)` rows from the top, so at fewer than 150 lines the app lost the bottom of its picture. Here the picture is exactly Lines rows tall.
2. **Readback:** the picture is read into a pixel buffer behind a fence, polled once a frame, as the app's WebGLEncoder read its signal. The main thread never waits on the GPU.
3. **Codec:** the worker encodes the field, runs the effects, decodes the signal, and replies with each line's ends, height and samples.
4. **Drawing:** the next frame draws those lines.

**Effects.** The Effect drop-down and the Effect A and B knobs are Twoscilloscope's (see Audio Effects), with None first and then one option per effect. Each field's settings go to the worker with its picture. There the left channel is the effects' X and the right channel their Y, and with None on the signal reaches the decoder untouched. What each does to the picture:

| Effect | Picture |
| --- | --- |
| Low Pass | Smears the picture sideways, colour included; Resonance rings at edges |
| High Pass | Flat areas drift toward grey after each edge |
| Channel Delay | Shifts colour against brightness. A delay of a line or more moves the colour down the picture, and an odd number of lines swaps Cb and Cr |
| Echo | Ghosts: to the side under a line's length, then further down, and from earlier fields at a field or more |
| Ring Mod | Bands of contrast and saturation across the picture, like hum bars, inverting at full Depth |
| Rotate | Brightness leaks into colour and back; 90° swaps them, 180° gives a negative |
| Drive | Stronger contrast and saturation |
| Wavefold | Folds bright and dark tones back (solarization) |
| Bit Crush | Fewer brightness and colour levels |
| Sample & Hold | Blocky pixels along each line, staggered from line to line |
| Noise | Snow and colour speckle |

- **Stream:** the signal runs on from field to field, so an `EffectStream` keeps the effects' state between fields instead of restarting them as Twoscilloscope does: echoes carry over from earlier fields, and noise and Rotate's spin move on. The effects restart when the codec is rebuilt and when the option changes. Knob settings are in hertz and milliseconds, so how far an effect reaches across the picture depends on Lines and FPS. A line takes 1.67 ms at the defaults and 40 ms at 1 fps and 50 lines.
- **Protected sync:** the sync pulses (±1) share the channels with the picture (±0.5), and the decoder finds them by level. Run through most effects, they move, vanish or appear inside the picture. Protected therefore runs only the picture through the effects, with the pulses and the quiet around them fed in as 0 and put back afterwards. The worker finds the picture from the encoder's layout (`pictureMask()`), leaving out the sample at each end of a line, which the encoder's resampling filter blends with the quiet. The picture goes in doubled, so it spans the effects' full ±1 as Twoscilloscope's loops do, and comes back halved and clamped: luma to the legal ±0.5, chroma to ±0.45. The decoder reads a pulse where luma and chroma are both past half their envelope. That envelope sags to about 0.48 over a 40 ms line, so a picture clamped to ±0.5 in both channels still made false pulses at 1 fps and 50 lines, and chroma held to ±0.45 cannot.
- **Raw** runs the whole signal through the effects, so the picture rolls, tears and slips sideways wherever they break the sync.

**Checked.** Through the worker in Node, each effect was run at five knob settings, at 200 lines and 6 fps, 50 and 1, 320 and 6, and 100 and 10. With Protected, every line decoded in the same place as with no effect, in all 220 runs. With Raw, 18–34 of the 55 runs at each setting kept fewer than 90% of their lines in place. In headless Chrome on an M2 Max, with seeded `Math.random`, a virtual clock and a colour-bar source, the output with None matches commit 0ceee36 on every pixel, at pixel density 1 and 2, at three settings: the defaults, 50 lines at 1 fps, and Additive at 150 lines and 3 fps. In Node, the effects cost 0.3–1 ms a field at the defaults, and 1.5–4 ms at 1 fps.

Main-thread time per frame was at most 1 ms in each of the three cases measured: the defaults, the defaults at pixel density 2, and 1 fps with 50 lines. An earlier version did everything on the main thread with a synchronous readback, and a field cost 7 ms at the defaults and 39 ms at 1 fps with 50 lines. In the worker, a field takes 5.5 ms and 43 ms. All of these were measured in headless Chrome on an M2 Max.

**Phosphor.** The output buffer is the screen. It is never cleared: every 50 ms a black quad at 5% alpha fades it, then the new lines are drawn, as in the app's `draw()`. It is antialiased with 4 samples, which is what Chrome gives the app's canvas; p5's default of 2 coarsens the line edges. The app drew each line as an instanced triangle strip with a vertex pair per sample, and p5 has no instancing. Here each line is one quad in a fixed `p5.Geometry` of 64 quads (`SSJ_BATCH`), placed by the vertex shader from a uniform array, as Whitney's dots are. The samples go into a float framebuffer's texture, one row per line, written directly with `texSubImage2D`, since p5 can't fill a texture from an array. Each fragment converts the two samples either side of it and blends them, which gives the strip's colours. Positions are in pixels of the logical frame, so pixel density doesn't change the picture.

**Lines longer than 1024 samples.** The app kept at most 1024 samples per line. A line runs `96000 × 2 / (fps × lines)` samples, more than 1024 whenever FPS × Lines is below 187.5, and the app's WebGL renderer ended each line at the last sample kept. At 1 fps with 50 lines it drew only about the left 27% of the picture (1024 of 3840 samples). Here a line keeps twice its nominal length, since sync tracking can stretch a line to 1.5 times that. A line longer than 1024 samples is resampled to 1024 texels on upload, still spanning the whole line, which is about three texels per source pixel.

**Checked against the app.** The comparison ran the app's own classes, extracted from its `index.html`, alongside the port, on the same source picture and with the same seeded `Math.random` (the decoder's noise and the line jitter). It ran in headless Chrome at 640×480.
- **Defaults:** 0.026% of pixels differ by more than 2 levels, and none by more than 5.
- **Without MSAA in either, port drawn upside down as the app is:** every pixel is within 2 levels, at three settings (Additive at 1.5 px with Brightness 1.5, 3 fps / 150 lines, and 1 fps / 200 lines).

With MSAA at the other settings, up to 2.6% of pixels differ by more than 2 levels, for two reasons. Neither changes what is decoded:
- **Orientation:** the app draws upside down into a y-up canvas. The 4× sample pattern isn't symmetric under that flip, so a thin line's edge can cover different samples. In the additive test that brightened or dimmed a few whole lines.
- **Strip edges:** at sharp colour changes, an edge pixel of the app's strip is shaded by both neighbouring quads, each extrapolating its own colour. With the orientation matched, this left differences of up to 27 levels along the colour-bar edges, which go when MSAA is off.

## Latk Module

The Latk module (`js/modules/LatkModule.js`, `js/modules/latk/`, `js/shaders/latk.js`) is a Formats source. It plays back a Latk drawing (from the Lightning Artist Toolkit) and draws each frame as lines in its strokes' colours, seen through an orbiting camera. Its X and Y control outputs carry the frame as a loop of XY audio, which drives Twoscilloscope. Together the two are Twoscilloscope's `example-latk`, with the drawing split from the scope. The node starts with `jellyfish.latk`, bundled in `files/latk/` from `example-latk`. "Load .latk…" picks another drawing, either a `.latk` file or the JSON inside one, and the button then shows its name. As with VRML, the file itself is not saved in patches.

**Files:**
- `latk/readLatk.js` reads the drawing, in place of latk.js. latk.js bundles JSZip, and reads a global called `latk` while it parses. This reader finds the JSON through the zip's central directory and inflates it with `DecompressionStream('deflate-raw')`, as VRML does without pako.
- `latk/OrbitCamera.js` is `example-latk`'s camera without its mouse handling, which is now in the module and turns knobs.
- `latk/strokes.js` holds the example's drawing half:
  - `projectFrame()` is the example's `project()`. It puts the current frame of each layer through the camera, breaks a stroke where it goes behind the camera, and cuts it where it leaves the canvas.
  - `encodeLoop()` is the first half of the example's `encode()`, which turns those pieces into one loop of XY audio (see X and Y).
  - `XYOutputs` publishes that loop on a module's X and Y outputs each frame, and keeps the beam's place in it for knob cables. NAPLPS, RuttEtra, Skeleton and Yellowtail use it too, with `polylinePieces()`, which cuts a polyline at the canvas edge into pieces as `projectFrame()` cuts strokes. A polyline given no colour gets none on X and Y, so Twoscilloscope draws it in its default white.
  - `XYInputs` reads a module's X and Y pins as one loop, for Twoscilloscope and ESP32, and `findPieces()` finds the strokes in it: the lit runs of its blanking (see Twoscilloscope's X and Y).
  - `PointStream` packs lines for the segment shader (see Rendering).
- `latk/SegmentRenderer.js` draws a point stream. Twoscilloscope draws with it too.

**Params.**

| Param | Label | Range | Default | Sets |
| --- | --- | --- | --- | --- |
| `fps` | FPS | 0–60 | 12 | Latk frames a second, ofxLatk's rate. The clock is accumulated, so turning it doesn't jump the drawing |
| `yaw` | Yaw | −180–180° | 0 | The camera's orbit |
| `pitch` | Pitch | −89–89° | 8.6 | `example-latk`'s 0.15 rad |
| `distance` | Distance | 0.05–50 | 2.1 | Camera distance in radii of the drawing's bounding box, all frames included. 2.1 is `example-latk`'s home view, and 0.05 and 50 its zoom limits |
| `spin` | Spin | −90–90°/s | 0 | Turns the view, added to Yaw, as in VRML |
| `width` | Width | 0.5–10 px | 2 | Line width. 2 is `example-latk`'s `strokeWeight` |
| `loopHz` | Loop Hz | 1–100 | 5 | Loops a second on X and Y. A lower rate gives the drawing more samples |

**X and Y.** Each frame, `encodeLoop()` turns the drawn pieces into one loop of `44100 / loopHz` samples (rounded), as `example-latk` encoded them, and the module publishes it as the control signals `x` and `y` (see Module System):
- **Loop:** the canvas is mapped to −1..1, with +Y up. A blank sample jumps the beam to the start of each piece, then lit samples run along it at even steps. The samples are shared out by length, so the beam moves at an even speed. If the loop is too short for three samples a piece, the shortest pieces are left out.
- **Lanes:** both signals carry the loop's blanking (`z`) and each sample's stroke colour (`color`). So the strokes stay apart, and keep their colours, whichever pin either signal goes to.
- **Empty:** before a drawing loads, the loop is all blank, so the beam rests unlit in the middle.
- **Knob cables:** the numeric control values `x` and `y` are where the beam is at this moment, with the loop playing at Loop Hz, mapped to 0..1. Sampled once a frame, they jump around the drawing.

**Rendering.** The strokes are projected on the CPU, through `OrbitCamera`'s own matrices, and drawn as 2D lines with one shader:
- **Point stream:** `PointStream` turns the projected strokes into points, each with x, y and the colour of the segment to the next point (or none). `SegmentRenderer` packs them one point per texel into a float framebuffer's texture, written with `texSubImage2D` as SlowscanJam does.
- **Quads:** one `p5.Geometry` of 4096 quads (`LATK_BATCH`) is drawn as many times as the stream needs. Its vertex shader, `latkSegmentVert`, builds a quad round each segment from the texture. The quad is OsciMesh's from p5.twoscilloscope.
- **Lines:** `latkLineFrag` fills the quad with a line `width` pixels wide, with round ends, and an edge smoothed over one physical pixel. Each segment is drawn on its own, so where neighbouring segments overlap their soft edges add up, slightly more than a Canvas2D path, which is stroked once (see Twoscilloscope's checks).

Strokes are drawn in file order, later over earlier, with no depth test, as `example-latk` drew them. At 1280×960 (a retina display) on an M2 Max, a frame costs about 0.55 ms, encoding included.

**Fullscreen interaction.** Double-click the node preview to enter fullscreen. As with `example-latk`'s camera, dragging orbits by turning the Yaw and Pitch knobs (0.01 rad per pixel), the wheel zooms by turning Distance, and a double-click goes back to the home view. ESC exits. `js/ui.js` routes press, drag, release and wheel as it does for VRML, plus the double-click.

## Twoscilloscope Module

The Twoscilloscope module (`js/modules/TwoscilloscopeModule.js`, `js/modules/twoscilloscope/`, `js/shaders/twoscilloscope.js`) is the scope half of `example-latk` in the Twoscilloscope project's p5.js library. One loop of XY audio comes in on its X and Y control pins, runs through an effect chain, and is drawn back from the altered audio, as the oscilloscope beam or decoded into strokes. The Latk module's X and Y outputs bring a Latk drawing, encoded as the example encoded it (see Latk Module). With nothing cabled in, it draws nothing.

**Files:**
- `js/libraries/p5.twoscilloscope.js` is the library. It is a classic script that puts its classes on the global scope, so the module imports it only for that side effect. It is copied unchanged apart from three lines that let a worker load it (SlowscanJam's and Twoscilloscope's): with no `document`, it skips the warning about p5 and finds its own URL from `location`, and it assigns its classes to `globalThis` instead of `window`.
- `audiofx/EffectRack.js` holds the effect chain, the Effect drop-down and the knobs, which SlowscanJam shares (see Audio Effects).
- `twoscilloscope/ScopeRenderer.js` is the second half of the example's `LatkScopeRenderer`, which runs the loop through the effects and turns each view into a point stream. Its first half, projecting and encoding the drawing, is now in `latk/strokes.js`.
- `twoscilloscope/worker.js` runs `ScopeRenderer` off the main thread (see Worker).

**X and Y.** `XYInputs.read()`, in `latk/strokes.js`, makes one loop from the two pins (see Module System):
- **Loops:** a control signal on either pin sets the loop's length and sample rate. It also brings its blanking and colour lanes, X's if both pins bring a loop. A loop of another length is stretched to fit.
- **Values only:** a pin with only a 0..1 control value, such as an Oscillator's, holds it across the loop as −1..1. If neither pin brings a loop, the last Trail seconds of values, one a frame, are the loop, as on a scope with long persistence. Two Oscillators draw a Lissajous figure this way.
- **Unplugged:** a pin with nothing cabled in stays at 0, the centre.

The lit runs in the blanking are the strokes. Each is drawn in the colour of its first sample, or in white without a colour lane, where the library Oscilloscope's default is amber (hue 50). A loop without blanking is one stroke, lit from end to end.

**Params.**

| Param | Label | Range | Default | Sets |
| --- | --- | --- | --- | --- |
| `view` | View | Beams, Decoded Strokes, Original Lines | Beams | What is drawn, as the example's L key chose. Original Lines is the loop before the effects |
| `beamSize` | Beam Size | 0.5–12 px | 3 | The beam's radius |
| `intensity` | Intensity | 0–4 | 1 | The beam's brightness |
| `effect` | Effect | see below | Low Pass + Delay | Which effects are on |
| `fxA`, `fxB` | follow Effect | 0–1 | 0.625, 0.03 | Settings of the effects that are on |
| `sound` | Sound | Off, On | Off | Plays the altered loop out of the sound card |
| `trail` | Trail | 0.1–10 s | 1 | How much of a values-only input is drawn |

Loop Hz is now Latk's, since the source sets the loop's length.

**Effects.** The example chains all eleven of the library's effects and opens with two of them on: Low Pass at 1500 Hz, then Channel Delay with Y 0.6 ms late. Its panel had a slider for every setting, its E key soloed the next effect, and N turned them all off. The Effect drop-down covers the same states. Option 0 (Low Pass + Delay) is the opening chain, option 1 (None) is N, and the rest solo one effect each, in the chain's order. Patches save the option as its index, so a new one is appended, never inserted. Two knobs stand in for the panel, and their labels follow the option:

| Effect | Effect A | Effect B |
| --- | --- | --- |
| Low Pass + Delay | Low Pass cutoff | Channel Delay Y |
| Low Pass, High Pass | Cutoff | Resonance |
| Channel Delay | Delay X | Delay Y |
| Echo | Time | Feedback |
| Ring Mod | Freq | Depth |
| Rotate | Angle | Spin Rate |
| Drive, Wavefold | Gain | — |
| Bit Crush | Bits | — |
| Sample & Hold | Rate | — |
| Noise | Amount | Noise Seed |

- **Ranges:** each knob runs 0–1 across its setting's slider range in the library's panel. Cutoff, Resonance, Time, Freq, Gain and Rate are logarithmic, the rest linear. The knobs' defaults give the opening chain's 1500 Hz and 0.6 ms.
- **Defaults:** every setting the knobs aren't turning is at the library's default, and goes back to it when the knobs move on to another option, so the knobs alone decide the chain.
- **Restarts:** as in the example, `XYTransformer` resets the effects every frame and runs four loops before the one it keeps. Rotate's Spin Rate and Ring Mod's phase therefore bend the shape the same way on every frame, rather than animating it.
- **Shared:** the chain, the drop-down and the knobs are in `audiofx/EffectRack.js`. Moving them there changed nothing: every Effect option in Beams, and every view with None and with Low Pass + Delay, match commit 0ceee36 on every pixel, at pixel density 1 and 2 (headless Chrome, Latk frame 0).

**Rendering.** The example drew the beam with OsciMesh into a WEBGL canvas of its own and copied that onto the sketch with `image()`. A second WebGL context per node would run into the browser's cap on contexts, which SlowscanJam also avoids. So the module draws in LICHEN's own context with Latk's `SegmentRenderer`, from the point stream of each view:
- **Beams:** the fragment shader, `twoscilloscopeBeamFrag`, is OsciMesh's erf-integrated gaussian, taking its colour per segment, drawn with `blendMode(ADD)`. The example drew one OsciMesh per colour, joining each run of lit samples to the one before with a segment of brightness 0. A dark segment adds no light, so the stream leaves those out.
- **Decoded Strokes:** each stroke's samples, from its blank sample on, are decoded on their own, so that whatever the effects made of them keeps the stroke's colour. They are drawn as Latk's lines, 2 pixels wide.
- **Original Lines:** each stroke's lit samples before the effects, as Latk's lines. From Latk, these are its strokes resampled at even steps along them, where the example drew the projected strokes themselves.

**Checked against the example.** The comparison ran in headless Chrome, with the example's canvas resized to 640×480, its clock stopped, and both on the same Latk frames (0, 10 and 40). These numbers were measured when Twoscilloscope still played the drawing itself. Its Beams and Decoded Strokes haven't changed since (see below).
- **Beams:** at pixel density 1, at most 0.015% of pixels differ by more than 2 levels, and none by more than 6. At density 2, none differ by more than 3.
- **Strokes and lines:** the lit pixels overlap the example's with an IoU of 0.91–0.95 at density 1, and 0.95 at density 2. Each segment is drawn on its own, so where neighbouring segments overlap their soft edges add up, whereas a Canvas2D path is stroked once. Original Lines' segments average about a pixel long, and at density 1 they carry 9% more light than the example's. The decoded strokes are simplified, and their light is within 1.5% of the example's.

**Checked against the version that played the drawing itself.** Latk's X and Y were cabled into Twoscilloscope's, with both at their defaults. The result was compared with commit 24bcfad's Twoscilloscope, in headless Chrome at 640×480, on frames 0, 10 and 40, at pixel density 1 and 2:
- **Beams and Decoded Strokes:** every pixel is the same.
- **Original Lines:** the lit pixels overlap with an IoU of 0.97–0.99, and the total light is within 3%. The lines now go through the loop's samples rather than the projected strokes' points, and that moves their soft edges by a fraction of a pixel.

**Fullscreen interaction.** Double-click the node preview to enter fullscreen. The example's keys work: L cycles the view, E solos the next effect, N turns them all off, M toggles Sound, S downloads the decoded strokes as SVG, and W downloads four seconds of the altered loop (X, Y and Z) as WAV. `js/main.js keyPressed` routes the keys. ESC or a click exits. The camera is Latk's, so dragging and the wheel do nothing here. The example's panel (G) and its .latk export (O) are not ported.

**Sound.** With Sound on, an `XYscope` loops the altered audio out of the sound card, X left and Y right, so what you hear is what you see. Browsers start audio only after a click or a key press. The example played as soon as its page was clicked; here Sound starts Off, so that adding a node makes no noise.

**Worker.** The effects and the point streams run in `twoscilloscope/worker.js`, which holds the `ScopeRenderer`. The module sends it the loop from the pins, with the effect settings, the View and the Beam Size. It replies with the altered loop, for Sound and W, and that View's point stream, which the module draws. While it is busy, the newest loop waits and any older one is dropped, as in Skeleton. So a drawing shows from the frame after its loop came in, and a change of View a frame later. S asks the worker for the decoded strokes, and the SVG downloads when they come back.

Two kinds of work are skipped, neither of which changes the output:
- **Unchanged loops:** a loop is sent only when it or the settings differ from the last one sent. The effects restart on every loop, so the same loop and settings come back the same. Latk's drawing changes 12 times a second, so of the 180 loops 3 s of Latk brought at 60 fps, 36 were sent. The last loop's lanes are kept as copies to compare against, so a source that rewrites its arrays in place still counts as a change.
- **The library's decode:** `ScopeRenderer.update()` runs the transformer's effect chain itself rather than calling `XYTransformer.transform()`. That would also decode the whole loop into strokes, which nothing reads and which took as long as the effects, and copy the buffer twice. The library is unchanged.

This was checked against the version before the worker in headless Chrome, with a seeded `Math.random`, a virtual clock and frames stepped by hand:
- **Latk:** with Latk's X and Y cabled in, every Effect option in Beams, and every view with None and with Low Pass + Delay, match on every pixel, at Latk frames 0, 10 and 40 and at pixel density 1 and 2.
- **Trail:** with two Oscillators cabled in, each of 40 frames matches the frame before it in the version before, at both densities.
- **Files:** the SVG and WAV that S and W download are the same, byte for byte.

The two skips were checked the same way against the version before them: the Latk cases match on every pixel, the Trail frames match frame for frame, and the files byte for byte, at both densities.

Reading the pins and finding the strokes later moved into `latk/strokes.js`, for ESP32 to share. Against commit 5103e34, with a virtual clock, the output matches on every pixel at both densities: Latk's drawing in six pairs of View and Effect, and two Oscillators' Trail at five points in 40 frames and with one pin unplugged.

**Cost.** At 1280×960 (a retina display) on an M2 Max, with Latk's drawing coming in, the module takes about 0.1 ms of a frame on the main thread, where it took 5.5–7 ms before the worker. Drawing the output takes about 0.03 ms of GPU time. A loop takes the worker 3.3 ms in Beams, 4.9 ms in Decoded Strokes and 3.0 ms in Original Lines, of which 2.8 ms is the effects, and Decoded Strokes' decoding is about 2 ms. Before the skips it took 6.1, 7.5 and 5.5 ms, every frame. In Beams, that is about 4% of a core, where it was about 37%.

## Audio Effects

`js/modules/audiofx/EffectRack.js` holds the audio effects Twoscilloscope and SlowscanJam share: the eleven effects of `example-latk`'s chain, from p5.twoscilloscope, an Effect drop-down that turns them on, and the Effect A and Effect B knobs that set them. It touches neither the DOM nor p5, so SlowscanJam's worker imports it too.
- **`CHAIN`** lists the effects in the example's order, and the setting each knob turns while one is on. `knobFor()` gives the knob position for a setting, so a module can set a knob's default from it.
- **`EffectMenu`** builds a module's drop-down from that module's own options, followed by one option per effect. Twoscilloscope's are Low Pass + Delay and None (`NONE`); SlowscanJam's is None. Patches save the option as its index, so a module's own options never change, and a new effect is appended to `CHAIN`. `params()` gives the drop-down and both knobs as module params. `resolve()` turns their values into plain data, `{ on, set }`, and relabels the knobs for the option. `nextSolo()` and `none` are the example's E and N keys.
- **`EffectRack`** holds one of each effect, added to an `XYEffectChain`. `apply()` puts every setting back to the library's default, turns on the effects in `on`, and then sets the knobs' settings from `set`. Twoscilloscope's rack, in its worker, is its `XYTransformer`'s chain, which restarts the effects every frame (see Twoscilloscope Module).
- **`EffectStream`** runs a rack over a signal that runs on from one call to the next, as SlowscanJam's fields do, keeping the effects' state between calls (see SlowscanJam Module). It restarts them when the option changes, so an effect turned back on doesn't replay what it held before. It also restarts them when Noise Seed changes, the one setting an effect reads only on a restart. `process()` can protect part of the signal: given a mask, it feeds the effects only the masked samples, scales them going in and back coming out, clamps them, and leaves the rest as they were.

## ESP32 Module

The ESP32 module (`js/modules/ESP32Module.js`, `js/modules/esp32/u8g2.js`, `js/shaders/esp32.js`) is an ESP32 drawing on a 1-bit SSD1306 OLED through the U8g2 library. The display is Width × Height pixels, the port's 128 × 64 unless changed. It comes from the JavaScript port of QtPy Death Star Plans by Okubo Heavy Industries (`Deathstar_plans/index.html` in the DeathStarTrenchRuns project). The port played that sketch's animation. The module has X and Y control pins instead and draws what comes in on them, in the form Twoscilloscope takes, so Latk's X and Y outputs put a Latk drawing on the display.

**Kept from the port:**
- **The display:** `esp32/u8g2.js` is the port's software display, a draw buffer and the buffer the panel shows, with its `drawPixel()` and its `drawLine()`, a port of U8g2's Bresenham line.
- **The pace:** a buffer goes to the panel every 30 ms, the time the ESP32 takes to send a full buffer over a 400 kHz I2C bus, so the picture changes 33 times a second at most. Each buffer is due 30 ms after the last was, as the port's `delay()` scheduled them, and a stall of more than 250 ms isn't caught up.
- **The panel:** `esp32Frag` is the port's shader: each display pixel is a slightly inset rounded square, with a halo from the lit pixels within three cells of it and a white-hot core where they are dense. The panel is the largest one of the display's shape that fits the frame with a small margin, in whole-pixel cells. For 128 × 64 that is 512 × 256 in the default 640×480 frame, with 4 px cells.

**Not kept:** the animation and its 190 KB of bitmaps and vertices, and the display's clip window, draw colour, boxes, frames and bitmaps, which only the animation used. The port's C and G keys are the Color and Grid drop-downs, and its R key restarted the animation.

**Params.**

| Param | Label | Options | Default | Sets |
| --- | --- | --- | --- | --- |
| `width` | Width | 1–256 | 128 | The display's pixels across |
| `height` | Height | 1–256 | 64 | The display's pixels down. The longer of the two spans the canvas (see X and Y) |
| `color` | Color | Cool White, Blue, Amber, Green | Cool White | The panel's colour, the port's four |
| `grid` | Grid | Off, On | On | Whether unlit pixels show faintly |
| `trail` | Trail | 0.1–10 s | 1 | How much of a values-only input is drawn, as Twoscilloscope's |

Patches save Color as an index, so a new option is appended, never inserted.

**X and Y.** The pins are read as Twoscilloscope's are, by `XYInputs` (see Twoscilloscope's X and Y): a loop on either pin, values only, or nothing, which leaves the display blank. They are read every frame, so a values-only input keeps a trail of 60 points a second, though the display shows it 33 times a second. For each buffer, `_page()` does one pass of a sketch's loop: clear the buffer, draw, send.
- **Strokes:** `findPieces()` gives the lit runs of the loop's blanking. Each is drawn as U8g2 lines from one sample to the next, and a run of one sample as a pixel.
- **No colour:** the display has one bit a pixel, so the loop's colour lane is ignored, and every stroke is drawn in the panel's Color.
- **Placing:** the loop's −1..1 is the canvas, which has the frame's shape (4:3 by default). It keeps its shape, and its centre is the display's. The display's longer side, Width or Height, spans the canvas's same side, and the other side is in proportion. A square display counts as wide. So the display shows the canvas at one scale. Where the canvas runs past the display it is cut off, and where it stops short the display is blank:

  | Display | The canvas, in display pixels | Shows |
  | --- | --- | --- |
  | 128 × 64 | 128 × 96 | The middle 64 of its 96 rows |
  | 128 × 96 | 128 × 96 | All of it |
  | 128 × 128 | 128 × 96 | All of it, with 16 blank rows above and below |
  | 64 × 128 | 170.7 × 128 | The middle 64 of its 170.7 columns |

- **Cut lines:** a sample off the display still has its pixel, and a line to it is drawn whole. `drawPixel()` draws nothing off the display, which cuts the line at the display's edge.
- **Edges:** samples are clamped to −1..1, the canvas's edges. One on the canvas's far edge goes to the canvas's last row or column, not the one past it, so an Oscillator's peak is not cut off where the canvas ends at the display's edge.

An Aspect drop-down set the placing before: Fit kept the whole canvas inside the display, 85.3 × 64 pixels of 128 × 64, and Stretch filled the display. Its id, `9a5f`, is retired (see Patch IDs).

**Checked against the port.** In headless Chrome on an M2 Max, at pixel density 1 and 2:
- **The display:** 14 loops went into the module, and through the port's own `u8g2` in its page, with the strokes found and placed by the test's own code. They were Latk's jellyfish at Loop Hz 100, 5 and 1 with Fit and with Stretch at 5, the two placings the module then had (see The placing, checked), and five made-up loops in both: a box on the display's edges, no blanking, single lit samples, samples past ±1, and all blank. Every pixel of every buffer is the same.
- **The panel:** the port's page was given the module's buffer and photographed. In a 640×480 window it lays its panel out as the module does at density 1, and in an 1100×960 one it has the 8 px cells of density 2. In all four colours, with Grid on and off, every value is within one level of the module's output, across the whole frame at density 1 and the panel and its halo at density 2.
- **The pace:** over 10 s of 60 fps frames on a virtual clock, 333 buffers went to the panel. In the second after a 2 s stall, 36 did.
- **Patches:** a node saved with Width 100, Height 50, Color Amber, Grid Off and Trail 3.5, with an Oscillator on X, loads with them and the cable. So does one saved before with Aspect Stretch and a knob cable into Aspect: the value is skipped, and that cable is dropped with a warning.

**The placing, checked.** In headless Chrome on an M2 Max, at pixel density 1 and 2, 8 loops went into the module on 26 displays from 1 × 1 to 256 × 256, wide, tall and square. The loops were Latk's jellyfish, a box on the canvas's edges, a figure with no blanking, the same figure past ±1, single lit samples, 60 scattered points joined by long lines, spokes from the centre to the canvas's edges, and all blank.
- **The test's own display:** the strokes were found, placed and drawn by the test's own code, with its own copy of U8g2's line. All 208 buffers are the same on every pixel. So is the 128 × 64 buffer the module draws in the real loop, with Latk on X and Y.
- **Where the canvas fits:** on 9 displays the placing is Fit's. Against the module of commit c6ac36d with Fit, 52 of the 72 buffers are the same on every pixel. The other 20 have samples on the canvas's far edge, on displays where that edge falls between two rows. Fit put them a row past the canvas, and they now go to its last row. With those samples moved just inside the edge, all 72 are the same. The output frames for the jellyfish at 128 × 96, 128 × 128 and 100 × 80 match that commit's on every value.
- **Where the canvas is cut:** on 8 displays the cut is a whole number of pixels, and the buffer is the middle of the one that commit drew on a display of the canvas's shape. 128 × 64 is rows 16–79 of 128 × 96. All 64 buffers are the same on every pixel.

**Optimizations.** A first version drew as a sketch would: a `drawLine()` for every pair of samples, the panel uploaded on every buffer, and the output drawn on every frame, as the port did. Three changes followed. None changes a pixel, and the checks above ran after them. The times are from before the placing changed, when Fit drew the jellyfish on the default display at two thirds of the size it has now.
- **Lines only where a sample moves on:** Latk's loop has 8,820 samples at the default Loop Hz, and its jellyfish lights 281 pixels, so nearly every pair of samples falls in one pixel. U8g2's line between two points in the same pixel is that pixel. So after a stroke's first line, one is drawn only when a sample lands in another pixel than the one before. Drawing a buffer went from 161 to 75 µs, and from 737 to 299 µs for the 44,100 samples of Loop Hz 1.
- **The output only when the panel changes:** `sendBuffer()` compares the buffer with the one showing, and leaves the panel clean when they are the same. The output is drawn only for a changed panel, or a changed Color or Grid. With Latk at its 12 frames a second, it is drawn 11 times a second instead of 60, and not at all for a still drawing.
- **No halo far from the panel:** past three cells from the panel a fragment can't be lit, and that is half the frame, so those fragments return black before the halo's 49 taps. A draw costs about half as much at density 2, and 13–22% less at density 1.

In the real loop at density 2, with Latk at its defaults, the module's share of a frame on the main thread went from 0.33 ms to 0.15 ms, and from 0.72 ms to 0.37 ms at Loop Hz 1.

Two more were tried and left out:
- **A worker:** a worker drawing the display was measured, as Twoscilloscope and Skeleton have one. The main thread then pays only to copy the loop to it: 21 µs where it now draws the buffer in 75, and 64 where it draws in 299 at Loop Hz 1. Latk's lanes are shared with whatever else reads them, so they can't be transferred. Measured back to back, that is 0.03 ms a frame less at the defaults and 0.13 ms less at Loop Hz 1, and it can't be more than the module's whole 0.15 and 0.37 ms. The display would show each buffer a frame later, after a round trip of 0.2–0.9 ms, and each node would hold a thread. Twoscilloscope's worker saved 5.5–7 ms a frame.
- **A separable halo:** the halo's weight is its x part times its y part, so 14 exponentials can stand in for 49. On top of the early return it made no difference that could be measured, and at density 1 it changed one value by one level.

**Cost.** When the output is drawn, it takes about 0.2 ms of GPU time at 1280×960, where it took 0.37–0.89 ms before the early return. These were measured by throughput, and vary about twofold from run to run with the GPU's power state. Uploading a changed buffer takes 22 µs.

## Random, Constant, Calculator and Remap Modules

Four Control modules that work on control values alone (`js/modules/RandomModule.js`, `ConstantModule.js`, `CalculatorModule.js` and `RemapModule.js`). Each is plain JS, with no shader, no framebuffer and no video output, so `process()` only sets `controlValues.out`. That `out` is one number a frame, with no control signal. It drives a knob through a parameter cable, or a control input pin: Twoscilloscope and ESP32 draw it as they draw an Oscillator's (see Twoscilloscope's X and Y).

**Random** is a sample-and-hold random source.

| Param | Label | Range | Default | Sets |
| --- | --- | --- | --- | --- |
| `min` | Min | 0–1 | 0 | One end of the output's range |
| `max` | Max | 0–1 | 1 | The other end. Min may be above Max |
| `hz` | Hz | 0–120 | 60 | New values a second. 0 holds the last one |

- **Draw:** each new value is one `Math.random()`, uniform between Min and Max. It is kept as 0..1 and scaled on the way out, so the output stays between Min and Max while they move, even at Hz 0.
- **Rate:** the updates due are accumulated (`phase += dt × Hz`), so turning Hz doesn't jump the rate. The fraction left after an update carries on, so the rate holds on average at any frame rate.
- **One draw a frame:** a control output carries one value a frame, so however many updates came due, one draw stands for them all. Above the frame rate, Hz gives a new value every frame, and a stalled tab costs one draw.
- **At the frame rate:** with Hz equal to the frame rate, as the default 60 is at 60 fps, an update falls due about once a frame. A frame that comes a little early then has none due and keeps the last value for a second frame. A Hz above the frame rate never holds one.

**Constant** outputs its Value (0–1, default 0.5).

**Calculator** outputs `A op B`. The Op drop-down picks Add, Subtract, Multiply or Divide. Patches save it as its index, so a new operation is appended, never inserted.
- **Operands:** A and B are params (−10–10, default 0), and `a` and `b` are control input pins. A pin with a control output cabled to it replaces its param, each pin on its own. The param keeps its value, and is used again when the cable goes. A video output on a pin is not a control value, so the param stays in use.
- **Pins and knob cables:** a pin takes the source's value as it is, from the same frame. A knob cable into A or B is scaled to −10..10, as into any knob, and arrives a frame later.
- **Range:** the result isn't clamped, so it can leave 0..1. A knob cable clamps it to the knob's range.
- **Divide by zero** gives 0. A result that isn't finite would set a cabled knob's param to NaN.
- **Values only:** a pin reads its source's value, not its loop. Latk's X through a Calculator is where the beam is this frame, not the drawing.

**Remap** maps a value from one range to another: `Out Min + (value − In Min) / (In Max − In Min) × (Out Max − Out Min)`, as p5's `map()` does.
- **Pins:** `value`, `inMin`, `inMax`, `outMin` and `outMax`, all control inputs. `value` has no knob, and is 0 with nothing cabled to it.
- **Knobs:** In Min, In Max, Out Min and Out Max (−10–10, defaults 0, 1, 0 and 1). Each is used while nothing is cabled to its pin, and a cabled pin replaces it as Calculator's do: from the same frame, with the knob keeping its value for when the cable goes. A knob cable is scaled to −10..10 and arrives a frame later.
- **Range:** the result isn't clamped, so a value outside In Min..In Max maps outside Out Min..Out Max. Either range may run backwards, which inverts the mapping.
- **Empty input range:** with In Min equal to In Max, it outputs Out Min. A result that isn't finite gives 0, as Calculator's does.

**Node layout.** Output ports and their labels sit in a dedicated bottom section below a node's preview (or below its last parameter row on nodes with no preview such as Calculator, Constant, Random and Remap) so previews and file-picker buttons never overlap outlet circles or labels.

**Checked** in headless Chrome, on a virtual clock with frames stepped by hand and a seeded `Math.random`:
- **Random's rate:** over 600 frames at 60 fps, Hz 1, 7.5, 10, 30 and 45 gave 10, 74, 99, 299 and 450 new values, Hz 120 gave 600 and Hz 0 none. Where a count is one short, the last update fell due on the last frame itself, and the stepped clock's rounding left it just short. Hz 60 gave 597, with three frames held for the same reason (see At the frame rate). At 30 fps, Hz 60 gave 300 in 300 frames. After a 5 s stall, which drew once, Hz 10 gave 100 in 600.
- **Random's range:** every value was inside 0.2–0.4, and inside 0.3–0.8 with Min 0.8 and Max 0.3. Held at Hz 0, the output followed Min and Max.
- **Calculator:** 0.75 and 0.25 gave 1, 0.5, 0.1875 and 3, and 0.75 / 0 and 0 / 0 gave 0. With Constants cabled to neither pin, to `a`, to both and to `b`, each cabled pin's value stood in for its param, and both params kept their values. An Oscillator's video output on a pin left the param in use, and its control output replaced it.
- **Order:** through Random, a Calculator and a second Calculator, the last output matched the Random's value on the same frame, over 120 frames.
- **Patches:** a patch of all three, cabled to pins and to knobs, saves, loads and saves again as the same JSON.
- **Other nodes:** each of the 67 other modules has the same height, port positions and preview as at commit 909079b.
- **Twoscilloscope:** in the running app, two Randoms at Hz 20, X through a Calculator multiplying by 0.5, drew a trail across the left half of the canvas.

## Skeleton Module

The Skeleton module (`js/modules/SkeletonModule.js`, `js/modules/skeleton/`, `js/shaders/skeleton.js`) is a Control module based on Twoscilloscope's `experiments/camera_trace`, without that example's camera and edge shader. It thins a black and white input to its centre lines, one pixel wide, and follows them into polylines. Its X and Y control outputs carry them as one loop of XY audio, as Latk's do, to drive Twoscilloscope. It has no video output, and its node preview shows the traced lines in green, 2 px wide, as camera_trace drew them. To trace a picture's outlines, patch Edges in front of it.

**Files:**
- `js/libraries/trace_skeleton_wasm.js` is the skeleton-tracing library's WebAssembly build, by Lingdong Huang, copied unchanged from camera_trace. It is a UMD script with the wasm inlined, so it puts `TraceSkeleton` on the global scope and fetches nothing. In a worker it takes its own URL from `self.location` and never touches `document`.
- `skeleton/worker.js` traces off the main thread (see Tracing).
- `slowscanjam/PixelReadback.js` is SlowscanJam's fenced readback, which Skeleton shares.

**Params.**

| Param | Label | Range | Default | Sets |
| --- | --- | --- | --- | --- |
| `threshold` | Threshold | 0–1 | 0.5 | The luminance a pixel must pass to be part of a shape |
| `trace` | Trace | White, Black | White | Which shapes are traced: light on dark, or dark on light |
| `fill` | Fill | 0–1 | 0 | The share of a cell that must pass Threshold for the cell to be part of a shape (see Mask below). At 0, any part of it will do |
| `resolution` | Resolution | 64–1024, in steps of 32 | 256 | Cells across the tracer's grid. The grid keeps the frame's shape, so 256 is 256 × 192, where camera_trace used 256 × 256 |
| `hold` | Hold | Off, On | Off | Keeps the last trace on X and Y, and starts no new one (see Hold below) |
| `minLength` | Min Length | 0–100 px | 0 | Lines shorter than this, in px of the frame, are left out of X, Y and the preview |
| `loopHz` | Loop Hz | 1–100 | 5 | Loops a second on X and Y, as Latk's |

**A trace goes through three stages:**
1. **Mask:** the input shrinks to the grid, one texel a cell (`skeletonMaskFrag`). A cell is white if at least Fill of an 8 × 8 grid of taps across it pass the threshold, and at least one does. At Fill 0, any one tap will do. camera_trace read one pixel per cell, and averaging would lose any line thinner than a cell, such as an Edges outline. The tracer thins whatever this widens. Raising Fill drops specks that cover only part of a cell and stops shapes from widening: at 0.5 a cell must be half covered, and at 1 wholly. A line thinner than a cell breaks up and then goes. On 2 px cells, a 1 px line covers half of each cell, so it breaks where it steps from one row of pixels to the next above Fill 0.25, and is gone above 0.5.
2. **Readback:** the mask is read into a pixel buffer behind a fence, polled once a frame, so the main thread never waits on the GPU (`PixelReadback`, as SlowscanJam does). WebGL1 reads at once.
3. **Tracing:** the worker writes the mask into the wasm heap, one byte a cell, and calls the tracer's `trace()` with a pointer to it. camera_trace built a string of `\0` and `\1`, one character a pixel, for `fromCharString()`, which encoded it into the heap. The pointer gives the same polylines 25–40% sooner. The worker parses the tracer's text into typed arrays, which it transfers back.

A new mask starts every frame, even while the worker traces the last one. The newest waits for the worker, and any older is dropped, so each trace is of the freshest mask. A trace that finishes after the input is unplugged is dropped.

**Memory.** The library leaks unless it is driven by hand, so the worker doesn't call it as its own `fromCharString()` does:
- **Work buffers:** `trace()` keeps its work buffers, the mask among them, until the tracer's own `destroy()` frees them, and `wasm.destroy()` only deletes the object. The worker calls both, and mallocs a new mask for each trace, since `destroy()` frees it.
- **The text:** the glue's `trace()` copies the text the tracer returns into a JS string and never frees it. The worker calls the binding under it (`_emscripten_bind_skeleton_tracer_t_trace_3`), decodes the text from the heap and frees it.

Driven as before, each trace left about 3 bytes a cell in the wasm heap: 11.5 KB at 128 cells, 46 KB at 256 and 180 KB at 512. At 60 traces a second, the 256 default took the heap to 741 MB in 15,000 traces (about 4 minutes). The heap stops at 2 GB, which is about 13 minutes at 256 cells and 3 at 512. At 1024 cells the tracer aborted after 3,020 traces. Now the heap stays at its first 16 MB, 4,000 traces at 1024 cells included, and the polylines are the same on every point (a checksum over 2,000 traces of a moving test mask at 128, 256 and 512 cells), as fast as before.

**A failing tracer.** The worker catches what a trace throws and replies `{ error }`. It used to reach no one, as an async handler's error never fires the worker's `onerror`, so the module waited for that trace for ever: Skeleton stopped, its last trace frozen on X and Y. The module now starts a new worker, which the wasm needs once it has failed, and sends it the newest mask. A worker that fails to load still stops tracing for good.

**Hold.** With Hold on, no new mask starts, and X, Y and the preview keep the last trace, even when the input is switched to another picture or unplugged. A mask still being read or traced when Hold goes on is dropped, so the trace held is the one showing. Min Length still cuts it. Turning Hold off with nothing plugged in clears it, as unplugging does. A cable drives it as it does any drop-down, so it holds from 0.5 up.

**X and Y.** Each polyline becomes a piece through `polylinePieces()`, with each point at its cell's centre. A cell on its own (a single point) has no length and is left out, and so is any polyline shorter than Min Length. The whole trace is kept, and cut again whenever Min Length moves, so a change shows at once, even under Hold. The tracer builds its lines from where they cross the edges of chunks of at most 10 × 10 cells, so most specks small enough to sit inside one never come through. Min Length is for what does: short fragments, such as dashes, the pieces of a noisy Edges outline, or the odd speck. Every frame, `XYOutputs` encodes the latest trace into the loop (see Latk's X and Y). The pieces carry no colour, so Twoscilloscope draws them in its default white. With nothing traced, or nothing cabled in, the loop is all blank, so the beam rests unlit in the middle.

**Checked.** In headless Chrome, on a test mask of a thick ring, a thick bar, a filled disc, a rectangle and a 1 px line, the traces run down the middle of each stroke at 64, 256 and 512 cells, in White and in Black (the mask inverted). The 1 px line is kept even at 64. A disc thins to a point. Twoscilloscope's Original Lines, Beams and Decoded Strokes redraw each trace from X and Y.

Fill, Min Length and Hold were checked the same way:
- **Defaults:** with all three at their defaults, X and Y, the mask and the preview match commit 607abf1 on every sample and pixel, on two test pictures, at pixel density 1 and 2.
- **Fill:** on a test picture read with nearest filtering at 320 cells (2 px each, so no tap lands on a pixel boundary), the mask matches a count of the 64 taps on the CPU in every cell, at six settings in White and two in Black.
- **Specks:** at the default 256 cells, 4 of the picture's 85 specks of 1 and 2 px made lines: three of 9–15 px, and a 41 px spur where one touched the disc. At Fill 0.5 none did, and the shapes traced to as many lines, of the same lengths, as with no specks.
- **Min Length:** with 40 short dashes added to the picture, 11 of its 26 lines were under 20 px, and at Min Length 20 the loop carried exactly the other 15.
- **Hold:** the trace held through switching the input and unplugging it, and no mask started. Min Length still cut it, turning Hold off unplugged cleared it, and a cable value of 0.7 held.

**Cost.** In headless Chrome on an M2 Max at 60 fps, at pixel density 1 and 2:
- **Main thread:** Skeleton's share of a frame has a median of 0.5–0.7 ms and a 95th percentile under 1 ms.
- **Tracing:** in the worker, a trace takes 3–4 ms at 128 cells. At 256 cells it takes 3.4 ms for Latk's lines and 6–7 ms for the test mask's thick strokes. At 512 cells it takes about 9 ms for Latk's lines and 36 ms for the thick strokes, since thinning peels a shape one cell at a time from each side. At 1024 cells, a picture of thick shapes (a 20 px ring, a 30 px bar and a 100 px disc) took about 370 ms, against 50 ms at 512 and 7 ms at 256.
- **Rate:** there is a new trace every frame wherever one takes under a frame, 27 a second for thick strokes at 512 cells, and under 3 a second for thick shapes at 1024. The main thread never waits for one.

## RuttEtra Module

The RuttEtra module (`js/modules/RuttEtraModule.js`) draws its input as Rutt-Etra scan lines, after Felix Turner's Rutt-Etra-Izer. Every Line Separation pixels down the frame, a row of the input becomes a line of vertices, each pushed back by its brightness (`0.34 r + 0.5 g + 0.16 b`) times Max Line Depth, and the lines are drawn in 3D through p5's camera.

**d.** A second video input, `d`, displaces the lines by its own brightness instead, with the same formula, sampled where each vertex is. The lines still take their colour from `in`, and they draw nothing without it. This lets DepthAnything's depth push the input's lines back. Brighter goes further back, and DepthAnything's Grey shows near as white, so its Invert brings near things forward. X and Y read `d` too: `ruttEtraGridFrag` samples it instead of the input. Uncabled, nothing changes. The two cases are separate programs, made from one source by `ruttEtraVert(withD, kinect)`, rather than one shader that picks between the textures. In Chrome on Metal, that select moved 3 to 18 bytes of edge pixels a frame from before, though it picked the input every time.

**Depth Format and Depth Method.** Two drop-downs say how to read what displaces the lines, `d` or, uncabled, the input, and FOV and Far/Near describe DepthAnything's:

| Param | Label | Options | Default | Sets |
| --- | --- | --- | --- | --- |
| `format` | Depth Format | Grey, Turbo | Grey | How it holds depth, as DepthAnything's Color does. Grey is brightness, as before. Turbo is read back to depth first |
| `method` | Depth Method | Linear, Kinect, DepthAnything | Linear | Linear pushes each vertex straight back, as before. Kinect unprojects it through a pinhole camera, reading the brightness as depth. DepthAnything does too, reading it as inverse depth |
| `fov` | FOV | 20–120 | 60 | DepthAnything: the horizontal FOV, in degrees, of the camera the input came from |
| `farNear` | Far/Near | 1.1–20 | 4 | DepthAnything: how many times farther the farthest point in view is than the nearest |

- **Turbo:** `turboToDepthFrag` (`js/shaders/depth-anything.js`) turns each pixel to grey at the x whose `turbo(x)` is nearest its colour, into a buffer the size of the one it came in. 64 steps find the nearest and 16 more refine it. The vertex shader and X and Y then read that buffer as they would a Grey one, so a Turbo map displaces the lines as DepthAnything's Grey map of the same frame does. The input still gives the lines their colour, so an uncabled `d` with Turbo uses the `withD` program, with the read-back buffer as `uDTex`. DepthAnything's output and the inverse share one `turbo()`, so they can't drift apart. Over all 256 levels of an 8-bit Turbo map, it gives the level back to within 1, a mean of 0.16.
- **Kinect:** the brightness is raw depth, `zk = brightness × Max Line Depth`, and a vertex's pixel in the displacing buffer, `uv × (width, height)`, is unprojected through a pinhole camera: `x = (px − cx) zk / fx`, `y = (py − cy) zk / fy`. The camera is the Kinect v1's, whose SDK gives a nominal depth focal length of 285.63 px for a 320 × 240 image, a horizontal FOV of 58.5°. The displacing buffer is the frame's size, so `depthIntrinsics()` scales it to the buffer on each axis: `(width / 2, height / 2, 285.63 × width / 320, 285.63 × height / 240)`, 571.26 px at 640×480. Until 2026-11-13 the 285.6 was used as it was, in px of the buffer, which made the FOV 96.5° at 640×480 and 131° at 1280×960, so a cloud came out about twice as wide as it is deep, and changed shape with the frame size. Its z is `−zk + Max Line Depth / 2`, so the lines sit around z = 0 as Linear's do, and further is further back. p5's y runs down, as the texture's rows do, so y isn't flipped. The size is the buffer's in logical px, not `× density`, so the lines take the same shape on every display. Max Line Depth scales the whole cloud, since every coordinate is in proportion to `zk`, and depth 0 meets at the camera.
- **DepthAnything:** DepthAnything's output is inverse depth, normalized so the frame's farthest point is 0 and its nearest 1 (see DepthAnything Module), so reading it as depth, as Kinect does, turns the scene inside out, and with DepthAnything's Invert, collapses the nearest things onto the camera. This method takes depth as `zk = Max Line Depth × c / (brightness + c)`, so the farthest point is at Max Line Depth, with Invert off. The normalizing leaves no trace of how much farther the far end is than the near, so Far/Near gives it: `c = 1 / (Far/Near − 1)`. The vertex is unprojected as Kinect's is, through `(width / 2, height / 2, f, f)`, `f = (width / 2) / tan(FOV / 2)`, with FOV the camera the input came from, since the model keeps no trace of it either. Its pixels are taken as square. X and Y unproject with the same `depthIntrinsics()` and `depthDistance()`, which the module exports.
- **Seen from the camera:** Kinect and DepthAnything are drawn through the camera they unproject with, placed at p5's eye. `_draw()` sets the framebuffer camera's `perspective()` to the vertical FOV `2 atan((height / 2) / fy)` and the aspect `(width fy) / (height fx)`, and moves the lines `eyeZ − Max Line Depth / 2` along z before Scale, Rotation X and Rotation Y, with `eyeZ` p5's 800. The shader puts them around z = 0, so this puts the unprojecting camera at the eye, and the knobs turn and scale them about the middle of their depth. So at Rotation X 0, Rotation Y 0 and Scale 1, each line lies over its own pixels of the frame, at any Max Line Depth, FOV or Far/Near, and the picture fills the frame as Linear's does. Before this, the camera they unprojected with sat Max Line Depth / 2 in front of the lines while p5 looked from 800 away, so a cloud filled under half the frame at Max Line Depth 300. Turned, they are seen from close to, as the camera that took them saw them, so a large turn crops them: turn Scale down to step back. The framebuffer's camera keeps its projection between frames, so `perspective()` with no arguments puts p5's back after drawing.
- **Near and far:** the near plane is a thousandth of `Scale × Max Line Depth`, and the far plane is past the farthest corner of the depth range from the middle, so no line is cut off at any depth. A line Kinect reads as depth 0, black in its map, is at the eye and not drawn.
- **Line Thickness:** a ribbon's two edges are unprojected from their own rows, half of Line Thickness above and below the line's, so the lines are Line Thickness px thick from the front, as Linear's are, whatever their depth. Pushed back in p5's world, they would have grown thicker the nearer they came to the eye.
- **Programs:** each of the six cases (`d` or not, and each Depth Method) is its own program, which p5 compiles the first time it is bound. With Linear, `ruttEtraVert` gives the same source as before, character for character.

**Choosing DepthAnything's intrinsics.** Measured on 16 ray-traced rooms, 4 camera poses at horizontal FOVs of 45°, 60°, 75° and 90°, run through DepthAnything's pipeline (its model, Size 336 × 252, normalizing and 8-bit map) and scored against the true geometry, after the one scale that fits each best:
- **Inverse depth:** the map fits `a / z + b` with R² 0.96 on average, and `a z + b` with 0.84.
- **Error:** RMS distance from the truth as a share of the mean depth. Kinect on Grey gave 1.00, Kinect with Invert 0.35, and this method 0.075 at the best FOV and Far/Near for each view.
- **FOV:** the best FOV was the camera's own, within 2°, in all 16 views. The depth map carries nothing that pulls it elsewhere, so FOV has to be the source camera's. 60° is a usual webcam's. 30° off roughly triples the error.
- **Far/Near:** the best `c` was `1 / (far/near − 1)` of each view, as the normalizing predicts, from 0.13 to 0.68. One value for all, at each view's true FOV, did best at about 0.35, a mean error of 0.11, so Far/Near defaults to 4 (`c` = 0.33). A view with sky or a long way to see wants a larger Far/Near.

DepthAnything also normalizes each frame to its own nearest and farthest points, so the scale of the lines shifts whenever those change, which no Far/Near can undo.

Checked in headless Chrome against HEAD's module in the same graph, with a virtual clock, over 12 frames at pixel density 1 and 2. The test yielded between frames, so the X loop's readback came in:
- **Grey and Linear:** with `d` uncabled and cabled, the video and the X loop match HEAD on every frame.
- **Turbo:** an Oscillator through DepthAnything's output shader, once as Grey and once as Turbo. The read-back Turbo buffer is within 1 level of the Grey on every pixel, a mean of 0.01, and so is the grid X and Y read. The video differs on up to 0.15% of its bytes, at line edges, cabled to `d` or to the input.
- **Kinect against Linear:** with a white `d` and Max Line Depth 285.6, Kinect's vertices land where Linear's do. The video differs only at line edges: 21 bytes at most by 1 level at density 1, and 0.07% of bytes at density 2. Kinect is now seen from its own camera, so it lines up with Linear from the front at any depth (see below).
- **Kinect's X and Y:** with Scale 1.5, Rotation X 0.6 and Rotation Y 0.4, all of the loop's 18,000 points land within 2 px of a lit pixel of the video, from Grey and from Turbo.

The DepthAnything method, Kinect's scaled focal length and their camera were checked on 2026-11-13, in headless Chrome against HEAD's module, over 12 frames at pixel density 1 and 2, with a ray-traced room as the input and the model's map of it as `d`:
- **Linear:** with `d` uncabled and cabled, the video and the X loop match HEAD on every frame, as two HEAD nodes match each other.
- **Linear after the others:** switched to DepthAnything for two frames and back, Linear matches HEAD on every byte the next frame, so p5's projection is back.
- **From the front:** at Rotation X 0, Rotation Y 0 and Scale 1, Kinect and DepthAnything light exactly the pixels Linear does at Max Line Depth 0, at Max Line Depths 20, 80, 300 and 1000, within a mean of 0.1 level where both are lit. Exported with `tools/patch-to-gles3.mjs`, DepthAnything from the front and Linear at depth 0 light the same pixels to an IoU of 0.998, within 1 level.
- **X and Y:** with Scale 1.5, Rotation X 0.6 and Rotation Y 0.4 at Max Line Depth 300, all of DepthAnything's lit loop points land within 2 px of a lit pixel of the video, at depths 80 and 300. Kinect's do too, with its map lifted off 0 and Line Thickness 6. At Line Thickness 2, 0.6% don't, where a ribbon seen edge-on covers no pixel's centre. With black in its map, 2.5% don't: those lines are at the eye.
- **Geometry:** in Node, `depthIntrinsics()` and `depthDistance()` rebuild the room from a map of its true inverse depth, normalized and cut to 8 bits as DepthAnything's is, to within 0.3–0.8% of the mean depth, at the room's true FOV and Far/Near.
- **Patches:** a node set to DepthAnything with its FOV and Far/Near saves and loads again as the same JSON. Depth Method's new option is appended, so its id stays.

Checked in headless Chrome against HEAD's module in the same graph, with a virtual clock, over 20 frames at pixel density 1 and 2:
- **d uncabled:** the video, the read-back grid and the X loop match HEAD on every frame, as two HEAD nodes match each other. So does a node with `d` cabled to the same source as `in`.
- **d cabled** to another Oscillator: the grid and the X loop match a HEAD node fed that Oscillator on every frame, and the video differs from HEAD's.
- **d uncabled again:** the video matches HEAD on the next frame, and the grid one frame later, once the read in flight is in.

**X and Y.** Like Latk, RuttEtra has X and Y control outputs, which carry its lines each frame as one loop of XY audio to drive Twoscilloscope (see Latk Module). Loop Hz (1–100, default 5) is the loops a second, as Latk's. The lines carry no colour, so Twoscilloscope draws them in its default white.
- **Brightness:** the vertex shader reads each vertex's brightness on the GPU, so it is read back for X and Y. `ruttEtraGridFrag` writes it one texel a vertex, sampling the input where the vertex does, into a buffer read back behind a fence, as Skeleton's mask is (`PixelReadback`). The lines on X and Y are therefore a frame or two behind the video's.
- **Projection:** each frame, every line's vertices, at the centre of its ribbon, are pushed back by the latest grid and the current Max Line Depth and Depth Method. They go through the matrices `model()` draws them with, read from p5's renderer, so Scale, Rotation X and Rotation Y are never behind. p5's framebuffer camera flips y, so clip space y = −1 is the top of the output.
- **Cut:** a line breaks where it goes behind the camera or past its depth range, and is cut at the canvas edge (`polylinePieces()`).
- **Thinned:** a line keeps at most 160 points (`XY_MAX_COLS`, every point at the default Line Separation of 4), its ends included. At Line Separation 1 a line has 640 vertices, and even at Loop Hz 1 the loop has about one sample for every 7 px of line.
- **Empty:** with no input, the loop is all blank, so the beam rests unlit in the middle.
- **Only when cabled:** the readback, projection and encoding are done only while X or Y is cabled to a pin or a knob. In the two workflows that use RuttEtra, neither is, and on an M2 Max at 1280×960 the module's time on the main thread went from about 2 ms a frame to under 0.1 ms. Uncabled, the grid is dropped, so cabling X or Y again starts from a blank loop for a frame or two, as a new node does, rather than from an old picture.

**Fullscreen interaction.** As in Latk and Mesh: double-click the node preview to enter fullscreen, drag to orbit, turn the wheel to zoom, and double-click to go back to the home view. ESC exits. RuttEtra has no camera of its own, so these turn the knobs that turn its lines:
- **Drag:** Rotation Y and Rotation X, at Latk's 0.01 rad per pixel. The lines follow the pointer: dragging right pushes their right side back, and dragging down brings their top forward. The knobs stop at ±1.5 rad, so the lines turn no further than side-on.
- **Wheel:** Scale, by `exp(−delta × 0.001)`, so turning it down moves away, as Mesh's Distance does.
- **Double-click:** the three knobs' defaults, Scale 1, Rotation X 0.3 and Rotation Y 0.

`js/ui.js` routes press, drag, release, wheel and the double-click as it does for Latk and Mesh. A cable on one of the knobs overrides the mouse.

**Geometry.** The scan lines are one `p5.Geometry`, rebuilt when Line Separation changes. It has its own `gid` (see Development Conventions), and the one it replaces is freed. Before that, every RuttEtra geometry shared the key `undefined`, so a change of Line Separation, or a second RuttEtra node, drew the session's first geometry, while X and Y followed the new grid.

Line Thickness is a uniform rather than part of the geometry. Both vertices of a ribbon's edge pair sit on the line's centre, and their z, which `ruttEtraVert` replaces with the brightness displacement anyway, says which edge each is: −1 the top, 1 the bottom. The shader moves each by half of Line Thickness, so turning it, or cabling it, rebuilds nothing. It used to be built into the geometry, so it changed nothing until Line Separation did. Checked against that version on fresh nodes, in headless Chrome at pixel density 1 and 2: at Line Thicknesses 0.5, 2, 3.5, 10 and `electric_lake`'s 1.9367, each at Line Separations 1, 4 and 7, the output matches on every pixel. Turning Line Thickness from 2 to 8 now gives the same output as a new node made at 8.

On a geometry's first draw, p5's `model()` finds every edge and turns them all into stroke geometry, though the lines are drawn with `noStroke()`. The geometry is given one edge of its own, so `model()` doesn't look for the rest. In headless Chrome, a new node's first frame went from 336 ms to 34 ms. A change of Line Separation takes 11 ms between 4 and 5, and 49 ms between 2 and 3. Without the edge, the change would take 208 ms and 1.3 s.

Checked in headless Chrome against the version before, with a seeded `Math.random`, a virtual clock and frames stepped by hand, at pixel density 1 and 2:
- **Uncabled:** the video matches on every pixel at Line Separations 1, 4, 7 and 12, each a session's first node.
- **Cabled:** with X and Y cabled into Twoscilloscope, the video, both loops and Twoscilloscope's output match on all 12 frames.
- **Workflows:** `electric_lake` and `stained_glass` match on every module's output over 20 frames.
- **Line Separation:** changed from 4 to 12, and on a second node made at 12, the output now matches a session's first node made at 12.

**Checked** in Node, with p5 1.9.4's framebuffer camera rebuilt from its own formulas. With Max Line Depth 0 and no rotation, every vertex lands on its own pixel, to within 1e-13 px, with the first line at the top. At Scale 4, Rotation X 1.5 and Max Line Depth 300, lines break where they swing behind the camera, and every point stays on the canvas.

## Yellowtail Module

The Yellowtail module (`js/modules/YellowtailModule.js`) implements Golan Levin's interactive kinetic gesture system, ported from a p5.js version.

**Rendering path:** The module internally creates an off-screen `p5.Graphics` context (`this.pg`) in 2D mode. Gestures are simulated and compiled into polygon meshes which are drawn to this 2D buffer every frame using standard p5 shape functions. The resulting 2D canvas texture is then piped into the module's WebGL `outputFBO` via the passthrough shader.

**X and Y.** Like Latk, Yellowtail has X and Y control outputs, which carry its gestures each frame as one loop of XY audio to drive Twoscilloscope (see Latk Module). Loop Hz (1–100, default 5) is the loops a second, as Latk's. Each gesture goes into the loop as its centre line, in the gestures' colour (255, 255, 245):
- **Centre line:** each quad's line runs from the middle of its first edge to the middle of its last, and joins the next quad's, so a gesture is one line until it wraps.
- **Wrapping:** where a quad wraps to the other side of the canvas, the line breaks there. A quad near an edge is also drawn a canvas across, and its line is too, so the part of a gesture that wraps onto the canvas comes through.
- **Cut:** lines are cut at the canvas edge, as Latk's strokes are (`polylinePieces()`).
- **Empty:** with no gestures, the loop is all blank, so the beam rests unlit in the middle.

**Seed.** The Seed trigger, last in the params, draws one random stroke each time it fires, from a fresh 8-digit hex seed that the button then shows. It sets no params: unlike the Seed of Crystalline and the others (see Seeded Randomization), it calls `addRandomStroke()`, not `randomize()`. `randomStroke()` turns the seed (through a mulberry32 PRNG, so a seed always gives the same stroke) into a pointer position a frame, and these go through `addPoint()`, `smooth()` and `compile()` exactly as a drag's do, so a random stroke takes its pressure, taper and crawl the same way. The pen keeps a heading and turns at a rate that sums four parts:
- **Bend:** a steady turn, for arcs.
- **Sway:** a slow sine, for S-curves.
- **Drift:** a mean-reverting random walk, so the line wanders.
- **Hook:** about one stroke in three curls over its last 10–25%.

Its speed follows a minimum-jerk bell over the stroke and slows in tight turns by the two-thirds power law (speed ∝ curvature^−1/3), as a hand's does. `addPoint()` reads speed as pressure, so the slow start and the turns draw thick. Strokes run from 0.15 to 1.25 of the canvas's short side along their path, and each lands at random where it fits whole. Each stroke takes the next of the 36 gestures, oldest first, as a drag does (`_takeGesture()`), so one fired by a cable mid-drag doesn't land in the gesture being drawn. Strokes aren't saved in patches, as drawn ones aren't.

**Drawing speed.** A stroke is drawn on screen over time, as a drag is, not all at once. Its seed also sets a tempo, log-uniform from 0.4× to 2.5×: the number of its pen frames `_drawStrokes()` feeds in each 60th of a second, counted on the clock (`dt`), so it takes as long at any frame rate. A stroke of 16 to 400 pen frames is therefore drawn in anything from about 0.1 to 17 s. The tempo changes only how fast the stroke appears, not its shape or thickness, which come from the pen frames. Like the gesture under a held mouse, a stroke doesn't crawl until it is fully drawn. Several can be drawn at once, and Clear stops them all.

Thickness changes only the video. Checked in Node with the browser stubbed: six seeded gestures crawled for 400 frames, wrapping round the edges throughout. Every lit sample, 176,053 of them over 20 of those frames, lies inside or within 0.75 px of a quad as `process()` draws it, copies included.

**Fullscreen interaction:**
- Double-click the node preview to enter fullscreen.
- Click, drag, and release to create repeating kinetic gestures.
- ESC exits fullscreen; C clears the canvas.

## Cross-Origin Isolation

ONNX Runtime's WASM backend (`js/modules/img2img/OnnxModel.js`) runs threads only in a cross-origin isolated page, because its threads share memory through `SharedArrayBuffer`. Isolation takes two response headers, `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy`, which neither `http-server` (`run.command`, `run.bat`) nor GitHub Pages can send. `coi-serviceworker.js` adds them instead. It is coi-serviceworker v0.1.6 (Guido Zuidhof, MIT) as edited for depth-anything-v2-js, and `index.html` loads it before anything else:
- **First visit:** the page loads without isolation, registers the file as a service worker, and reloads once the worker is active.
- **After that:** the worker re-serves every response with both headers, COEP as `credentialless`, so the page is isolated from the start.
- **Whole origin:** the worker's scope is the whole origin, so another project served later from the same address and port gets the headers too.

With isolation, ORT runs its default of min(4, ⌈cores / 2⌉) threads, which `OnnxModel.js` leaves alone. In headless Chrome on an M2 Max, through the proxy worker, InfrDrawings' 320 × 240 model took 1.41 s a frame on one thread and 0.41 s on four. Eight took 0.32 s. All three gave the same output on every value. Monitor's second-screen window still works: `window.open('', '_blank')` opens a blank page of the same origin, which COOP leaves scriptable from the opener.

## Development Conventions

- **State Management**: The `ConnectionGraph` is the source of truth for the patch state.
- **Node Height**: a node's inputs share one row under its header (`NodeGraphUI._portSection()` reserves `28px` only when `mod.inputs.length > 0`, and `0` on input-less source/generative modules), parameter rows (`20px` each) follow immediately, any preview and file-picker button sit below the parameters, and `getModuleHeight()` reserves a dedicated bottom section (`35px` when `mod.outputs.length > 0`, `8px` otherwise) so output ports and their labels never overlap previews or buttons.
- **Rendering**: Modules should always render to their `outputFBO` during `process()`. Calculator, Constant, Random and Remap have none, since they output only control values. The `Monitor` and `GRASS` modules provide previews by blitting their FBOs to the main P2D canvas in `js/ui.js`.
- **Parameters**: Module parameters are normalized or use specific ranges defined in the `params` object. The UI handles scaling these values for display.
- **Coordinate System**: p5.js uses a 2D coordinate system for the UI (top-left 0,0), while the WebGL `glCanvas` uses standard GL coordinates (centered 0,0 or screen-space depending on usage).
- **Pixel Density**: framebuffers are allocated at the graphics' pixel density, so on a retina display `gl_FragCoord` runs over twice as many pixels as `glCanvas.width` / `glCanvas.height` report. A shader that works in `gl_FragCoord` space — or that derives a texel step from a resolution — must be given `Module.fragResolution()` rather than the logical size, and any pixel-valued uniform the shader compares against `gl_FragCoord` must be scaled by `Module.pixelDensity` (Conway's spawn position, radius and cell size; GridGuys' target). Getting this wrong confines the output to one quadrant, and in a feedback shader it also reads off the clamped edge. Shaders that address themselves through `vTexCoord` are unaffected, which is most of them — only `conway`, `dither`, `gridguys-simulation`, `inkdrops` and `spiralgalaxy` read `gl_FragCoord` (`cyberlace` uses it for a `mod(…, 2.0)` dither that is deliberately one physical pixel wide, and RuttEtra's grid pass to count the texels of a buffer of density 1).
- **Output Sizes**: every module's output is the frame's size (see Frame Size), except Restore's and Resample's, which are their Width × Height (see Restore Module and Resample Module). An input read by uv works at any size. A module that needs its input's size in pixels reads `fbo.width * fbo.density` from the framebuffer, as DepthAnything does, instead of assuming `fragResolution()`. Never write 640 or 480: read `glCanvas.width` and `glCanvas.height` when needed, and size anything that follows the frame in `frameResized()`.
- **Framebuffer Orientation**: `NodeGraphUI` blits an FBO to the P2D canvas through a shader that flips `v`, so within a framebuffer `gl_FragCoord.y = 0` is the *top* of the displayed image. A pass that reads a buffer it also writes (feedback, ping-pong) must address it with the unflipped `gl_FragCoord.xy / resolution`: `v = y / H` is by definition the row being written, and reading through a flipped uv mirrors the buffer on every iteration. `InkDrops` and `SpiralGalaxy` both carry notes on this.
- **No `glCanvas.image()` in `process()`**: p5 draws `image()` through the bound shader whenever that shader has a sampler, not through its own texture shader. Between frames the bound shader is one of `NodeGraphUI`'s preview shaders, because `framebuffer.end()` pops each module's own `shader()` call back off. An `image()` copy therefore draws whatever the UI blitted last, instead of the image. This is what turned Dither's error diffusion solid black. To read an upstream frame, bind it as a sampler uniform. To copy one, draw it through a shader you bind yourself.
- **Give a hand-built `p5.Geometry` its own `gid`**: `model()` caches a geometry's GPU buffers under `geometry.gid`, and `new p5.Geometry()` leaves it undefined. Two such geometries then share the cache key `undefined`, and the second draws the first's buffers. Whitney sets `geometry.gid = 'Whitney|<n>'` and frees it with `freeGeometry()` in `dispose()`. `SegmentRenderer` does the same, named for the module it draws for (`'Latk|<n>'`, `'Twoscilloscope|<n>'`), and so do Mesh (`'Mesh|<n>'`), Panorama, SlowscanJam and RuttEtra. RuttEtra rebuilds its geometry, so it also frees the one each replaces. A geometry with many faces should also get one edge of its own, as RuttEtra's does, unless it is drawn with strokes: otherwise the first `model()` builds stroke geometry for every edge.
- **Set every sampler**: bind a texture to every sampler uniform a shader declares, even one the current code path won't read. p5 binds a placeholder to an unset sampler, and the first time it creates that placeholder it lands on whichever texture unit is active, blanking another input for that frame. The LUT module binds its input as a stand-in until a LUT loads.
- **Set samplers again before every draw**: after each draw call p5 points every sampler of the bound shader at an empty texture. A module that draws several times with one shader (several `model()` calls, say) must set its samplers again before each one, or every draw after the first samples nothing. SlowscanJam does this for each batch of lines.

