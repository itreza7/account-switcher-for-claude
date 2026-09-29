import { h } from '../ui/dom';
import { icon, type IconName } from '../ui/icons';
import { localizeDocument, t } from '../ui/i18n';
import { getShortcut, keycaps, SHORTCUTS_PAGE } from '../ui/shortcut';

const TERMS_URL = 'https://www.anthropic.com/legal/consumer-terms';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function setupIcons(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-icon]'))
    el.replaceChildren(icon(el.dataset.icon as IconName, Number(el.dataset.size ?? 16)));
}

/** The current shortcut as keycaps, or a button to Chrome's shortcut page when none is set. */
async function showShortcut(): Promise<void> {
  let shortcut = '';
  try {
    shortcut = await getShortcut();
  } catch {
    // Offer the shortcuts page when Chrome cannot tell.
  }
  $('shortcutSlot').replaceChildren(
    shortcut
      ? keycaps(shortcut)
      : h(
          'button',
          { type: 'button', class: 'btn btn-sm', onclick: () => void chrome.tabs.create({ url: SHORTCUTS_PAGE }) },
          icon('keyboard', 14),
          t('welcome_tip_shortcut_set'),
        ),
  );
}

/** "Use each account according to {link}." with the link built as a real anchor. */
function showTerms(): void {
  const [before = '', after = ''] = t('welcome_terms').split('{link}');
  const link = h('a', { href: TERMS_URL, target: '_blank', rel: 'noopener' }, t('welcome_terms_link'));
  $('terms').replaceChildren(before, link, after);
}

localizeDocument();
setupIcons();
showTerms();
$('openSettings').addEventListener('click', () => void chrome.runtime.openOptionsPage());
void showShortcut();
// The user may change the shortcut on Chrome's page, so read it again when they come back.
window.addEventListener('focus', () => void showShortcut());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void showShortcut();
});
