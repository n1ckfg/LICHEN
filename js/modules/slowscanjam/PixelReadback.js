// Reads a framebuffer back to the CPU without stalling the main thread, as the
// SlowscanJam app's WebGLEncoder read its signal: readPixels into a pixel
// buffer behind a fence, which poll() checks once a frame. Rows come back top
// first (see Framebuffer Orientation in ARCHITECTURE.md). SlowscanJam reads its
// source picture this way, and Skeleton its mask.
export class PixelReadback {
  constructor(glCanvas) {
    this.glCanvas = glCanvas;
    this.pbo = null;
    this.sync = null;
    this.size = 0;
  }

  // Starts reading the w x h RGBA pixels of fbo, a framebuffer of density 1.
  // WebGL1 has no pixel buffers, so there it reads them at once, waiting on the
  // GPU, and returns them. Otherwise it returns null, and poll() brings them.
  start(fbo, w, h) {
    const gl = this.glCanvas.drawingContext;
    if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) {
      fbo.loadPixels();
      return fbo.pixels.slice();
    }
    const prevRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo.framebuffer);
    if (!this.pbo) this.pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    // Fresh storage each time; reusing it makes Chrome discard the shadow copy
    // it keeps for fenced readbacks
    gl.bufferData(gl.PIXEL_PACK_BUFFER, w * h * 4, gl.STREAM_READ);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevRead);
    this.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    this.size = w * h * 4;
    return null;
  }

  // The pixels once the GPU has written them, null until then, or false if the
  // read failed. The fence only updates between tasks, so check once a frame.
  poll() {
    const gl = this.glCanvas.drawingContext;
    const r = gl.clientWaitSync(this.sync, 0, 0);
    if (r === gl.TIMEOUT_EXPIRED) return null;
    gl.deleteSync(this.sync);
    this.sync = null;
    if (r === gl.WAIT_FAILED) return false;
    const pixels = new Uint8Array(this.size);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixels);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    return pixels;
  }

  dispose() {
    const gl = this.glCanvas.drawingContext;
    if (this.sync) gl.deleteSync(this.sync);
    if (this.pbo) gl.deleteBuffer(this.pbo);
    this.sync = null;
    this.pbo = null;
  }
}
