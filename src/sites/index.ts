import type { SiteId } from '../core/types';
import { claudeAdapter } from './claude';
import { consoleAdapter } from './console';
import type { SiteAdapter } from './site';

const adapters: SiteAdapter[] = [claudeAdapter, consoleAdapter];

export function listAdapters(): SiteAdapter[] {
  return adapters;
}

export function getAdapter(id: SiteId): SiteAdapter {
  const a = adapters.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown site: ${id}`);
  return a;
}
