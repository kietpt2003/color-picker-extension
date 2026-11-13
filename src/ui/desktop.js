import { normalizeLanguage, translate } from '../core/i18n.js';

const parameters = new URLSearchParams(location.search);
const language = normalizeLanguage(parameters.get('language'));
const color = /^#[\da-f]{6}$/i.test(parameters.get('color')) ? parameters.get('color') : '#7C5CFC';
document.documentElement.lang = language;

for (const element of document.querySelectorAll('[data-i18n]')) {
  element.textContent = translate(language, element.dataset.i18n);
}

const url = new URL('color-picker-draw://open');
url.searchParams.set('color', color);
url.searchParams.set('language', language);
document.getElementById('launchDesktop').href = url.href;
