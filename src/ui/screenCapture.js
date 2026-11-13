import { normalizeLanguage, translate } from '../core/i18n.js';
import { downloadDrawing } from '../drawing/exportImage.js';

const parameters = new URLSearchParams(location.search);
const language = normalizeLanguage(parameters.get('language'));
const requestId = parameters.get('requestId');
document.documentElement.lang = language;
document.getElementById('captureTitle').textContent = translate(language, 'drawExport_screen');
document.getElementById('captureHint').textContent = translate(language, 'drawChooseScreen');

async function capture() {
  let stream;
  let video;
  try {
    const sourceId = await new Promise((resolve) => {
      chrome.desktopCapture.chooseDesktopMedia(['screen'], resolve);
    });
    if (!sourceId) { throw new Error('drawCaptureCanceled'); }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxWidth: 16384, maxHeight: 16384, maxFrameRate: 5 } },
    });
    video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    const current = await chrome.windows.getCurrent();
    await chrome.windows.update(current.id, { state: 'minimized' });
    // NOTE: Wait for fresh frames after the chooser and helper window have disappeared.
    await new Promise((resolve) => { setTimeout(resolve, 300); });

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    if (!canvas.width || !canvas.height) { throw new Error('drawCaptureScreenError'); }
    canvas.getContext('2d').drawImage(video, 0, 0);
    downloadDrawing(canvas.toDataURL('image/png'), 'screen');
    await chrome.runtime.sendMessage({ type: 'DRAW_SCREEN_DONE', requestId, ok: true });
  } catch (error) {
    try {
      await chrome.runtime.sendMessage({ type: 'DRAW_SCREEN_DONE', requestId, ok: false, error: error.message === 'drawCaptureCanceled' ? error.message : 'drawCaptureScreenError' });
    } catch { /* The extension may have been reloaded while the picker was open. */ }
  } finally {
    stream?.getTracks().forEach((track) => { track.stop(); });
    if (video) { video.srcObject = null; }
    window.close();
  }
}

capture();
