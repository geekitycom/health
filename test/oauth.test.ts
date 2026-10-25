import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
    OAuthClientInformationMixed,
    OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { describe, expect, it } from 'vitest';
import { harness } from './support/harness.js';

const BASE = 'https://health.example.com';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

type App = ReturnType<typeof harness>['app'];

function setup() {
    const h = harness({ APP_PASSWORD: 'secret', PUBLIC_URL: BASE });
    const request = (path: string, init: RequestInit = {}) =>
        h.app.request(new URL(path, BASE).href, init);
    return { ...h, request };
}

function memoryProvider() {
    const state: {
        client?: OAuthClientInformationMixed;
        tokens?: OAuthTokens;
        verifier?: string;
        authorizationUrl?: URL;
    } = {};
    const provider: OAuthClientProvider = {
        redirectUrl: REDIRECT,
        clientMetadata: {
            client_name: 'Claude',
            redirect_uris: [REDIRECT],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'client_secret_post'
        },
        clientInformation: () => state.client,
        saveClientInformation: info => void (state.client = info),
        tokens: () => state.tokens,
        saveTokens: tokens => void (state.tokens = tokens),
        redirectToAuthorization: url => void (state.authorizationUrl = url),
        saveCodeVerifier: verifier => void (state.verifier = verifier),
        codeVerifier: () => state.verifier ?? ''
    };
    return { provider, state };
}

function transport(app: App, provider: OAuthClientProvider) {
    return new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
        authProvider: provider,
        fetch: async (url, init) => app.request(String(url), init)
    });
}

async function signIn(request: ReturnType<typeof setup>['request']) {
    const res = await request('/login', {
        method: 'POST',
        body: new URLSearchParams({ password: 'secret' })
    });
    return res.headers.get('set-cookie')?.split(';')[0] ?? '';
}

async function approve(
    request: ReturnType<typeof setup>['request'],
    authorizationUrl: URL,
    decision: 'allow' | 'deny'
) {
    const cookie = await signIn(request);
    const consent = await request(
        authorizationUrl.pathname + authorizationUrl.search,
        { headers: { cookie } }
    );
    expect(consent.status).toBe(200);
    expect(await consent.text()).toContain('Connect Claude?');
    const res = await request('/oauth/authorize', {
        method: 'POST',
        headers: { cookie },
        body: new URLSearchParams({
            ...Object.fromEntries(authorizationUrl.searchParams),
            decision
        })
    });
    expect(res.status).toBe(303);
    return new URL(res.headers.get('location') ?? '');
}

describe('OAuth for remote MCP clients', () => {
    it('advertises its metadata from the 401 on /mcp', async () => {
        const { request } = setup();
        const res = await request('/mcp', { method: 'POST' });
        expect(res.status).toBe(401);
        expect(res.headers.get('www-authenticate')).toBe(
            `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource"`
        );
        const resource = await (
            await request('/.well-known/oauth-protected-resource')
        ).json();
        expect(resource).toMatchObject({
            resource: `${BASE}/mcp`,
            authorization_servers: [BASE]
        });
        const server = (await (
            await request('/.well-known/oauth-authorization-server')
        ).json()) as { registration_endpoint: string };
        expect(server.registration_endpoint).toBe(`${BASE}/oauth/register`);
    });

    it('registers, authorizes, and reads data like Claude does', async () => {
        const { app, request } = setup();
        const { provider, state } = memoryProvider();

        await expect(
            new Client({ name: 't', version: '0' }).connect(
                transport(app, provider)
            )
        ).rejects.toThrow();
        expect(state.client?.client_id).toBeTruthy();
        expect(state.authorizationUrl?.pathname).toBe('/oauth/authorize');

        const callback = await approve(
            request,
            state.authorizationUrl as URL,
            'allow'
        );
        expect(callback.origin + callback.pathname).toBe(REDIRECT);
        expect(callback.searchParams.get('state')).toBe(
            state.authorizationUrl?.searchParams.get('state')
        );

        const pending = transport(app, provider);
        await pending.finishAuth(callback.searchParams.get('code') ?? '');
        expect(state.tokens?.access_token).toBeTruthy();

        const client = new Client({ name: 't', version: '0' });
        await client.connect(transport(app, provider));
        expect((await client.listTools()).tools).toHaveLength(8);
    });

    it('rotates refresh tokens', async () => {
        const { app, request } = setup();
        const { provider, state } = memoryProvider();
        await new Client({ name: 't', version: '0' })
            .connect(transport(app, provider))
            .catch(() => {});
        const callback = await approve(
            request,
            state.authorizationUrl as URL,
            'allow'
        );
        await transport(app, provider).finishAuth(
            callback.searchParams.get('code') ?? ''
        );
        const client = state.client as {
            client_id: string;
            client_secret: string;
        };
        const refresh = (token: string) =>
            request('/oauth/token', {
                method: 'POST',
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: token,
                    client_id: client.client_id,
                    client_secret: client.client_secret
                })
            });

        const first = state.tokens?.refresh_token ?? '';
        const res = await refresh(first);
        expect(res.status).toBe(200);
        const tokens = (await res.json()) as OAuthTokens;
        expect(tokens.refresh_token).not.toBe(first);
        expect((await refresh(first)).status).toBe(400);
    });

    it('sends the user back with access_denied on deny', async () => {
        const { app, request } = setup();
        const { provider, state } = memoryProvider();
        await new Client({ name: 't', version: '0' })
            .connect(transport(app, provider))
            .catch(() => {});
        const callback = await approve(
            request,
            state.authorizationUrl as URL,
            'deny'
        );
        expect(callback.searchParams.get('error')).toBe('access_denied');
        expect(callback.searchParams.get('code')).toBeNull();
    });

    it('requires signing in before the consent screen', async () => {
        const { app, request } = setup();
        const { provider, state } = memoryProvider();
        await new Client({ name: 't', version: '0' })
            .connect(transport(app, provider))
            .catch(() => {});
        const url = state.authorizationUrl as URL;
        const res = await request(url.pathname + url.search);
        expect(res.status).toBe(303);
        expect(res.headers.get('location')).toMatch(/^\/login\?next=/);
    });

    it('rejects a code exchanged with the wrong PKCE verifier', async () => {
        const { app, request } = setup();
        const { provider, state } = memoryProvider();
        await new Client({ name: 't', version: '0' })
            .connect(transport(app, provider))
            .catch(() => {});
        const callback = await approve(
            request,
            state.authorizationUrl as URL,
            'allow'
        );
        const client = state.client as {
            client_id: string;
            client_secret: string;
        };
        const res = await request('/oauth/token', {
            method: 'POST',
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: callback.searchParams.get('code') ?? '',
                redirect_uri: REDIRECT,
                code_verifier: 'wrong',
                client_id: client.client_id,
                client_secret: client.client_secret
            })
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'invalid_grant' });
    });

    it('refuses to register non-https redirect URIs', async () => {
        const { request } = setup();
        const res = await request('/oauth/register', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] })
        });
        expect(res.status).toBe(400);
    });
});
