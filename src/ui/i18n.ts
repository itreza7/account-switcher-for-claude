/**
 * UI string from _locales/<lang>/messages.json. `{name}` placeholders are filled from vars.
 * A missing key returns the key itself, so it shows up in review instead of rendering blank.
 */
export function t(key: string, vars: Record<string, string | number> = {}): string {
  const raw = chrome.i18n.getMessage(key) || key;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** Sets <html lang/dir> and fills static markup: data-i18n (text), data-i18n-title, data-i18n-aria-label. */
export function localizeDocument(root: ParentNode = document): void {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  document.documentElement.dir = chrome.i18n.getMessage('@@bidi_dir') || 'ltr';
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n!);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle!);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]'))
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel!));
}
