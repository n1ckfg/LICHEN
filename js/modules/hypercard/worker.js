// HyperCard's Atkinson dither, off the main thread. Bill Atkinson's error
// diffusion, as MacPaint and HyperCard dithered, is sequential: each pixel, in
// rows from the top and left to right within a row, is set black or white, and
// 1/8 of its error goes to each of six neighbours ahead of it. The other 2/8 is
// dropped, which is what gives it its clean highlights and shadows.
//
//           X   1   1
//       1   1   1
//           1
//
// In:  { pixels, w, h, threshold }   pixels: RGBA bytes, rows top first, with the
//      luminance in R; threshold: 0-1, at or above which a pixel is white
// Out: { pixels, w, h }   the same buffer, each pixel 0 or 255 in R, G and B
//
// It writes the result over the input as it goes, since each pixel's own
// luminance is read before it is written and the error lives in its own rows.
self.onmessage = (e) => {
  const { pixels, w, h, threshold } = e.data;
  atkinson(pixels, w, h, threshold * 255);
  self.postMessage({ pixels, w, h }, [pixels.buffer]);
};

function atkinson(px, w, h, t) {
  // The error carried to this row and the next two. Pixel x is at x + 1, so
  // x - 1 and x + 2 stay in range; error pushed past either side is dropped.
  let r0 = new Float32Array(w + 3);
  let r1 = new Float32Array(w + 3);
  let r2 = new Float32Array(w + 3);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      const v = px[i] + r0[x + 1];
      const q = v >= t ? 255 : 0;
      const e = (v - q) / 8;
      r0[x + 2] += e;
      r0[x + 3] += e;
      r1[x] += e;
      r1[x + 1] += e;
      r1[x + 2] += e;
      r2[x + 1] += e;
      px[i] = q;
      px[i + 1] = q;
      px[i + 2] = q;
      px[i + 3] = 255;
    }
    const done = r0;
    r0 = r1;
    r1 = r2;
    r2 = done.fill(0);
  }
}
