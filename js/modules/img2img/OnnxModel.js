// ONNX Runtime Web (js/libraries/ort/, v1.30.0) for the img2img modules. ort.min.js
// is a classic script that declares `var ort`, so it can't be imported as a
// module: the first model asked for adds it to the page with a script tag.
//
// ORT's env is global, so the first model to load picks the backend for every
// session after it:
//   webgpu: on the main thread, which only queues the GPU's work
//   wasm:   in ORT's proxy worker, so a slow run never stalls a frame. The
//           worker runs ORT's default of min(4, cores / 2) threads when
//           coi-serviceworker.js has cross-origin isolated the page, and one
//           when it hasn't yet (a first visit, before its reload)
// A first model that fails to start on WebGPU (on a GPU without fp16
// shaders, say) falls back to WASM. Models load one at a time, so the second
// knows which backend the first settled on.
//
// Runs take turns across every model, too. ORT's WebGPU build keeps one run in
// progress for the whole runtime, so a run of one session that starts while
// another session's is under way fails ("Session already started"), and so
// does the one it interrupted ("Session mismatch").
const ORT_DIR = new URL('../../libraries/ort/', import.meta.url).href;

let ortReady = null;
let backend = null;                  // 'webgpu' or 'wasm', once a session has started
let loading = Promise.resolve();
let running = Promise.resolve();     // the last run asked for, of any model
const models = new Map();            // url -> Promise<OnnxModel>

function loadOrt() {
  ortReady ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = ORT_DIR + 'ort.min.js';
    script.onload = () => {
      // Absolute, since the proxy worker resolves it from a blob: URL
      window.ort.env.wasm.wasmPaths = ORT_DIR;
      resolve(window.ort);
    };
    script.onerror = () => reject(new Error(`could not load ${script.src}`));
    document.head.appendChild(script);
  });
  return ortReady;
}

async function hasWebGPU() {
  if (!navigator.gpu) return false;
  try {
    return !!(await navigator.gpu.requestAdapter());
  } catch (e) {
    return false;
  }
}

// The model file, fetched before any session is made from it. A download that
// fails then fails the load, where a session made from the url would fail on
// WebGPU too, and send every model after it to WASM for good
async function fetchModel(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function start(url, options) {
  const ort = await loadOrt();
  const bytes = await fetchModel(url);
  if (backend === 'webgpu' || (backend === null && await hasWebGPU())) {
    try {
      const session = await ort.InferenceSession.create(bytes, { ...options, executionProviders: ['webgpu'] });
      backend = 'webgpu';
      return new OnnxModel(ort, session, backend);
    } catch (e) {
      // Once a session runs on the main thread, the proxy can't be turned on
      if (backend === 'webgpu') throw e;
      console.warn(`ONNX Runtime: WebGPU could not start ${url}, so it runs on WASM:`, e);
    }
  }
  ort.env.wasm.proxy = true;
  const session = await ort.InferenceSession.create(bytes, { ...options, executionProviders: ['wasm'] });
  backend = 'wasm';
  return new OnnxModel(ort, session, backend);
}

// The model at url, with one session shared by every node that runs it. One
// that fails to load is forgotten, so asking for it again tries again.
// options go to the session along with its execution provider (Pix2Pix's
// config entry, say). Only the first ask for a url sets them
export function loadOnnxModel(url, options = {}) {
  if (!models.has(url)) {
    const model = loading.then(() => start(url, options));
    loading = model.catch(() => {});
    models.set(url, model);
    model.catch(() => models.delete(url));
  }
  return models.get(url);
}

// When a module tries again after a failed load or run: 1 s after the first
// failure, doubling with each one after it up to 30 s, and at once after a
// success, so a failure that lasts doesn't fill the console
export class Backoff {
  constructor(first = 1000, most = 30000) {
    this.first = first;
    this.most = most;
    this.reset();
  }

  reset() {
    this.wait = 0;
    this.until = 0;
  }

  // A failure. Returns how long, in ms, until the next try
  fail() {
    this.wait = this.wait ? Math.min(this.wait * 2, this.most) : this.first;
    this.until = performance.now() + this.wait;
    return this.wait;
  }

  get ready() {
    return performance.now() >= this.until;
  }
}

class OnnxModel {
  constructor(ort, session, backend) {
    this.ort = ort;            // for ort.Tensor
    this.session = session;
    this.backend = backend;
  }

  // The session's outputs for feeds, { name: ort.Tensor }. Runs take turns
  // with every other run, of this model or any other
  run(feeds) {
    const result = running.then(() => this.session.run(feeds));
    running = result.catch(() => {});
    return result;
  }
}
