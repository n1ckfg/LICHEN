# LICHEN - Modular Video Synthesizer

LICHEN is a browser-based modular video synthesizer inspired by the Sandin Image Processor (IP). It allows users to build complex real-time video processing patches by connecting various modules in a directed acyclic graph (DAG).

## Project Overview

- **Core Technologies**: [p5.js](https://p5js.org/), WebGL (via p5.WEBGL), ES Modules.
- **Architecture**: A node-based processing pipeline where each module renders to its own WebGL framebuffer (FBO).
- **No Build Step**: The project uses native browser ES modules. A simple HTTP server is all that's required to run it.

## Key Files

- `sketch.js`: The p5.js entry point. Manages the lifecycle, global keyboard shortcuts, and initializes the pipeline and UI.
- `pipeline.js`: Contains `ProcessingPipeline`, which drives the frame-by-frame processing of modules in topological order.
- `graph.js`: Contains `ConnectionGraph`, managing the nodes and connections (wires) between modules. Handles serialization/deserialization to JSON.
- `ui.js`: Contains `NodeGraphUI`, a comprehensive interactive editor for the node graph. Handles panning, zooming, node dragging, and parameter control.
- `moduleRegistry.js`: A global registry for module types, allowing dynamic creation of modules by type name.
- `modules/Module.js`: The base class for all modules. Defines common behavior for shaders, FBOs, and parameters.
- `shaders/vert.js`: The shared vertex shader used by all modules for screen-quad rendering.

## Module Categories

Modules are categorized in `ui.js` for the palette:

- **Sources**: Camera, VideoPlayer, Oscillator, ZGRASS.
- **Core**: Comparator, FunctionGenerator, AdderMultiplier, Differentiator, ColorEncoder, SyncGenerator, ValueScrambler.
- **Effects**: TV, Film, VHSC, PixelVision, GameBoy, HyperCard, Delay, Glitch.
- **Output**: Monitor.

## Development Workflow

### Adding a New Module

1.  **Fragment Shader**: Create a new file in `shaders/` (e.g., `shaders/myModule.js`) that exports the GLSL fragment shader source.
2.  **Module Class**: Create a new class in `modules/` (e.g., `modules/MyModule.js`) extending `Module`.
    -   Define `inputs`, `outputs`, and `params` in the constructor.
    -   Call `this.createShader(fragSrc)` and `this.createOutputFBO()` in the constructor.
    -   Override `process(graph, glCanvas)` to bind uniforms and render into `this.outputFBO`.
    -   Call `registerModule('MyModule', MyModule)` at the end of the file.
3.  **Registration**: Import the new module file in `sketch.js` to ensure it registers itself.
4.  **UI Integration**: Add the module type name to the appropriate category in `MODULE_CATEGORIES` in `ui.js`.

### Special Case: ZGRASS

The `ZGRASSModule` is a complete embedded ZGRASS interpreter (emulation of the Datamax UV-1). It has its own complex subsystem in `modules/zgrass/` and handles its own keyboard/mouse input when in fullscreen mode.

## Building and Running

Requires an HTTP server (e.g., `npm install -g http-server`).

- **macOS/Linux**: Run `./run.command`
- **Windows**: Run `run.bat`
- **Manual**: Run `http-server` and open `http://127.0.0.1:8080`

## Development Conventions

- **State Management**: The `ConnectionGraph` is the source of truth for the patch state.
- **Rendering**: Modules should always render to their `outputFBO` during `process()`. The `Monitor` and `ZGRASS` modules provide previews by blitting their FBOs to the main P2D canvas in `ui.js`.
- **Parameters**: Module parameters are normalized or use specific ranges defined in the `params` object. The UI handles scaling these values for display.
- **Coordinate System**: p5.js uses a 2D coordinate system for the UI (top-left 0,0), while the WebGL `glCanvas` uses standard GL coordinates (centered 0,0 or screen-space depending on usage).
