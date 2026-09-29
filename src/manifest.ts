import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json' with { type: 'json' };

export default defineManifest({
  manifest_version: 3,
  default_locale: 'en',
  name: '__MSG_extName__',
  short_name: '__MSG_extShortName__',
  version: pkg.version,
  description: '__MSG_extDescription__',
  homepage_url: 'https://github.com/itreza7/account-switcher-for-claude',
  icons: { 16: 'icon-16.png', 32: 'icon-32.png', 48: 'icon-48.png', 128: 'icon-128.png' },
  action: {
    default_popup: 'src/popup/index.html',
    default_title: '__MSG_extActionTitle__',
    default_icon: { 16: 'icon-16.png', 32: 'icon-32.png' },
  },
  options_page: 'src/options/index.html',
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  commands: {
    'switch-next': {
      suggested_key: { default: 'Alt+Shift+S' },
      description: '__MSG_cmdSwitchNext__',
    },
  },
  permissions: ['cookies', 'storage', 'alarms', 'tabs', 'notifications', 'declarativeNetRequestWithHostAccess'],
  host_permissions: [
    'https://claude.ai/*',
    'https://*.claude.ai/*',
    'https://claude.com/*',
    'https://*.claude.com/*',
    'https://console.anthropic.com/*',
    'https://*.anthropic.com/*',
  ],
});
