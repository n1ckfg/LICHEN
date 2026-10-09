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
- `js/pipeline.js` — `ProcessingPipeline`: holds the `ConnectionGraph`, drives per-frame processing
- `js/graph.js` — `ConnectionGraph`: DAG of modules; tracks video `connections` and parameter `controlConnections`; re-runs topological sort on every structural change; serializes/deserializes the full patch as JSON. This is the source of truth for patch state.
- `js/moduleRegistry.js` — global module registry; `registerModule(typeName, class)` / `createModule(typeName, glCanvas, id)` for the UI, and `createModuleByUid(uid, glCanvas, id, savedType)` for loading patches. It checks every module's ids (see Patch IDs)
- `js/ui.js` — `NodeGraphUI`: full node graph editor drawn on the p5.js P2D canvas, with a DOM sidebar palette and right-click search popup; handles pan/zoom, node drag, cable wiring, parameter knobs, and monitor preview rendering
- `js/modules/Module.js` — base class for all modules; defines common behavior for shaders, FBOs, and parameters, plus seeded randomization and trigger params
- `js/stringseed.js` — `StringSeed`, the SSoT seed-to-choice mapping behind `Module.randomize()` (ported from the StringSeedGenerator project)
- `js/shaders/vert.js` — the shared vertex shader used by all modules for screen-quad rendering
- `workflows/` — contains JSON patches (connection graph state, module types, and parameter values) that can be loaded via Ctrl+O
- `tools/convert-workflows.mjs` — converts patches saved before ids to the id format, using the frozen table in `tools/legacy-ids.json` (see Patch IDs)

### Module System (`js/modules/`)

All modules extend `Module` (base class in `js/modules/Module.js`) and call `registerModule()` at the bottom of their file. Modules must be explicitly imported in `js/main.js` to be registered.

Every module that produces video output:
1. Calls `this.createShader(fragSrc)` and `this.createOutputFBO()` in its constructor
2. Overrides `process(graph, glCanvas)` to render into `this.outputFBO` using its GLSL shader
3. Reads upstream video via `this.getInput(graph, portIndex)` which returns the upstream module's `outputFBO`

Modules can also export control values by setting `this.controlValues['portName'] = value` during `process()`. These values are read via `this.getControlValue(portIndex)` and can be routed to downstream module parameters via parameter cables (`controlConnections`).

A control value is one number a frame, and a parameter cable applies it after every module has processed. Some sources carry more, such as a whole loop of audio samples each frame:
- **Control signals:** a control output can also publish a loop in `this.controlSignals['portName']`, as `{ samples, sampleRate, z, color }`. `samples` is a `Float32Array` in −1..1. `z` (blanking, XYscope's −1 off and 1 on) and `color` (0xRRGGBB a sample) are optional lanes the same length, or `null`. It should still set a numeric `controlValues` entry for the same port, because a knob cable sees only that.
- **Control input pins:** an input declared `{ name, type: 'control' }` is drawn green, as is a cable into it, and takes a control output's cable. The cable is stored in `connections`, like a video cable, so the topological sort runs the source first, in the same frame. `this.getControlInput(graph, portIndex)` returns `{ value, signal }`: the source's control value and its control signal, or `null` for the signal if it has none. It returns `null` when nothing is cabled to the pin, or when a video output is.

Latk's, NAPLPS's and Skeleton's X and Y outputs and Twoscilloscope's X and Y pins are the only ones so far (see Latk Module, NAPLPS Module and Skeleton Module).

The UI renders each param in the `params` object: `{ paramName: { id, value, min, max, step, label } }` as a draggable knob. A param may add `valueLabels: [...]`, an array indexed by the rounded param value; when it has an entry for the current value the knob shows that name instead of the number.

A param that also sets `widget: 'dropdown'` is drawn as a drop-down menu instead of a knob. Every named-mode param uses one: AdderMultiplier `mode`, Blur `mode`, Displacer `xChannel`, `yChannel` and `edges`, Dither `mode` and `color`, Edges `mode`, FunctionGenerator `curve`, LUT `preset`, Oscillator `waveform` and `direction`, QTVR `projection`, Restore `model`, `size` and `clamp`, Sharpen `posterize`, Skeleton `trace` and `hold`, Slitscan `axis`, SlowscanJam `blend`, `effect` and `sync`, SyncGenerator `mode`, Twoscilloscope `view`, `effect` and `sound`, VideoMixer `mode`, VideoToasting `effect` and Whitney `sketch`. Its `valueLabels` are the menu's options, and `min`/`max`/`step` should still run `0`…`valueLabels.length - 1` in steps of 1. It is still a plain numeric param, so it saves, loads and duplicates like a knob does. The row shows a small inlet dot where the knob would be, then the label, then a box with the selected option. An option too long for the box is cut short with an ellipsis; the menu itself grows to show it in full. Clicking the box opens the menu, which is a **DOM overlay** (`.param-dropdown`, styled in `css/style.css`). `NodeGraphUI._updateDropdownMenu()` keeps it pinned under the box through pan and zoom every frame, and opens it upward when there is no room below. Choose an option with a click, or with the arrow keys and Enter; Escape or any click outside closes it. The menu catches keys with a capture-phase `keydown` listener on `window`, which runs before p5's own handler, so Backspace/Delete can't delete the node while it is open. A control cable plugs into the inlet dot as it would into a knob and drives the value through the usual `min + cv × (max − min)` scaling, so a module has to round the value itself, the same way the box does: `Math.round` in JS, or `x < k + 0.5` thresholds in GLSL (not `Math.floor`). While a cable is connected the box shows the live option and won't open. With no cable, the dot is only a cable target: dragging it does not change the value.

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

**Full-size copies.** Fullscreen, the second-screen window and the recording still copy glCanvas whole: `_blitFBO()` fills glCanvas with one framebuffer, which leaves no page in it, and `_drawFBO()` copies it. A tile that won't fit on glCanvas is drawn that way too, which can't happen at the UI's zoom limits.

### Module Categories

- **Sources**: Camera, Image, VideoPlayer
- **Utility**: Blur, Brcosa, Channel, Dither, Edges, Levels, LUT, Mosaic, Restore, Sharpen, Skeleton, VideoMixer
- **Generative**: Cloudy, Coils, Crystalline, GridGuys, Protozoa, SpiralGalaxy, Whitney
- **Interactive**: Conway, GRASS, InkDrops, Latk, Yellowtail
- **Analog**: SlowscanJam, Twoscilloscope
- **Sandin**: AdderMultiplier, ColorEncoder, Comparator, Differentiator, FunctionGenerator, Oscillator, SyncGenerator, ValueScrambler
- **Effects**: BooleanLogic, BufferSmear, Cyberlace, DeeSeventySix, Delay, Displacer, FilmGrain, GameBoy, Glitch, HSFlow, HyperCard, LuminanceDelay, Maelstrom, PixelVision, RuttEtra, Slitscan, SpatialSlice, TimeTunnel, TVLines, UnrealBloom, VHSC, VideoToasting
- **Archival**: NAPLPS, QTVR, VRML
- **Output**: Monitor

### Shaders (`js/shaders/`)

Fragment shaders are stored as JS template literal exports (e.g., `export const oscillatorFrag = \`...\``). `js/shaders/vert.js` exports the vertex shader `vertSrc` shared by all modules. Most modules import their own fragment shader from here.

### Framebuffers

Unasked, p5 1.9 gives a framebuffer 2× MSAA wherever the user agent contains "safari", which Chrome's does, plus a float depth-stencil buffer. At 1280×960 that is about 44 MB a framebuffer, against 4.9 MB for its colour alone, and `end()` resolves the colour and the depth every time. A quad that covers the whole frame uses neither. So `Module.createFramebuffer(options)` makes one with `{ antialias: false, depth: false }` unless the options say otherwise, and `createOutputFBO()` uses it. Every module makes its framebuffers this way except where it draws geometry, whose edges MSAA smooths:
- **p5's default:** Latk, RuttEtra, Skeleton, Twoscilloscope and Whitney draw into their output with `glCanvas.createFramebuffer()`, unchanged.
- **Their own options:** QTVR, VRML and SlowscanJam's screen, as before.

Firefox's user agent has no "safari", so it always drew these framebuffers this way. In the 19-node patch, a frame went from 4.7 to 3.1 ms at pixel density 2. In headless Chrome, every module fed colour bars on every input outputs the same as before on every pixel after 60 frames, at pixel density 1 and 2, except one pixel each of Coils and Protozoa, by one level. Both come from the quad's diagonal. Under MSAA, a pixel the diagonal crosses is shaded by both triangles and the two results averaged, and their interpolated `vTexCoord` differ by rounding.

## Adding a New Module

1. Create `js/shaders/mymodule.js` exporting the fragment shader source
2. Create `js/modules/MyModule.js` extending `Module`, defining `inputs`, `outputs`, `params`, and `process()`; call `registerModule('MyModule', MyModuleClass)` at the end
3. Give the class a fresh `static uid` (`openssl rand -hex 4`), and each param and port a fresh `id` (`openssl rand -hex 2`). Never copy them from another module, even when starting from its file (see Patch IDs)
4. Import `'./modules/MyModule.js'` in `js/main.js`
5. Add the type name to the appropriate category in `MODULE_CATEGORIES` in `js/ui.js`

## Patch IDs

A patch saves modules, params and ports by id, never by name or port number, so any of them can be renamed or reordered without breaking saved patches:
- **Modules.** Each module class declares `static uid = '<8 hex digits>'`. A saved node has `uid`, which `createModuleByUid()` builds it from, and `type`, which is only there to make the file readable. Loading never reads `type`.
- **Params and ports.** Each param and port declares `id: '<4 hex digits>'` next to its name. These only need to be unique within their module, since a node's uid already says which module they belong to. Params, inputs and outputs share that one namespace. A saved node's `params` are keyed by param id. A video cable's `fromPort` and `toPort` are port ids, and a knob cable has `fromPort`, a port id, and `param`, a param id.

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

**Params.** Speed sets how fast each command's points are revealed. Loop Hz (1–100, default 5) is the loops a second on X and Y, as Latk's: a lower rate gives the drawing more samples.

**X and Y.** Like Latk, NAPLPS has X and Y control outputs, which carry what it draws each frame as one loop of XY audio to drive Twoscilloscope (see Latk Module). As each command is drawn, its outline goes into the loop in the command's colour:
- **Polygons, lines and points:** the points revealed so far, closed back to the first, as they are drawn.
- **Rectangles:** their four sides.
- **Arcs:** the full circle, in 72 sides, since the module draws every arc as a circle. The box runs down and to the right of the first point whatever the sign of its size, as p5 draws it.
- **Filled shapes:** the beam can't fill, so they are traced as outlines.
- **Left out:** text, and anything with no length (a single point), which a canvas doesn't stroke either.

Outlines are cut at the canvas edge, as Latk's strokes are. `images/test.nap` is 1,595 filled polygons, which give 1,566 outlines once those with no length are left out. All of them fit in a loop at the default 5 Hz. A busier file loses its shortest outlines first (see Latk's X and Y). Before a file loads, the loop is all blank, so the beam rests unlit in the middle. Adding the outputs left the video unchanged: in headless Chrome, `test.nap` plays back on every pixel as it did before, at three points in its reveal. Twoscilloscope's Original Lines, fed from X and Y, lay over the video's polygons, rectangles and arcs in `test.nap` and in TEIA_TELIDON_ETC's `beer.nap`, `email2.nap` and `memra2.nap`.

## QTVR and VRML Modules

Two Archival sources ported from the p5.js viewers in the vrml-qtvr-viewer project (`p5js/js/qtvr-viewer-p5.js` and `vrml-viewer-p5.js`). Each loads a file with the same hidden `<input type="file">` pattern as Image and NAPLPS, and the node's button shows the loaded file's name. As with Image, the file itself is not saved in patches.

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

## Image Module

The Image module (`js/modules/ImageModule.js`) is a source that loads a still image file and outputs it as video.

**File loading:** Uses the same hidden `<input type="file">` pattern as NAPLPS and VideoPlayer, accepting any image format the browser supports (`accept="image/*"`). The node's "Load Image…" button triggers the picker via `pickFile()`. On load, `p5.loadImage()` decodes the file into a `p5.Image` stored as `this.img`.

**Parameters:** `width` and `height` are set to the image's native pixel dimensions on load. The user can then adjust them via the knobs; `process()` redraws the image into the `p5.Graphics` buffer at the current param dimensions, centered on a black background, every frame.

**Rendering path:** The 2D `p5.Graphics` buffer is mapped to the module's WebGL `outputFBO` via the passthrough shader, identical to Camera and VideoPlayer.

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

The InkDrops module (`js/modules/InkDropsModule.js`, `js/shaders/inkdrops.js`) is an interactive module: a sheet of cold-press paper worked in watercolour. Splashes bloom and shatter, fat drops fall in from off-screen and soak out huge, and a wet rag is dragged across the sheet, lifting pigment back off. Ported from the WebGL2 sketch `splottissimo.html`.

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

The Channel module (`js/modules/ChannelModule.js`, `js/shaders/channel.js`) builds a picture from the channels of up to three inputs: red from `r`, green from `g` and blue from `b`, each times its gain (R Gain, G Gain and B Gain, 0–3, default 1), clamped to 0–1. A grey source gives its brightness to the channel it is cabled to. The output is opaque.

**Inputs.** Each pin feeds only its own channel, and an unplugged channel is black. A lone input on `r` shows only its red channel, two inputs show two channels, and the same picture cabled to all three pins passes through unchanged at gains of 1. With none, the output keeps its last frame, as VideoMixer's does.

**Checked.** In headless Chrome, on random-noise inputs, a lone input on each pin comes out as that one channel exactly, with the other two at 0, and two inputs give their two channels with the third at 0. Three different inputs, and the same input on all three pins, take each channel from its pin exactly. With gains of 0.5, 1.7 and 0, every pixel is `round(input × gain)`, clamped. The two- and three-input cases are unchanged from when a lone input fed all three channels.

## Restore Module

The Restore module (`js/modules/RestoreModule.js`, `js/modules/anime4k/`, `js/shaders/anime4k/`, `js/shaders/restore.js`) runs the Restore CNNs from bloc97's Anime4K v4.0. They are small convolutional networks trained to rebuild anime line art that blur, resampling and compression have softened. They don't change the frame's size, so Restore is an ordinary utility filter. Because they were trained on line art, they sharpen edges in any picture, and in camera or generative video they can invent line structure.

**Params.**

| Param | Label | Options | Default | Sets |
| --- | --- | --- | --- | --- |
| `model` | Model | Restore, Restore Soft | Restore | Anime4K's two families: Restore is tuned for blur and upsampling artifacts, Restore Soft for downsampling artifacts and aliasing |
| `size` | Size | S, M, L, VL, UL | M | The network's size; each step costs about twice the last (see Cost). Anime4K's Fast presets use M |
| `clamp` | Clamp | Off, On | On | Anime4K's Clamp_Highlights, which Anime4K recommends always using. After Amount, it pulls each pixel's luminance down to the input's maximum over the 5 × 5 pixels around it, so edges don't ring or overshoot |
| `mix` | Amount | 0–4 | 2 | How far the picture moves from the input (0) toward the restored picture (1), and past it above 1 |

Patches save Model and Size as indexes, so a new model (Anime4K's GAN ones, say) is appended, never inserted.

**Amount.** Each network ends by adding its output to the input (`return result + MAIN_tex(MAIN_pos)`), so what it computes is a small correction to the picture. At 1 that correction is all Restore does, which is hard to see. On a 640×480 photo, M changed pixels by a mean of 3.9 levels, against 19.7 for Sharpen at its default 5. On the same photo upscaled 2× (a retina display) it changed them by 1.8. Amount scales the correction: the output is `input + Amount × (restored − input)`. The key is still `mix`, as it was when the knob stopped at 1, so older patches load unchanged.
- **Amount 2 and 4:** these change the photo by a mean of 7.6 and 13.6 levels.
- **No added noise:** the correction is near zero in flat areas, so it adds no noise there. On the photo's sky, high-frequency noise stays at 0.5 levels at Amount 3, where Sharpen 5 raises it to 3.2.
- **Why the default is 2:** the networks under-correct. On the photo halved and doubled with bilinear filtering, M scored 25.01 dB against the clean photo at Amount 1, and 25.16 dB at 2.

Two other ways of strengthening it were tried in numpy and dropped. Running the network at half or quarter resolution changed the picture a little less than Amount 1 (means of 3.1 and 3.3), and softened fine detail. Running it twice in a row changed it about as much as Amount 2, at twice the cost.

**Files.** Each model is one of Anime4K's mpv user shaders, copied unchanged from its `glsl/Restore/` at commit 7684e95 into `js/shaders/anime4k/` as a JS default export, MIT licence included. A file is a list of passes, each a block of `//!` directives and a `hook()` that reads named textures through mpv's macros. `anime4k/mpvHook.js` turns each pass into a p5 shader:
- **Textures:** each bound texture becomes a sampler and a size uniform, and the macros read it at the fragment's own uv, offset in texels.
- **Orientation:** mpv puts +y down the image, as a LICHEN framebuffer does (v = 0 is the top row), so offsets carry over unchanged.
- **Scope:** it handles what Restore uses and no more. Every pass is its input's size, and any other WIDTH, HEIGHT, WHEN or hook is rejected.

**Running.** The module runs the passes in order, each into its own half-float buffer, which later passes bind by its SAVE name. The features are signed, so 8-bit buffers would lose half of them, and without half-float framebuffers the module passes its input through. With Clamp on, Clamp_Highlights' two statistics passes run first, on the input. `restoreMixFrag` then applies Amount and writes `outputFBO`, keeping the input's alpha. With Clamp on, it also does Clamp_Highlights' clamp, reading the statistics. In mpv the clamp is the file's PREKERNEL pass, after the model. Here it comes after Amount, so a large Amount can't bring back the overshoot it removes. The file is still copied unchanged, and its PREKERNEL pass is compiled but never run. The passes run under `blendMode(REPLACE)`, as Blur's do, since the alpha channel carries a feature like the others.

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

**Cost.** In ms per frame on an M2 Max, with Clamp on:

| Size | Density 1 (640×480) | Density 2 (1280×960) |
| --- | --- | --- |
| S | 0.55 | 1.35 |
| M | 0.81 | 2.4 |
| L | 2.3 | 7.2 |
| VL | 4.7 | 15–18 |
| UL | 15 | 54 |

Restore Soft costs the same, and Clamp adds about 0.2 ms at density 1. UL can't hold 60 fps on its own, and at density 2 neither can VL. The first frame drawn with a newly loaded model took up to 21 ms at density 1 and 69 ms at density 2.

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

The VideoMixer module (`js/modules/VideoMixerModule.js`, `js/shaders/video-mixer.js`) composites input B over input A. The operation is chosen with the `mode` drop-down. `mix` acts as B's opacity: the output is `mix(A, op(A, B), mix)`, so Blend reproduces the old crossfade exactly, and `mix = 0` passes A through in every mode.

| mode | Label | op(A, B) |
| --- | --- | --- |
| 0 (default) | Blend | B |
| 1 | Add | A + B |
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

## VideoToasting Module

The VideoToasting module (`js/modules/VideoToastingModule.js`) ports the 14 NewTek Video Toaster transitions from the VideoToasting project. Input A is the outgoing source (the Toaster's Main bus) and B the incoming one (its Preview bus), and each effect wipes between them on its own loop. The `effect` drop-down picks the effect and `speed` scales its clock. As in VideoMixer, a lone input feeds both A and B.

**Effect files.** Each effect is its own fragment shader in `js/shaders/videotoasting/`, kept apart from the main shaders folder. `js/shaders/videotoasting/index.js` lists them in the order of the VideoToasting project's `index.html`, and that list supplies the drop-down's options. Patches save the effect as its index, so a new effect is appended to that list, never inserted. The module creates one p5 shader per effect, and since p5 compiles a shader the first time it is bound, an effect costs nothing until it is chosen.

**Port notes.** The shaders are the originals with three changes: precision is `highp`, the unused `uResolution` uniform is gone, and `uTime` is an accumulated clock (`time += dt × speed`) instead of `frameCount × 0.016`. At speed 1 it runs in seconds, which matches the originals at 60 fps, and turning Speed doesn't jump the effect. Both projects sample with `vTexCoord.y = 0` at the top of the image, so nothing needed flipping. As in the originals, shapes are drawn in uv space without aspect correction, so the circles in Bear, Camera Iris, Trails and Transporter stretch to the frame.

## Displacer Module

The Displacer module (`js/modules/DisplacerModule.js`, `js/shaders/displacer.js`) works like After Effects' Displacement Map. It displaces input `in` by the brightness or colour of input `map`. Each output pixel reads one channel of the map at its own position and turns it into a signed amount, `d = (255 v − 128) / 128`. A map value of 0 is the full negative shift, 128 none, and 255 the full positive one (127/128 of it). The pixel then samples the input that far away:

`out(x, y) = in(x + d_x × X Max, y + d_y × Y Max)`

Sampling ahead moves the picture the other way, as in After Effects. Where the map is white and X Max is positive, the image slides left, and with Y Max positive it slides up. X Max and Y Max are in pixels of the logical 640×480 frame, from −640 to 640 and −480 to 480, so the result doesn't change with pixel density. Both default to 20.

**Channels.** `xChannel` (X From) and `yChannel` (Y From) pick the channel that drives each axis. Their options follow After Effects' "Use For" menu, in its order. Patches save the option as its index, so a new one is appended, never inserted.

| Option | Amount from |
| --- | --- |
| Red, Green, Blue, Alpha | That channel. X defaults to Red and Y to Green, as in After Effects |
| Luminance | `(0.299, 0.587, 0.114)` weights |
| Hue, Lightness, Saturation | HSL |
| Full | The full positive shift everywhere, so the whole image slides by X Max and Y Max |
| Half, Off | No shift |

**Edges.** The `edges` drop-down says what a pixel sampled from beyond the frame shows. Clamp (the default) repeats the edge pixels. Wrap tiles the input, which is After Effects' Wrap Pixels Around. Mirror reflects it, and Black shows opaque black. Wrap shows a seam one pixel wide, because the input textures clamp at their edges, so the bilinear filter can't blend across the join.

**Inputs.** A lone input feeds both, as in VideoMixer, so a video connected on its own displaces itself. After Effects' Displacement Map Behavior (centre, stretch or tile the map) and Expand Output have no counterpart here, because every module's output has the same size.

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

Both modules implement time-based effects that require random access to a ring buffer of past input frames. The original WebGL2 reference (ShaderPadTests `slitscan-slow-luminance.html` and `slitscan-wiggle-spatial.html`) stores history in a `sampler2DArray`, which isn't available in WebGL1. LICHEN emulates this with a 2D **tile atlas**: a single framebuffer holding an 8×8 grid of 64 downscaled history frames (tile size = `glCanvas / 4` per axis, so the atlas is `glCanvas.width × 2` by `glCanvas.height × 2`).

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

The Latk module (`js/modules/LatkModule.js`, `js/modules/latk/`, `js/shaders/latk.js`) is an interactive source. It plays back a Latk drawing (from the Lightning Artist Toolkit) and draws each frame as lines in its strokes' colours, seen through an orbiting camera. Its X and Y control outputs carry the frame as a loop of XY audio, which drives Twoscilloscope. Together the two are Twoscilloscope's `example-latk`, with the drawing split from the scope. The node starts with `jellyfish.latk`, bundled in `files/latk/` from `example-latk`. "Load .latk…" picks another drawing, either a `.latk` file or the JSON inside one, and the button then shows its name. As with VRML, the file itself is not saved in patches.

**Files:**
- `latk/readLatk.js` reads the drawing, in place of latk.js. latk.js bundles JSZip, and reads a global called `latk` while it parses. This reader finds the JSON through the zip's central directory and inflates it with `DecompressionStream('deflate-raw')`, as VRML does without pako.
- `latk/OrbitCamera.js` is `example-latk`'s camera without its mouse handling, which is now in the module and turns knobs.
- `latk/strokes.js` holds the example's drawing half:
  - `projectFrame()` is the example's `project()`. It puts the current frame of each layer through the camera, breaks a stroke where it goes behind the camera, and cuts it where it leaves the canvas.
  - `encodeLoop()` is the first half of the example's `encode()`, which turns those pieces into one loop of XY audio (see X and Y).
  - `XYOutputs` publishes that loop on a module's X and Y outputs each frame, and keeps the beam's place in it for knob cables. NAPLPS and Skeleton use it too, with `polylinePieces()`, which cuts a polyline at the canvas edge into pieces as `projectFrame()` cuts strokes. A polyline given no colour gets none on X and Y, so Twoscilloscope draws it in its default white.
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
- `js/libraries/p5.twoscilloscope.js` is the library. It is a classic script that puts its classes on the global scope, so the module imports it only for that side effect. It is copied unchanged apart from three lines that let SlowscanJam's worker load it: with no `document`, it skips the warning about p5 and finds its own URL from `location`, and it assigns its classes to `globalThis` instead of `window`.
- `audiofx/EffectRack.js` holds the effect chain, the Effect drop-down and the knobs, which SlowscanJam shares (see Audio Effects).
- `twoscilloscope/ScopeRenderer.js` is the second half of the example's `LatkScopeRenderer`, which runs the loop through the effects and turns each view into a point stream. Its first half, projecting and encoding the drawing, is now in `latk/strokes.js`.

**X and Y.** `_readInputs()` makes one loop from the two pins (see Module System):
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

**Cost.** At 1280×960 (a retina display) on an M2 Max, a frame costs 4.3–5.7 ms, depending on the view, with Latk's drawing coming in. Most of that is running the effects on the CPU, and Decoded Strokes adds about 1.5 ms of decoding.

## Audio Effects

`js/modules/audiofx/EffectRack.js` holds the audio effects Twoscilloscope and SlowscanJam share: the eleven effects of `example-latk`'s chain, from p5.twoscilloscope, an Effect drop-down that turns them on, and the Effect A and Effect B knobs that set them. It touches neither the DOM nor p5, so SlowscanJam's worker imports it too.
- **`CHAIN`** lists the effects in the example's order, and the setting each knob turns while one is on. `knobFor()` gives the knob position for a setting, so a module can set a knob's default from it.
- **`EffectMenu`** builds a module's drop-down from that module's own options, followed by one option per effect. Twoscilloscope's are Low Pass + Delay and None (`NONE`); SlowscanJam's is None. Patches save the option as its index, so a module's own options never change, and a new effect is appended to `CHAIN`. `params()` gives the drop-down and both knobs as module params. `resolve()` turns their values into plain data, `{ on, set }`, and relabels the knobs for the option. `nextSolo()` and `none` are the example's E and N keys.
- **`EffectRack`** holds one of each effect, added to an `XYEffectChain`. `apply()` puts every setting back to the library's default, turns on the effects in `on`, and then sets the knobs' settings from `set`. Twoscilloscope's rack is its `XYTransformer`'s chain, which restarts the effects every frame (see Twoscilloscope Module).
- **`EffectStream`** runs a rack over a signal that runs on from one call to the next, as SlowscanJam's fields do, keeping the effects' state between calls (see SlowscanJam Module). It restarts them when the option changes, so an effect turned back on doesn't replay what it held before. It also restarts them when Noise Seed changes, the one setting an effect reads only on a restart. `process()` can protect part of the signal: given a mask, it feeds the effects only the masked samples, scales them going in and back coming out, clamps them, and leaves the rest as they were.

## Skeleton Module

The Skeleton module (`js/modules/SkeletonModule.js`, `js/modules/skeleton/`, `js/shaders/skeleton.js`) is a utility based on Twoscilloscope's `experiments/camera_trace`, without that example's camera and edge shader. It thins a black and white input to its centre lines, one pixel wide, and follows them into polylines. Its X and Y control outputs carry them as one loop of XY audio, as Latk's do, to drive Twoscilloscope. It has no video output, and its node preview shows the traced lines in green, 2 px wide, as camera_trace drew them. To trace a picture's outlines, patch Edges in front of it.

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
| `minLength` | Min Length | 0–100 px | 0 | Lines shorter than this, in px of the 640×480 frame, are left out of X, Y and the preview |
| `loopHz` | Loop Hz | 1–100 | 5 | Loops a second on X and Y, as Latk's |

**A trace goes through three stages:**
1. **Mask:** the input shrinks to the grid, one texel a cell (`skeletonMaskFrag`). A cell is white if at least Fill of an 8 × 8 grid of taps across it pass the threshold, and at least one does. At Fill 0, any one tap will do. camera_trace read one pixel per cell, and averaging would lose any line thinner than a cell, such as an Edges outline. The tracer thins whatever this widens. Raising Fill drops specks that cover only part of a cell and stops shapes from widening: at 0.5 a cell must be half covered, and at 1 wholly. A line thinner than a cell breaks up and then goes. On 2 px cells, a 1 px line covers half of each cell, so it breaks where it steps from one row of pixels to the next above Fill 0.25, and is gone above 0.5.
2. **Readback:** the mask is read into a pixel buffer behind a fence, polled once a frame, so the main thread never waits on the GPU (`PixelReadback`, as SlowscanJam does). WebGL1 reads at once.
3. **Tracing:** the worker writes the mask into the wasm heap, one byte a cell, and calls the tracer's `trace()` with a pointer to it. camera_trace built a string of `\0` and `\1`, one character a pixel, for `fromCharString()`, which encoded it into the heap. The pointer gives the same polylines 25–40% sooner. The worker parses the tracer's text into typed arrays, which it transfers back.

A new mask starts every frame, even while the worker traces the last one. The newest waits for the worker, and any older is dropped, so each trace is of the freshest mask. A trace that finishes after the input is unplugged is dropped.

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

## Yellowtail Module

The Yellowtail module (`js/modules/YellowtailModule.js`) implements Golan Levin's interactive kinetic gesture system, ported from a p5.js version.

**Rendering path:** The module internally creates an off-screen `p5.Graphics` context (`this.pg`) in 2D mode. Gestures are simulated and compiled into polygon meshes which are drawn to this 2D buffer every frame using standard p5 shape functions. The resulting 2D canvas texture is then piped into the module's WebGL `outputFBO` via the passthrough shader.

**Fullscreen interaction:**
- Double-click the node preview to enter fullscreen.
- Click, drag, and release to create repeating kinetic gestures.
- ESC exits fullscreen; C clears the canvas.

## Development Conventions

- **State Management**: The `ConnectionGraph` is the source of truth for the patch state.
- **Rendering**: Modules should always render to their `outputFBO` during `process()`. The `Monitor` and `GRASS` modules provide previews by blitting their FBOs to the main P2D canvas in `js/ui.js`.
- **Parameters**: Module parameters are normalized or use specific ranges defined in the `params` object. The UI handles scaling these values for display.
- **Coordinate System**: p5.js uses a 2D coordinate system for the UI (top-left 0,0), while the WebGL `glCanvas` uses standard GL coordinates (centered 0,0 or screen-space depending on usage).
- **Pixel Density**: framebuffers are allocated at the graphics' pixel density, so on a retina display `gl_FragCoord` runs over twice as many pixels as `glCanvas.width` / `glCanvas.height` report. A shader that works in `gl_FragCoord` space — or that derives a texel step from a resolution — must be given `Module.fragResolution()` rather than the logical size, and any pixel-valued uniform the shader compares against `gl_FragCoord` must be scaled by `Module.pixelDensity` (Conway's spawn position, radius and cell size; GridGuys' target). Getting this wrong confines the output to one quadrant, and in a feedback shader it also reads off the clamped edge. Shaders that address themselves through `vTexCoord` are unaffected, which is most of them — only `conway`, `dither`, `gridguys-simulation`, `inkdrops` and `spiralgalaxy` read `gl_FragCoord` (`cyberlace` uses it for a `mod(…, 2.0)` dither that is deliberately one physical pixel wide).
- **Framebuffer Orientation**: `NodeGraphUI` blits an FBO to the P2D canvas through a shader that flips `v`, so within a framebuffer `gl_FragCoord.y = 0` is the *top* of the displayed image. A pass that reads a buffer it also writes (feedback, ping-pong) must address it with the unflipped `gl_FragCoord.xy / resolution`: `v = y / H` is by definition the row being written, and reading through a flipped uv mirrors the buffer on every iteration. `InkDrops` and `SpiralGalaxy` both carry notes on this.
- **No `glCanvas.image()` in `process()`**: p5 draws `image()` through the bound shader whenever that shader has a sampler, not through its own texture shader. Between frames the bound shader is one of `NodeGraphUI`'s preview shaders, because `framebuffer.end()` pops each module's own `shader()` call back off. An `image()` copy therefore draws whatever the UI blitted last, instead of the image. This is what turned Dither's error diffusion solid black. To read an upstream frame, bind it as a sampler uniform. To copy one, draw it through a shader you bind yourself.
- **Give a hand-built `p5.Geometry` its own `gid`**: `model()` caches a geometry's GPU buffers under `geometry.gid`, and `new p5.Geometry()` leaves it undefined. Two such geometries then share the cache key `undefined`, and the second draws the first's buffers. Whitney sets `geometry.gid = 'Whitney|<n>'` and frees it with `freeGeometry()` in `dispose()`. `SegmentRenderer` does the same, named for the module it draws for (`'Latk|<n>'`, `'Twoscilloscope|<n>'`).
- **Set every sampler**: bind a texture to every sampler uniform a shader declares, even one the current code path won't read. p5 binds a placeholder to an unset sampler, and the first time it creates that placeholder it lands on whichever texture unit is active, blanking another input for that frame. The LUT module binds its input as a stand-in until a LUT loads.
- **Set samplers again before every draw**: after each draw call p5 points every sampler of the bound shader at an empty texture. A module that draws several times with one shader (several `model()` calls, say) must set its samplers again before each one, or every draw after the first samples nothing. SlowscanJam does this for each batch of lines.

