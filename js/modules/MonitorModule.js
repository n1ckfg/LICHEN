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
  }

  process(graph, glCanvas) {
    const inputFBO = this.getInput(graph, 0);
    this.displayTexture = inputFBO;
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

  dispose() {
    this.closeExtWindow();
    this.displayTexture = null;
    super.dispose();
  }
}

registerModule('Monitor', MonitorModule);
