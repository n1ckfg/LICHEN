// ONNX Runtime Web (js/libraries/ort/, v1.30.0) for the GAN modules. ort.min.js
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
const ORT_DIR = new URL('../../libraries/ort/', import.meta.url).href;

let ortReady = null;
let backend = null;                  // 'webgpu' or 'wasm', once a session has started
let loading = Promise.resolve();
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

async function start(url) {
  const ort = await loadOrt();
  if (backend === 'webgpu' || (backend === null && await hasWebGPU())) {
    try {
      const session = await ort.InferenceSession.create(url, { executionProviders: ['webgpu'] });
      backend = 'webgpu';
      return new OnnxModel(ort, session, backend);
    } catch (e) {
      // Once a session runs on the main thread, the proxy can't be turned on
      if (backend === 'webgpu') throw e;
      console.warn(`ONNX Runtime: WebGPU could not start ${url}, so it runs on WASM:`, e);
    }
  }
  ort.env.wasm.proxy = true;
  const session = await ort.InferenceSession.create(url, { executionProviders: ['wasm'] });
  backend = 'wasm';
  return new OnnxModel(ort, session, backend);
}

// The model at url, with one session shared by every node that runs it
export function loadOnnxModel(url) {
  if (!models.has(url)) {
    const model = loading.then(() => start(url));
    loading = model.catch(() => {});
    models.set(url, model);
  }
  return models.get(url);
}

class OnnxModel {
  constructor(ort, session, backend) {
    this.ort = ort;            // for ort.Tensor
    this.session = session;
    this.backend = backend;
    this.queue = Promise.resolve();
  }

  // The session's outputs for feeds, { name: ort.Tensor }. Runs take turns,
  // so nodes sharing the session never overlap theirs.
  run(feeds) {
    const result = this.queue.then(() => this.session.run(feeds));
    this.queue = result.catch(() => {});
    return result;
  }
}
