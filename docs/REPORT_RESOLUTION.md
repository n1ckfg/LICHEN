# Rendering Resolution Report

2026-09-30. A survey of how LICHEN sizes its rendering today, written ahead of a planned change in which the Monitor module's `width` and `height` would set the rendering resolution for every module. Nothing has been changed yet.

## Summary

Every module renders into one shared context at a fixed **640×480**. The Monitor's `width` and `height` params do not affect rendering. They only size the copy used for recording and for the second-screen window, which is the 640×480 image scaled up.

## The shared context

- `js/main.js:103` creates a single WebGL graphics, `p.createGraphics(640, 480, p.WEBGL)`, and every module is constructed with that same `glCanvas`.
- Each module's output buffer comes from `Module.createOutputFBO()` (`js/modules/Module.js:38`), which calls `createFramebuffer()` with no size, so it inherits the context's 640×480. All module outputs are therefore the same size.
- **Pixel density.** `main.js` never sets `pixelDensity`, so the context follows the display: 640×480 physical pixels on a standard screen, 1280×960 on a retina display. This is why shaders that work in `gl_FragCoord` space take `Module.fragResolution()` rather than the logical size (see Pixel Density in `ARCHITECTURE.md`).

## Internal buffers

Module outputs are uniform, but some modules keep working buffers of other sizes. All of them are derived from the context size except GRASS, Protozoa and Camera.

| Module | Internal buffer size | Where |
| --- | --- | --- |
| Conway, GridGuys, Dither, Delay, BufferSmear, DeeSeventySix, HSFlow, SpiralGalaxy, InkDrops | Same as the context (`createFramebuffer()` with no size) | each module's constructor |
| UnrealBloom | Half the context: 320×240 | `UnrealBloomModule.js:35-36` |
| LuminanceDelay, Slitscan | An 8×8 atlas of quarter-size tiles (160×120), so 1280×960 | `LuminanceDelayModule.js:26-29`, `SlitscanModule.js` |
| Protozoa | Simulation pinned at 340 texels on the short axis (453×340 at 4:3, long axis capped at 900), density 1, plus 8×8 and 1×1 reduction targets | `ProtozoaModule.js` `_simSize()`, `PROTO_SIM_SHORT` in `js/shaders/protozoa.js` |
| NAPLPS, Image, Yellowtail | 2D `p5.Graphics` at the context size | `NAPLPSModule.js:49`, `ImageModule.js:47`, `YellowtailModule.js:310-312` |
| Camera | Requests a 640×480 webcam capture | `CameraModule.js:22` |
| GRASS | Native 320×201 framebuffer, scaled up to the context | `js/modules/grass/framebuffer.js:7-8` |

## The Monitor's Width and Height

The params default to 1440×1080 (`MonitorModule.js:30`, `:37`). Width runs 640–3840 in steps of 160, and height runs 480–2160 in steps of 120. They are used in exactly two places:

- **Second-screen window.** The window's canvas is sized from the params (`MonitorModule.js:116`), and `_blitToExtWindow()` draws the WebGL canvas into it, letterboxed to a hardcoded `640 / 480` aspect (`:152`, `:164`).
- **Recording.** With no second screen, `startRecording()` makes an offscreen canvas at the params' size (`:212`), and `_blitToRecordingCanvas()` draws the WebGL canvas into it (`:177`).

In both cases the source is the 640×480 image (1280×960 on retina), so any setting above that is an upscale.

**Finding:** the recording path stretches rather than letterboxes. Width and height are independent knobs, so a non-4:3 pair such as 1920×1080 records a horizontally stretched image. The second-screen path letterboxes correctly.

## Implications for the planned change

1. **Sizes are fixed at construction.** UnrealBloom's half-size targets, the LuminanceDelay and Slitscan atlas tiles, Protozoa's simulation size, and the NAPLPS, Image and Yellowtail 2D buffers are all computed once from the context size. Changing the resolution at runtime means each of these modules must rebuild its buffers (and the feedback modules will restart from an empty buffer when they do).
2. **4:3 is hardcoded in two places:** the Monitor's second-screen letterbox (`MonitorModule.js:152`) and the fullscreen view in `js/ui.js:1064`. Both assume `640 / 480`, so a non-4:3 resolution would be shown distorted until they read the real size.
3. **A patch can hold several Monitors.** If their Width/Height disagree, a rule is needed for which one sets the resolution (for example the first, the most recently changed, or the largest).
4. **Fixed-size sources.** The Camera capture request (640×480) and GRASS's 320×201 framebuffer don't follow the context today and would need to be decided case by case.
5. **Cost.** Every module renders at the context size every frame. At the Monitor's default 1440×1080 that is about 5× the pixels of 640×480, and 4× that again on a retina display, so heavy modules (Protozoa's scene pass, Crystalline's ray march, the HSFlow chain) will slow down accordingly.
