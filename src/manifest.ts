import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json' with { type: 'json' };

export default defineManifest({
  manifest_version: 3,
  name: 'Claude Account Switcher',
  version: pkg.version,
  description: 'Switch between Claude accounts and watch 5-hour / weekly usage.',
  icons: { 16: 'icon-16.png', 48: 'icon-48.png', 128: 'icon-128.png' },
  action: { default_popup: 'src/popup/index.html', default_title: 'Claude accounts' },
  options_page: 'src/options/index.html',
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  commands: {
    'switch-next': {
      suggested_key: { default: 'Alt+Shift+S' },
      description: 'Switch Claude to the next account',
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
