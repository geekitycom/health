import { timingSafeEqual } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { bearerAuth } from 'hono/bearer-auth';
import type { Config } from './config.js';
import { localNow } from './dates.js';
import { createMcpServer } from './mcp.js';
import type { Store } from './store.js';
import { webRoutes } from './web/routes.js';

export type AppDeps = {
    config: Config;
    store: Store;
    now(): Date;
};

export function createApp(deps: AppDeps) {
    const { config, store } = deps;
    const now = () => localNow(deps.now(), config.timeZone);
    const app = new Hono();

    app.get('/health', c => c.json({ ok: true }));

    if (config.mcpToken) {
        app.use(
            '/mcp',
            bearerAuth({
                verifyToken: token => safeEqual(token, config.mcpToken ?? '')
            })
        );
    }
    app.all('/mcp', async c => {
        const server = createMcpServer({
            store,
            weightUnit: config.weightUnit,
            today: () => now().date
        });
        const transport = new WebStandardStreamableHTTPServerTransport({
            enableJsonResponse: true
        });
        await server.connect(transport);
        return transport.handleRequest(c.req.raw);
    });

    if (config.appPassword) {
        const password = config.appPassword;
        app.use(
            '*',
            basicAuth({
                verifyUser: (_user, pass) => safeEqual(pass, password),
                realm: 'health'
            })
        );
    }
    app.route('/', webRoutes({ store, weightUnit: config.weightUnit, now }));

    return app;
}

function safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
}
