import en from '../locales/en.js';
import vi from '../locales/vi.js';
import zh from '../locales/zh-CN.js';

export const catalogs = { en, vi, 'zh-CN': zh };

export function normalizeLanguage(language) {
  return Object.hasOwn(catalogs, language) ? language : 'en';
}

export function translate(language, key, parameters = {}) {
  let message = catalogs[normalizeLanguage(language)][key] || en[key] || key;

  for (const [name, value] of Object.entries(parameters)) {
    message = message.replaceAll(`{${name}}`, String(value));
  }

  return message;
}
