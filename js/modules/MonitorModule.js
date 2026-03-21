import { Module } from './Module.js';
import { registerModule } from '../moduleRegistry.js';

function isChromium() {
  const ua = navigator.userAgent;
  return /Chrome\//.test(ua) && !/Edg\//.test(ua) || /Chromium\//.test(ua);
}

export class MonitorModule extends Module {
  constructor(glCanvas, id) {
    super('Monitor', glCanvas, id);
    this.inputs = [{ name: 'in', type: 'video' }];
    this.displayTexture = null;
    this.isFullscreen = false;
    this._extWindow = null;
    this._extCanvas = null;
    this.lastFpsTime = performance.now();
    this.frameCount = 0;
    this.fps = 0;

    // Recording state
    this._recorder = null;
    this._recordingChunks = [];
    this._recordingMimeType = null;

    // Recording params (bitrate in bits/sec, default 5 Mbps)
    const defaultBitrate = 10000000;
    this.params = {
      bitrate: {
        value: defaultBitrate,
        min: defaultBitrate / 2,   // 5 Mbps
        max: defaultBitrate * 5,     // 50 Mbps
        step: 1000000,
        label: 'Bitrate'
      }
    };
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    this.displayTexture = inputFBO;

    // Calculate FPS
    const now = performance.now();
    this.frameCount++;
    if (now - this.lastFpsTime >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsTime));
      this.frameCount = 0;
      this.lastFpsTime = now;
    }
  }

  toggleFullscreen() {
    this.isFullscreen = !this.isFullscreen;
  }

  /**
   * Attempt to open a fullscreen window on a second screen.
   * Returns true if the second-screen window was opened, false otherwise.
   */
  async trySecondScreenFullscreen(glCanvas) {
    if (!isChromium() || !('getScreenDetails' in window)) return false;

    let screenDetails;
    try {
      screenDetails = await window.getScreenDetails();
    } catch {
      return false;
    }

    const currentScreen = screenDetails.currentScreen;
    const otherScreen = screenDetails.screens.find(s => s !== currentScreen);
    if (!otherScreen) return false;

    this._openExtWindow(otherScreen, glCanvas);
    return true;
  }

  _openExtWindow(targetScreen, glCanvas) {
    // Close any existing external window
    this.closeExtWindow();

    const w = targetScreen.availWidth;
    const h = targetScreen.availHeight;
    const left = targetScreen.availLeft;
    const top = targetScreen.availTop;

    const extWin = window.open(
      '',
      '_blank',
      `left=${left},top=${top},width=${w},height=${h}`
    );
    if (!extWin) return;

    this._extWindow = extWin;

    extWin.document.title = 'LICHEN Monitor';
    extWin.document.body.style.cssText = 'margin:0;padding:0;background:#000;overflow:hidden;';

    const canvas = extWin.document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.style.cssText = 'display:block;width:100%;height:100%;';
    extWin.document.body.appendChild(canvas);
    this._extCanvas = canvas;

    // Go fullscreen on the target screen
    canvas.requestFullscreen({ screen: targetScreen }).catch(() => {});

    // Close on ESC
    extWin.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeExtWindow();
    });

    // Detect if user closes the popup
    extWin.addEventListener('beforeunload', () => {
      this._extWindow = null;
      this._extCanvas = null;
    });
  }

  _blitToExtWindow(glCanvas) {
    if (!this._extWindow || this._extWindow.closed || !this._extCanvas || !this.displayTexture) return;

    const canvas = this._extCanvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use the blit shader to render the FBO onto glCanvas, then drawImage from glCanvas's underlying canvas
    const g = glCanvas;
    const srcCanvas = g.elt; // the underlying <canvas> element of the p5 WEBGL graphics

    // Letterbox: maintain 640x480 aspect ratio
    const aspect = 640 / 480;
    let dw = canvas.width;
    let dh = canvas.width / aspect;
    if (dh > canvas.height) {
      dh = canvas.height;
      dw = canvas.height * aspect;
    }
    const dx = (canvas.width - dw) / 2;
    const dy = (canvas.height - dh) / 2;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(srcCanvas, dx, dy, dw, dh);
  }

  closeExtWindow() {
    if (this._extWindow && !this._extWindow.closed) {
      this._extWindow.close();
    }
    this._extWindow = null;
    this._extCanvas = null;
  }

  hasExtWindow() {
    return this._extWindow !== null && !this._extWindow.closed;
  }

  /**
   * Start recording the monitor output to video.
   * @param {Object} glCanvas - The p5 WebGL canvas (used when no external window)
   * @param {number} fps - Frame rate for recording (default 30)
   * @returns {boolean} True if recording started successfully
   */
  startRecording(glCanvas, fps = 30) {
    if (this._recorder && this._recorder.state === 'recording') {
      console.warn('Already recording');
      return false;
    }

    // Determine which canvas to capture from
    const canvas = this._extCanvas || glCanvas?.elt;
    if (!canvas) {
      console.error('No canvas available for recording');
      return false;
    }

    // Get the media stream from the canvas
    const stream = canvas.captureStream(fps);

    // Determine best available MIME type (prefer MP4, fallback to WebM)
    const mimeTypes = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];

    let selectedMimeType = null;
    for (const mimeType of mimeTypes) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        selectedMimeType = mimeType;
        break;
      }
    }

    if (!selectedMimeType) {
      console.error('No supported video MIME type found');
      return false;
    }

    this._recordingMimeType = selectedMimeType;
    this._recordingChunks = [];

    // Get bitrate from params (allow any value set via direct input)
    const bitrate = Math.max(100000, Math.round(this.params.bitrate.value));

    try {
      this._recorder = new MediaRecorder(stream, {
        mimeType: selectedMimeType,
        videoBitsPerSecond: bitrate
      });
    } catch (e) {
      console.error('Failed to create MediaRecorder:', e);
      return false;
    }

    this._recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        this._recordingChunks.push(e.data);
      }
    };

    this._recorder.onstop = () => {
      this._downloadRecording();
    };

    this._recorder.onerror = (e) => {
      console.error('MediaRecorder error:', e);
      this._recorder = null;
    };

    this._recorder.start(1000); // Collect data every second
    console.log(`Recording started (${selectedMimeType}, ${(bitrate / 1000000).toFixed(2)} Mbps)`);
    return true;
  }

  /**
   * Stop recording and trigger download.
   */
  stopRecording() {
    if (!this._recorder || this._recorder.state !== 'recording') {
      console.warn('Not currently recording');
      return;
    }
    this._recorder.stop();
    console.log('Recording stopped');
  }

  /**
   * Check if currently recording.
   * @returns {boolean}
   */
  isRecording() {
    return this._recorder && this._recorder.state === 'recording';
  }

  /**
   * Download the recorded video.
   * @private
   */
  _downloadRecording() {
    if (this._recordingChunks.length === 0) {
      console.warn('No recording data to download');
      return;
    }

    const blob = new Blob(this._recordingChunks, { type: this._recordingMimeType });
    const url = URL.createObjectURL(blob);

    const extension = this._recordingMimeType.includes('mp4') ? 'mp4' : 'webm';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `lichen-recording-${timestamp}.${extension}`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Clean up
    URL.revokeObjectURL(url);
    this._recordingChunks = [];
    this._recorder = null;
    console.log(`Downloaded: ${filename}`);
  }

  dispose() {
    if (this.isRecording()) {
      this._recorder.stop();
      this._recorder = null;
      this._recordingChunks = [];
    }
    this.closeExtWindow();
    this.displayTexture = null;
    super.dispose();
  }
}

registerModule('Monitor', MonitorModule);
