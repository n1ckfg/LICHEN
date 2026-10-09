# Pix2Pix Report

2026-10-09. This report asks whether a pix2pix module would suit the img2img category alongside DepthAnything and InfrDrawings. It also asks whether Latk's pix2pix ONNX models (`Latk_x_informative-drawings/onnx/`) can be converted for the web, for example to fp16. Both answers are yes, and the Pix2Pix module is now built, but plain fp16 conversion was not enough. The module itself is documented under Pix2Pix Module in `ARCHITECTURE.md`.

## Summary

- **Fit:** the models fit the img2img pipeline almost unchanged. InfrDrawings' input shader, pixel readback, shared run queue, `Backoff` and model switching all carry over. The differences are the input range (−1..1), a fixed square 256 × 256 input, and RGB output.
- **Speed:** on WebGPU a run takes about 14 ms, enough to keep up with 60 fps. On the WASM fallback it takes 115–135 ms.
- **The fp16 trap:** a plain fp16 conversion damages the models. `onnxconverter-common` clamps values over 10,000 to 10,000 without asking, and the deepest BatchNorm's variance goes up to 207,805. Folding the BatchNorms into the layers before them first fixes it.
- **Size:** fp16 alone leaves each model at 108.8 MB, over GitHub's 100 MB limit on a file, and the repo commits its models directly. Storing the weights as int8, while still running in fp16, brings each to 54.5 MB with no loss of speed and no visible loss of quality.

## The models

Three files, each 217.7 MB in fp32, exported from PyTorch 1.11 at opset 9:

| File | Look on a photo | Module label |
| --- | --- | --- |
| `neuralcontours_140_net_G_simplified.onnx` | Thin dark contours on white | Neural Contours |
| `pix2pix003-002_140_net_G_simplified.onnx` | Thick light lines on black, with grey fill | pix2pix 003 |
| `pix2pix004-002_140_net_G_simplified.onnx` | Bold dark lines on white, with coloured fringes | pix2pix 004 |

Each is pix2pix's `unet_256` generator with `ngf` 64: 8 stride-2 Convs down to 1 × 1 and 8 ConvTransposes back up, joined by skips, 54.4 M parameters. The graph uses only Conv, ConvTranspose, BatchNormalization, LeakyRelu, Relu, Concat and Tanh, all of which ORT Web 1.30 runs on WebGPU. PyTorch's export folded the down path's BatchNorms into its Convs, but it left the 7 after the ConvTransposes in place. Input and output are both fixed at `[1, 3, 256, 256]`.

Latk ran them in `LIGHTNING_ARTIST/latk_ml_005` (`latk_onnx.py`, `Pix2Pix_Onnx`):
- **Input:** the render is resized to 256 × 256 whatever its shape, and its 0..1 pixels go through `(x − 0.5) / 0.5`.
- **Output:** the result goes through `y × 0.5 + 0.5` and is resized back.
- **Mode:** the PyTorch path calls `eval()`, so BatchNorm uses its running statistics, as the ONNX export does.
- **Channel order:** `renderToNp()` returns RGB, and `detect()` then applies OpenCV's `COLOR_BGR2RGB`, so Latk actually fed the models BGR. pix2pix trains through PIL, in RGB. Swapping the channels changes the output by a mean of 3.0 (Neural Contours), 10.5 (003) and 8.2 (004) levels on the test image. The module uses RGB.

The `pytorch/` folder holds other checkpoints of the same architecture, which were not evaluated: `pix2pix002-001…004` (60 epochs), `contour_pix2pix` and `contour_reverse_pix2pix` (195 epochs). They are the same size and could be converted the same way once exported. Going by its name, `contour_reverse` turns line art back into pictures, the other way round from every img2img module so far.

## fp16 conversion

The BatchNorms after the ConvTransposes carry large variances. The deepest has a maximum `running_var` of 64,547 (Neural Contours), 207,805 (003) and 68,657 (004). fp16's largest value is 65,504. `onnxconverter-common`'s `convert_float_to_float16` clamps anything above its `max_finite_val`, which defaults to 10,000, and only says so in a warning. So the deepest variances of all three models come out as 10,000, along with one more of 004's (12,534), and those layers' scales are wrong by up to 4.6×.

Folding fixes it. Each BatchNorm becomes a per-channel scale `γ / √(var + ε)` on the ConvTranspose's weights, and a new bias `(b − mean) × scale + β`. The scales are at most 1.3, so the folded weights stay small, and the 7 BatchNorm kernels go too. Activations peak at about 680, far inside fp16's range.

Against the fp32 model on the CPU, on Vermeer's *Girl with a Pearl Earring* squashed to 256 × 256, in 8-bit levels:

| Variant | Neural Contours, mean / max | 003, mean / max | 004, mean / max |
| --- | --- | --- | --- |
| fp16 as converted, on ORT CPU | 0.29 / 22 | 1.56 / 55 | 8.79 / 198 |
| fp16 after folding, on ORT CPU | 0.01 / 1 | 0.04 / 3 | 0.04 / 2 |
| fp16 after folding, on WebGPU | 0.21 / 13 | 0.30 / 15 | 0.67 / 41 |

ORT's CPU provider computes much of an fp16 model in fp32, so its rows show mostly the effect of rounding the weights. The WebGPU row is fp16 arithmetic throughout. As converted, 004 has grey blotches that are plain to see. After folding, the outputs look the same as fp32. For comparison, DepthAnything's fp16 model differs from fp32 by a mean of 1.7–2.7 levels on WebGPU.

## Size

`files/models/` is committed to GitHub directly, without LFS, and GitHub rejects a file over 100 MB. GitHub Pages doesn't serve LFS files anyway. fp16 alone gives 108.8 MB, so it can't be pushed.

The 512-channel layers at 16 × 16 and below hold 89% of the parameters but do only 26% of the 6.05 G multiply-adds a frame. So the weights alone go to int8 here: symmetric, one scale per output channel, from the folded fp32 weights. Each weight then runs through `DequantizeLinear` and a `Cast` to fp16, and the model still computes in fp16. Each file is 54.5 MB, close to DepthAnything's 49.6 MB.

By default ORT keeps `DequantizeLinear` nodes, to fuse them with quantized kernels, so it dequantizes every weight on every run. The session config entry `session.disable_quant_qdq = '1'` lets it fold them into fp16 weights once, when the session starts. ORT Web takes the entry as `extra: { session: { disable_quant_qdq: '1' } }`.

Two easier routes failed:
- **Converting after quantizing:** `onnxconverter-common` turned the dequantize scales into fp16, which `DequantizeLinear` at opset 13 rejects. Undoing that gave a `DequantizeLinear` whose output type it had marked fp16.
- **int8 compute:** DepthAnything's uint8 export took 3.7 s a frame, because ORT Web 1.30 has no WebGPU kernels for `ConvInteger` and its relatives. Only the storage is int8 here.

## Speed and accuracy in the browser

Headless Chrome on an M2 Max, ORT Web 1.30, 256 × 256. Each run was timed from inside the session, and the median taken after a first run. Error is against fp32 on the CPU, on the same input:

| Variant | Size | WebGPU | WASM, 4 threads | 004 on WebGPU, mean / max | Neural Contours and 003 on WebGPU, mean / max |
| --- | --- | --- | --- | --- | --- |
| fp32 as exported | 217.7 MB | 17.3 ms | 97 ms | 0 / 1 | — |
| fp16 as converted | 108.8 MB | 13.8 ms | — | 8.07 / 194 | — |
| fp16, folded | 108.8 MB | 14.2 ms | 98 ms | 0.67 / 41 | 0.21–0.30 / 13–15 |
| int8 weights, fp32 compute | 54.5 MB | 17.4 ms | — | 0.96 / 33 | — |
| **int8 weights, fp16, folded** | **54.5 MB** | **14.2 ms** | 97 ms | 1.06 / 48 | 0.33–0.94 / 22–50 |
| the same, without `disable_quant_qdq` | 54.5 MB | 17.7 ms | — | 1.06 / 48 | — |

The WASM column ran on the main thread. In the app, through ORT's proxy worker, it takes 115–135 ms. Creating a session took about 0.4 s. At 1× the int8 drawings look the same as fp32, and their differences, scaled by 4, show only as faint edges along the lines.

fp16 itself buys little speed on this GPU, 17.3 to 14.2 ms. What it mostly buys is size, and the int8 weights halve that again at no further cost in speed.

## Input size

The skips need every level of the UNet to match, so both sides must be multiples of 256. LICHEN's frame is 4:3, and the nearest 4:3 size that works is 1024 × 768. A copy of 004 with free height and width ran there in 85 ms on WebGPU, and in 30 ms at 512 × 512. But at 1024 × 768 the 1 × 1 bottleneck becomes 4 × 3, so the deepest layers no longer see the whole picture, as the models were trained to. The drawing came out covered in speckles and cross-hatching, nothing like the 256 × 256 one. The module therefore squashes the frame to 256 × 256, as Latk did, and stretches the drawing back.

## The module

`js/modules/Pix2PixModule.js` follows InfrDrawings stage for stage, and reuses its input shader. The changes:
- **Input:** pixels go to −1..1 rather than 0..1, at a fixed 256 × 256.
- **Output:** the drawing is RGB, mapped back with `(y + 1) × 127.5`, rather than one grey channel. `js/shaders/pix2pix.js` draws it in Default, Invert or Color. Neural Contours and 004 draw dark lines and 003 light ones, so each model carries a `light` flag that tells Color which way round its lines are. Color then always gives the lines in the input's colours, on black.
- **Loading:** `loadOnnxModel(url, options)` in `OnnxModel.js` now takes session options. DepthAnything and InfrDrawings pass none, so their sessions are created with exactly the options they were before.

It is registered as Adding a New Module in `ARCHITECTURE.md` describes, with a fresh uid (`f3b183da`) and param and port ids, the import in `js/main.js`, and entries in `MODULE_CATEGORIES` and `MODULE_COLORS`. `tools/pix2pix-onnx.py` makes the three files in `files/models/pix2pix/`. Run on the original exports, it reproduces the files benchmarked above exactly.

## Checks in the app

Headless Chrome on an M2 Max, with the image going from Image into Pix2Pix:
- **Against ORT in Python:** the pixels each run was given went through the fp32 export on the CPU. The drawings differ by a mean of 0.34, 0.95–0.96 and 0.93–1.06 levels (Neural Contours, 003, 004) on WebGPU at pixel density 1 and 2. On WASM the means are 0.25, 0.90 and 0.89.
- **Orientation:** the model's input correlates with the Image node's output at 0.9987, against 0.18 flipped. The output correlates with the drawing scaled up at 1.0000, against 0.15–0.23 flipped.
- **Mode:** Default and Invert add up to 255, to within a level. Color is within a level of the lines times the input, for all three models.
- **Patches:** a node saved with Model pix2pix 004 and Mode Invert saves params `c338: 2, bc67: 1`, and loads with them.
- **Other modules:** with DepthAnything, InfrDrawings and Pix2Pix fed the same picture, they gave 62, 63 and 62 results in 4 s, with no session errors. Alone, Pix2Pix gave 232 in 4 s. DepthAnything's and InfrDrawings' outputs are byte for byte the same at HEAD and with the change to `OnnxModel.js`, and across reruns of each.
- **Main thread:** `process()` costs a median of 1.0 ms at density 1 and 1.2 ms at density 2.

## Open questions

- **Channel order:** RGB matches training. BGR would match what Latk showed. Changing it is one line in `_run()`.
- **Repo size:** the three files add 163 MB to the repo. Each is fetched only when a node first picks it.
- **GPU memory:** each model's session stays loaded for the page's life, as InfrDrawings' do. Its weights are back in fp16 by then, so each model should take about 109 MB of GPU memory, about 330 MB if all three are picked, though this wasn't measured. Releasing a session when no node uses it would need reference counting in `OnnxModel.js`.
- **Shared code:** Pix2Pix is the third module with this read, queue, run and upload machinery, about 150 lines each time. A shared base class in `img2img/` would remove the duplication, but would change DepthAnything and InfrDrawings, so it should come with a before-and-after pixel comparison.
- **More models:** the `pytorch/` checkpoints, `contour_reverse` especially, need a PyTorch export first, using pix2pix's `networks.py` (`_more/pytorch-CycleGAN-and-pix2pix`), and then `tools/pix2pix-onnx.py`.
- **Historical info:** like DepthAnything and InfrDrawings, Pix2Pix has no entry in `js/historical-info.json`.

## Reproducing

```
pip install onnx onnxconverter-common numpy
python tools/pix2pix-onnx.py <Latk_x_informative-drawings>/onnx/neuralcontours_140_net_G_simplified.onnx files/models/pix2pix/neuralcontours_140_net_G_q8_fp16.onnx
```

The same works for `pix2pix003-002_140_net_G` and `pix2pix004-002_140_net_G`. The measurements used onnx 1.23.2, onnxconverter-common 1.16.0 and ONNX Runtime 1.31.0 in Python, with ORT Web 1.30.0 in system Chrome driven by Playwright.
