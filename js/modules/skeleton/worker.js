// Skeleton's tracer, off the main thread: Twoscilloscope's camera_trace
// example traced on the main thread, which at 256 x 192 takes 3-5 ms a mask and
// at 512 x 384 up to 35. Each message is one mask; the worker thins it to
// lines one cell wide and follows them into polylines with the skeleton-tracing
// library's wasm build (trace_skeleton_wasm.js, by Lingdong Huang).
//
// In:  { pixels, w, h }   pixels: the mask's RGBA bytes, rows top first
// Out: { w, h, lengths, points }   lengths: points per polyline;
//                                  points: x, y in cells, back to back
import '../../libraries/trace_skeleton_wasm.js';   // a UMD script: it puts TraceSkeleton on the global scope

const ready = self.TraceSkeleton.load().then((ts) => ts.tracer);

let ptr = 0;     // the mask in the wasm heap
let size = 0;

self.onmessage = async (e) => {
  const { pixels, w, h } = e.data;
  const wasm = await ready;
  if (size !== w * h) {
    if (ptr) wasm._free(ptr);
    size = w * h;
    ptr = wasm._malloc(size);
  }
  // The example built a string of \0 and \1, one character a pixel, for
  // fromCharString(), which then encoded it into the heap. Writing the bytes
  // there and passing trace() the pointer gives the same polylines 25-40%
  // sooner. HEAPU8 is read after _malloc, which can grow the heap.
  const heap = wasm.HEAPU8;
  for (let i = 0; i < size; i++) heap[ptr + i] = pixels[i * 4] > 127 ? 1 : 0;
  const tracer = new wasm.skeleton_tracer_t();
  const text = tracer.trace(wasm.wrapPointer(ptr, wasm.VoidPtr), w, h);
  wasm.destroy(tracer);

  const { lengths, points } = parsePolylines(text);
  self.postMessage({ w, h, lengths, points }, [lengths.buffer, points.buffer]);
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
