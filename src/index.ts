import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openStore } from './store.js';

const config = loadConfig(process.env);
const store = openStore(config.databasePath);
const app = createApp({ config, store, now: () => new Date() });

if (!config.appPassword) {
    console.warn('APP_PASSWORD is not set: the web UI is open to anyone.');
}
if (!config.mcpToken) {
    console.warn('MCP_TOKEN is not set: /mcp is open to anyone.');
}

const server = serve({ fetch: app.fetch, port: config.port }, info => {
    console.log(
        `health listening on :${info.port} (db ${config.databasePath}, ${config.timeZone})`
    );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
        server.close();
        store.close();
        process.exit(0);
    });
}
