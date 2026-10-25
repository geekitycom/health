import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { openStore } from '../../src/store.js';

export const NOW = new Date('2026-10-25T14:30:00Z');

export function harness(env: Record<string, string> = {}) {
    const config = loadConfig({ TIME_ZONE: 'America/Chicago', ...env });
    const store = openStore(':memory:');
    const app = createApp({ config, store, now: () => NOW });
    const post = (path: string, fields: Record<string, string>) =>
        app.request(path, {
            method: 'POST',
            body: new URLSearchParams(fields),
            headers: { 'content-type': 'application/x-www-form-urlencoded' }
        });
    return { app, store, post };
}
