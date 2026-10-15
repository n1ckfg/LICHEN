import { blindsFrag } from './blinds.js';
import { pushPullFrag } from './push-pull.js';
import { splitFrag } from './split.js';
import { squeezeZoomFrag } from './squeeze-zoom.js';
import { swapFrag } from './swap.js';
import { trailsFrag } from './trails.js';
import { trajectoryFrag } from './trajectory.js';
import { transporterFrag } from './transporter.js';
import { tumbleFrag } from './tumble.js';
import { neonBandsFrag } from './neon-bands.js';
import { cameraIrisFrag } from './camera-iris.js';
import { bearFrag } from './bear.js';
import { giraffeFrag } from './giraffe.js';
import { blinds3ExpandFrag } from './blinds-3-expand.js';

const TAU = 2 * Math.PI;

// The VideoToasting module's Effect drop-down, in the VideoToasting project's
// index.html order. Patches save the index, so new effects go on the end.
//
// The module steps through its connected inputs a segment at a time, segment
// k starting at offset + k * segment seconds (see VideoToasting Module in
// ARCHITECTURE.md). A chain effect takes input k to input k + 1 in segment k,
// with input k on the bus `outgoing` names for it (its letters taken in turn),
// so each segment starts on the picture the last one ended on. A reveal effect
// keeps the first input on A and shows the next of the rest on B each segment.
export const videoToastingEffects = [
  // B changes as the slats jump back at the wrap
  { label: 'Blinds', frag: blindsFrag, segment: 2, offset: 0, reveal: true },
  { label: 'Push/Pull', frag: pushPullFrag, segment: 2, offset: 0, outgoing: 'A' },
  // B changes at its narrowest, a fifth of the frame
  { label: 'Split', frag: splitFrag, segment: TAU, offset: TAU / 4 - TAU, reveal: true },
  // B changes as its frame shrinks through nothing on the way to flipping
  { label: 'Squeeze/Zoom', frag: squeezeZoomFrag, segment: 2, offset: 1.141 - 2, reveal: true },
  { label: 'Swap', frag: swapFrag, segment: 2, offset: 0, outgoing: 'A' },
  { label: 'Trails', frag: trailsFrag, segment: 2 * TAU, offset: 0, reveal: true },
  // B changes when its frame is smallest
  { label: 'Trajectory', frag: trajectoryFrag, segment: 2 * TAU, offset: 3 * Math.PI / 4 - 2 * TAU, reveal: true },
  { label: 'Transporter', frag: transporterFrag, segment: TAU, offset: 0, reveal: true },
  // Cuts from A to B half way through the shader's 6.28318 s loop. Each bus
  // changes half way through the other's turn, so no cut can show it early.
  { label: 'Tumble', frag: tumbleFrag, segment: 3.14159, offset: 1.570795, outgoing: 'AB' },
  { label: 'Neon Bands', frag: neonBandsFrag, segment: 2, offset: 0, outgoing: 'A' },
  // Closes from B onto A, then opens from A onto B. Starting on the second
  // input on B keeps two inputs as they were before the Inputs knob.
  { label: 'Camera Iris', frag: cameraIrisFrag, segment: 1, offset: -1, outgoing: 'AB' },
  // B changes while the shape is off screen
  { label: 'Bear', frag: bearFrag, segment: 2, offset: -0.5, reveal: true },
  { label: 'Giraffe', frag: giraffeFrag, segment: 2, offset: -0.5, reveal: true },
  // Grows out of black, so both buses change unseen at the wrap
  { label: 'Blinds 3 Expand', frag: blinds3ExpandFrag, segment: 2, offset: 0, outgoing: 'A' },
];
