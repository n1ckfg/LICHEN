// Skeleton's tracer, off the main thread: Twoscilloscope's camera_trace
// example traced on the main thread, which at 256 x 192 takes 3-5 ms a mask and
// at 512 x 384 up to 35. Each message is one mask; the worker thins it to
// lines one cell wide and follows them into polylines with the skeleton-tracing
// library's wasm build (trace_skeleton_wasm.js, by Lingdong Huang).
//
// In:  { pixels, w, h }   pixels: the mask's RGBA bytes, rows top first
// Out: { w, h, lengths, points }   lengths: points per polyline;
//                                  points: x, y in cells, back to back
//      or { error }               the tracer failed; the module starts a new worker
//
// The library leaks unless it is driven by hand. Its trace() keeps work
// buffers, the mask among them, until the tracer's own destroy() frees them,
// and wasm.destroy() only deletes the object. And the glue copies the text
// trace() returns into a JS string without freeing it. Called as the library's
// fromCharString() calls it, a trace left about 3 bytes a cell in the heap,
// 46 KB at 256 cells, so a few minutes of tracing filled the heap's 2 GB and
// the tracer failed.
import '../../libraries/trace_skeleton_wasm.js';   // a UMD script: it puts TraceSkeleton on the global scope

const ready = self.TraceSkeleton.load().then((ts) => ts.tracer);

const decoder = new TextDecoder();

self.onmessage = async (e) => {
  const { pixels, w, h } = e.data;
  try {
    const wasm = await ready;
    // The example built a string of \0 and \1, one character a pixel, for
    // fromCharString(), which then encoded it into the heap. Writing the bytes
    // there and passing trace() the pointer gives the same polylines 25-40%
    // sooner. The tracer's destroy() frees the mask, so each trace has its own.
    // HEAPU8 is read after _malloc, which can grow the heap.
    const size = w * h;
    const mask = wasm._malloc(size);
    if (!mask) throw new Error('out of memory');
    let heap = wasm.HEAPU8;
    for (let i = 0; i < size; i++) heap[mask + i] = pixels[i * 4] > 127 ? 1 : 0;
    const tracer = new wasm.skeleton_tracer_t();
    // The binding trace() wraps, so its text can be freed once it is read
    const out = wasm._emscripten_bind_skeleton_tracer_t_trace_3(wasm.getPointer(tracer), mask, w, h);
    let text = '';
    if (out) {
      heap = wasm.HEAPU8;
      let end = out;
      while (heap[end]) end++;
      text = decoder.decode(heap.subarray(out, end));
      wasm._free(out);
    }
    tracer.destroy();
    wasm.destroy(tracer);

    const { lengths, points } = parsePolylines(text);
    self.postMessage({ w, h, lengths, points }, [lengths.buffer, points.buffer]);
  } catch (err) {
    // An async handler's error would otherwise reach no one, and the module
    // would wait for this trace for ever. The wasm may be broken now, so the
    // module starts a new worker
    self.postMessage({ error: String((err && err.message) || err) });
  }
};

// The tracer's text, "POLYLINES:" then a line of "x,y " pairs per polyline,
// then "RECTS:" and the rectangles it split the mask into, which aren't needed
function parsePolylines(text) {
  const body = text.slice(text.indexOf('POLYLINES:') + 10, text.indexOf('RECTS:'));
  const lines = body.split('\n').filter((line) => line.length);
  const lengths = new Int32Array(lines.length);
  const coords = [];
  lines.forEach((line, i) => {
    for (const pair of line.split(' ')) {
      if (!pair) continue;
      const comma = pair.indexOf(',');
      coords.push(parseInt(pair.slice(0, comma)), parseInt(pair.slice(comma + 1)));
      lengths[i]++;
    }
  });
  return { lengths, points: Float32Array.from(coords) };
}
