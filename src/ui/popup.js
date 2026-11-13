import { clamp, formatColor, fromHsv, parseColor, toHex, toHsv } from '../core/color.js';
import { normalizeLanguage, translate } from '../core/i18n.js';
import { addRecent, sanitizeState } from '../core/storage.js';
import Notifier from './Notifier.js';
import ImagePicker from './ImagePicker.js';

const $ = (id) => { return document.getElementById(id); };
const notifier = new Notifier($('notifier'));
let state = sanitizeState();
let hsv = toHsv(state.color);
let ready = false;
let picking = false;
let writeQueue = Promise.resolve();
const formats = ['hex', 'hex8', 'rgb', 'rgba', 'hsl', 'hsla', 'hsv'];
const formatInputs = new Map();
let imagePicker;
const t = (key, parameters) => { return translate(state.language, key, parameters); };

function notify(key, error = false, parameters = {}) {
  notifier.show(t(key, parameters), error);
}

function persist(keys) {
  const data = Object.fromEntries(keys.map((key) => { return [key, structuredClone(state[key])]; }));
  // NOTE: Serialize writes so a slow slider write cannot replace a newer color.
  writeQueue = writeQueue.then(async () => {
    try {
      await chrome.storage.local.set(data);
    } catch {
      notify('storageError', true);
    }
  });
  return writeQueue;
}

function localize() {
  document.documentElement.lang = state.language;
  document.title = t('extensionName');
  $('language').value = state.language;

  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n);
  }

  for (const element of document.querySelectorAll('[data-label]')) {
    element.setAttribute('aria-label', t(element.dataset.label));
    element.title = t(element.dataset.label);
  }

  $('colorInput').placeholder = t('colorPlaceholder');
  $('pick').disabled = picking || !('EyeDropper' in window) || !ready;

  if (!('EyeDropper' in window)) {
    $('pickHint').textContent = t('unsupported');
  }

  for (const [format, input] of formatInputs) {
    input.setAttribute('aria-label', format.toUpperCase());
    const button = input.nextElementSibling;
    button.title = `${t('copy')} ${format.toUpperCase()}`;
    button.setAttribute('aria-label', button.title);
  }

  renderCollections();
  renderColor();
  imagePicker?.localize();
}

function setColor(color, preserveHsv = false) {
  state.color = color;

  if (!preserveHsv) {
    const next = toHsv(color);
    // NOTE: Hue remains useful while editing grayscale or black.
    hsv = { ...next, h: next.s ? next.h : hsv.h };
  }

  $('colorInput').removeAttribute('aria-invalid');
  renderColor();
}

function renderColor() {
  const { color } = state;
  $('plane').style.backgroundColor = `hsl(${hsv.h}, 100%, 50%)`;
  $('cursor').style.left = `${hsv.s * 100}%`;
  $('cursor').style.top = `${(1 - hsv.v) * 100}%`;
  $('planeValue').textContent = `S ${Math.round(hsv.s * 100)}%, V ${Math.round(hsv.v * 100)}%`;
  $('hue').value = hsv.h;
  $('alpha').value = color.a * 100;
  $('alphaValue').value = `${Math.round(color.a * 100)}%`;
  $('alpha').style.backgroundImage = `linear-gradient(to right, transparent, ${toHex(color)}), conic-gradient(#ddd 25%, white 0 50%, #ddd 0 75%, white 0)`;
  $('alpha').style.backgroundSize = '100% 100%, 10px 10px';
  $('preview').style.backgroundColor = formatColor(color, 'rgba');
  $('preview').title = formatColor(color, 'rgba');
  $('nativeColor').value = toHex(color);
  $('colorInput').value = color.a < 1 ? toHex(color, true) : toHex(color);

  for (const [format, input] of formatInputs) {
    input.value = formatColor(color, format);
    input.removeAttribute('aria-invalid');
  }
}

function commitColor() {
  state.recent = addRecent(state.recent, state.color);
  persist(['color', 'recent']);
  renderCollections();
}

async function copyValue(format) {
  try {
    const value = formatColor(state.color, format);
    await navigator.clipboard.writeText(value);
    notify('copied', false, { value });
    commitColor();
  } catch {
    notify('copyError', true);
  }
}

function createFormats() {
  for (const format of formats) {
    const row = document.createElement('div');
    row.className = 'format-row';
    const label = document.createElement('span');
    label.className = 'format-label';
    label.textContent = format.toUpperCase();
    const input = document.createElement('input');
    input.className = 'format-value';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('aria-describedby', 'notifier');
    const applyValue = () => {
      if (!ready || input.value === formatColor(state.color, format)) {
        return;
      }

      const color = parseColor(input.value);
      if (!color) {
        input.setAttribute('aria-invalid', 'true');
        notify('invalidColor', true);
        return;
      }

      // Formats without alpha only edit the color channels.
      if (['hex', 'rgb', 'hsl', 'hsv'].includes(format)) {
        color.a = state.color.a;
      }
      setColor(color);
      commitColor();
    };
    input.addEventListener('change', applyValue);
    input.addEventListener('input', () => { input.removeAttribute('aria-invalid'); });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyValue();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        input.value = formatColor(state.color, format);
        input.removeAttribute('aria-invalid');
      }
    });
    const button = document.createElement('button');
    button.className = 'icon-button';
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M15 8V4H4v11h4"/></svg>';
    button.addEventListener('click', () => { copyValue(format); });
    row.append(label, input, button);
    $('formats').append(row);
    formatInputs.set(format, input);
  }
}

function renderSwatches(container, colors, removable) {
  container.replaceChildren();

  for (const color of colors) {
    const item = document.createElement('div');
    item.className = 'swatch-item';
    const button = document.createElement('button');
    button.className = 'swatch checker';
    const value = toHex(color, true);
    button.title = t('restore', { value });
    button.setAttribute('aria-label', button.title);
    const fill = document.createElement('span');
    fill.className = 'swatch-fill';
    fill.style.backgroundColor = formatColor(color, 'rgba');
    button.append(fill);
    button.addEventListener('click', () => {
      setColor({ ...color });
      commitColor();
    });
    item.append(button);

    if (removable) {
      const remove = document.createElement('button');
      remove.className = 'remove-swatch';
      remove.textContent = '×';
      remove.title = t('remove', { value });
      remove.setAttribute('aria-label', remove.title);
      remove.addEventListener('click', () => {
        state.palette = state.palette.filter((entry) => { return toHex(entry, true) !== value; });
        persist(['palette']);
        renderCollections();
        notify('removed');
      });
      item.append(remove);
    }

    container.append(item);
  }
}

function renderCollections() {
  renderSwatches($('palette'), state.palette, true);
  renderSwatches($('recent'), state.recent, false);
  $('paletteEmpty').hidden = state.palette.length > 0;
  $('recentEmpty').hidden = state.recent.length > 0;
  $('clear').disabled = !state.recent.length;
  $('paletteCount').textContent = `${state.palette.length}/48`;
}

async function pickScreenColor() {
  if (picking || !ready || !('EyeDropper' in window)) {
    return;
  }

  try {
    picking = true;
    $('pick').disabled = true;
    // NOTE: open() must run directly in the click gesture before any await.
    const result = await new EyeDropper().open();
    const color = parseColor(result.sRGBHex);

    if (!color) {
      throw new Error('Invalid screen color');
    }

    setColor(color);
    commitColor();
    notify('picked');
  } catch (error) {
    notify(error.name === 'AbortError' ? 'canceled' : 'pickError', error.name !== 'AbortError');
  } finally {
    picking = false;
    $('pick').disabled = false;
  }
}

function updatePlane(event) {
  const rect = $('plane').getBoundingClientRect();
  hsv.s = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  hsv.v = 1 - clamp((event.clientY - rect.top) / rect.height, 0, 1);
  setColor(fromHsv(hsv.h, hsv.s, hsv.v, state.color.a), true);
}

function bindEvents() {
  imagePicker = new ImagePicker({
    t,
    notify,
    onSelect: (color) => {
      setColor(color);
      commitColor();
    },
  });

  for (const source of ['screen', 'image']) {
    $(`${source}Source`).addEventListener('click', () => {
      $('screenPanel').hidden = source !== 'screen';
      $('imagePanel').hidden = source !== 'image';
      $('screenSource').setAttribute('aria-selected', String(source === 'screen'));
      $('imageSource').setAttribute('aria-selected', String(source === 'image'));
    });
  }

  $('pick').addEventListener('click', pickScreenColor);
  $('language').addEventListener('change', () => {
    state.language = normalizeLanguage($('language').value);
    $('notifier').hidden = true;
    localize();
    persist(['language']);
  });
  $('colorForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const color = parseColor($('colorInput').value);

    if (!color) {
      $('colorInput').setAttribute('aria-invalid', 'true');
      notify('invalidColor', true);
      return;
    }

    setColor(color);
    commitColor();
  });
  $('nativeColor').addEventListener('input', () => {
    setColor({ ...parseColor($('nativeColor').value), a: state.color.a });
  });
  $('nativeColor').addEventListener('change', commitColor);
  $('hue').addEventListener('input', () => {
    hsv.h = Number($('hue').value);
    setColor(fromHsv(hsv.h, hsv.s, hsv.v, state.color.a), true);
  });
  $('hue').addEventListener('change', commitColor);
  $('alpha').addEventListener('input', () => {
    setColor({ ...state.color, a: Number($('alpha').value) / 100 }, true);
  });
  $('alpha').addEventListener('change', commitColor);
  $('plane').addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }

    $('plane').focus();
    $('plane').setPointerCapture(event.pointerId);
    updatePlane(event);
  });
  $('plane').addEventListener('pointermove', (event) => {
    if ($('plane').hasPointerCapture(event.pointerId)) {
      updatePlane(event);
    }
  });
  $('plane').addEventListener('pointerup', (event) => {
    if ($('plane').hasPointerCapture(event.pointerId)) {
      updatePlane(event);
      $('plane').releasePointerCapture(event.pointerId);
      commitColor();
    }
  });
  $('plane').addEventListener('pointercancel', commitColor);
  $('plane').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      return;
    }

    event.preventDefault();
    const step = event.shiftKey ? 0.1 : 0.01;
    hsv.s = clamp(hsv.s + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), 0, 1);
    hsv.v = clamp(hsv.v + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0), 0, 1);
    setColor(fromHsv(hsv.h, hsv.s, hsv.v, state.color.a), true);
    commitColor();
  });
  $('save').addEventListener('click', () => {
    const value = toHex(state.color, true);

    if (state.palette.some((color) => { return toHex(color, true) === value; })) {
      notify('alreadySaved');
      return;
    }

    if (state.palette.length >= 48) {
      notify('paletteFull', true);
      return;
    }

    state.palette.push({ ...state.color });
    persist(['palette']);
    commitColor();
    notify('saved');
  });
  $('clear').addEventListener('click', () => {
    state.recent = [];
    persist(['recent']);
    renderCollections();
    notify('cleared');
  });
  $('drawPage').addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab?.id) {
        throw new Error('No active page');
      }

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (url, config) => {
          try {
            const { mountWebDrawing } = await import(url);
            mountWebDrawing(config);
          } catch (error) {
            throw error;
          }
        },
        args: [chrome.runtime.getURL('drawing/webOverlay.js'), { language: state.language, color: toHex(state.color) }],
      });
      window.close();
    } catch {
      notify('drawPageError', true);
    }
  });
  $('drawDesktop').addEventListener('click', async () => {
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL(`ui/desktop.html?language=${state.language}&color=${encodeURIComponent(toHex(state.color))}`) });
    } catch {
      notify('windowError', true);
    }
  });
  $('openWindow').addEventListener('click', async () => {
    try {
      await writeQueue;
      await chrome.windows.create({ url: chrome.runtime.getURL('ui/popup.html?window=1'), type: 'popup', width: 560, height: 1000 });
    } catch {
      notify('windowError', true);
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !ready) {
      return;
    }

    const colorChanged = changes.color && JSON.stringify(changes.color.newValue) !== JSON.stringify(state.color);

    for (const key of ['color', 'language', 'palette', 'recent']) {
      if (changes[key]) {
        state[key] = sanitizeState({ [key]: changes[key].newValue })[key];
      }
    }

    if (colorChanged) {
      hsv = toHsv(state.color);
    }

    localize();
  });
}

async function initialize() {
  createFormats();
  localize();

  if (new URLSearchParams(location.search).has('window')) {
    document.body.classList.add('window-mode');
    $('openWindow').hidden = true;
  }

  try {
    state = sanitizeState(await chrome.storage.local.get(['color', 'language', 'palette', 'recent']));
    hsv = toHsv(state.color);
    ready = true;
    bindEvents();
    localize();
  } catch {
    notify('loadError', true);
  }
}

initialize();
