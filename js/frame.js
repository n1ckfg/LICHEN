// The frame every module renders at: glCanvas's logical size (see Frame Size
// in ARCHITECTURE.md). A patch sets it with its Monitors' Buffer Width and
// Buffer Height; these are the size before any Monitor says otherwise, and
// the size a patch with no Monitor runs at.
export const DEFAULT_FRAME_WIDTH = 640;
export const DEFAULT_FRAME_HEIGHT = 480;

// Bounds a typed Buffer Width or Height is held to: a frame smaller than this
// leaves some modules' buffers a pixel or less, and one bigger than this is
// past what a browser's WebGL canvas will allocate
export const MIN_FRAME_SIZE = 16;
export const MAX_FRAME_SIZE = 4096;

// Where a frame of frameW x frameH sits when it is shown as large as it fits
// in canvasW x canvasH, keeping its shape and centred: { dx, dy, dw, dh }. The
// fullscreen view, Monitor's second-screen window and every module that takes
// the mouse in fullscreen use this, so a click lands where the picture is.
export function letterbox(frameW, frameH, canvasW, canvasH) {
  const aspect = frameW / frameH;
  let dw = canvasW;
  let dh = canvasW / aspect;
  if (dh > canvasH) {
    dh = canvasH;
    dw = canvasH * aspect;
  }
  return { dx: (canvasW - dw) / 2, dy: (canvasH - dh) / 2, dw, dh };
}
