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

// The VideoToasting module's Effect drop-down, in the VideoToasting project's
// index.html order. Patches save the index, so new effects go on the end.
export const videoToastingEffects = [
  { label: 'Blinds', frag: blindsFrag },
  { label: 'Push/Pull', frag: pushPullFrag },
  { label: 'Split', frag: splitFrag },
  { label: 'Squeeze/Zoom', frag: squeezeZoomFrag },
  { label: 'Swap', frag: swapFrag },
  { label: 'Trails', frag: trailsFrag },
  { label: 'Trajectory', frag: trajectoryFrag },
  { label: 'Transporter', frag: transporterFrag },
  { label: 'Tumble', frag: tumbleFrag },
  { label: 'Neon Bands', frag: neonBandsFrag },
  { label: 'Camera Iris', frag: cameraIrisFrag },
  { label: 'Bear', frag: bearFrag },
  { label: 'Giraffe', frag: giraffeFrag },
  { label: 'Blinds 3 Expand', frag: blinds3ExpandFrag },
];
