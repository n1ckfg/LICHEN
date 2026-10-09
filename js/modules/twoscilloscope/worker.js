// Twoscilloscope's audio, off the main thread. Each message is one loop of XY
// audio from the module's X and Y pins. The worker runs it through the effect
// chain and replies with the altered loop and the point stream of the view it
// was sent for, which the module draws. A loop takes several milliseconds,
// more with Decoded Strokes, which on the main thread came out of every frame.
//
// In:  { input, width, height, beamSize, fx, view }
//        input: { x, y, z, color, sampleRate } (see ScopeRenderer.update)
//        fx: the effects, from EffectMenu.resolve()
//      or { svg: true }, for the strokes the last loop decodes into
// Out: { stream, count, view, beamExposure, freq, x, y, z }
//        stream: count points of four floats (see latk/strokes.js)
//        x, y, z: the altered loop, for the sound card and WAVs
//      or { strokes }
import { ScopeRenderer } from './ScopeRenderer.js';
import { EffectRack } from '../audiofx/EffectRack.js';

const BEAMS = 0, STROKES = 1;

const scope = new ScopeRenderer();
const rack = new EffectRack(scope.transformer.effects);

self.onmessage = (e) => {
  if (e.data.svg) {
    self.postMessage({ strokes: scope.getStrokes() });
    return;
  }

  const { input, width, height, beamSize, fx, view } = e.data;
  rack.apply(fx);
  scope.beamSize = beamSize;
  scope.update(input, width, height);
  if (view === BEAMS) scope.beamStream();
  else if (view === STROKES) scope.strokeStream();
  else scope.lineStream();

  // The stream's buffer is reused from loop to loop, so it goes as a copy
  const count = scope.stream.count;
  const stream = scope.stream.data.slice(0, count * 4);
  self.postMessage({
    stream, count, view, beamExposure: scope.beamExposure,
    freq: scope.getFreq(), x: scope.x, y: scope.y, z: scope.z,
  }, [stream.buffer]);
};
