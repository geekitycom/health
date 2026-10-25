import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Config } from './config.js';
import { localNow } from './dates.js';
import { createMcpServer } from './mcp.js';
import type { Store } from './store.js';
import { oauthRoutes } from './oauth/routes.js';
import { passwordAuth } from './web/auth.js';
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

    const auth = config.appPassword
        ? passwordAuth({ password: config.appPassword, now: deps.now })
        : undefined;
    const oauth = oauthRoutes({
        oauth: store.oauth,
        now: deps.now,
        publicUrl: config.publicUrl,
        requireSession: auth?.requireSession,
        staticToken: config.mcpToken
    });
    app.route('/', oauth.routes);

    app.use('/mcp', cors({ origin: '*', exposeHeaders: ['WWW-Authenticate'] }));
    if (config.appPassword || config.mcpToken) {
        app.use('/mcp', oauth.requireMcpAuth);
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

    if (auth) {
        app.route('/', auth.routes);
        app.use('*', auth.requireSession);
    }
    app.route(
        '/',
        webRoutes({
            store,
            weightUnit: config.weightUnit,
            signOut: Boolean(config.appPassword),
            now
        })
    );

    return app;
}
