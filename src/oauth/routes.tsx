import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { Layout } from '../web/layout.js';
import { safeEqual } from '../web/auth.js';
import { newSecret, sha256, type OAuthStore } from './store.js';

const CODE_TTL_MS = 10 * 60_000;
const ACCESS_TTL_S = 24 * 3600;
const REFRESH_TTL_MS = 365 * 86_400_000;

export type OAuthDeps = {
    oauth: OAuthStore;
    now(): Date;
    publicUrl: URL | undefined;
    /** Guards the consent screen; absent when the app has no password. */
    requireSession: MiddlewareHandler | undefined;
    /** Static bearer token (MCP_TOKEN) that /mcp also accepts. */
    staticToken: string | undefined;
};

const registration = z.object({
    redirect_uris: z
        .array(
            z.url().refine(isAllowedRedirect, {
                message: 'redirect_uris must be https or loopback http'
            })
        )
        .min(1),
    client_name: z.string().max(200).optional(),
    token_endpoint_auth_method: z
        .enum(['none', 'client_secret_post', 'client_secret_basic'])
        .default('client_secret_basic')
});

export function oauthRoutes(deps: OAuthDeps) {
    const { oauth } = deps;
    const routes = new Hono();
    const now = () => deps.now().getTime();
    const base = (c: Context) => baseUrl(c, deps.publicUrl);

    routes.use('/.well-known/*', cors());
    routes.use('/oauth/register', cors());
    routes.use('/oauth/token', cors());

    const protectedResource = (c: Context) =>
        c.json({
            resource: `${base(c)}/mcp`,
            authorization_servers: [base(c)],
            bearer_methods_supported: ['header']
        });
    routes.get('/.well-known/oauth-protected-resource', protectedResource);
    routes.get('/.well-known/oauth-protected-resource/mcp', protectedResource);

    routes.get('/.well-known/oauth-authorization-server', c =>
        c.json({
            issuer: base(c),
            authorization_endpoint: `${base(c)}/oauth/authorize`,
            token_endpoint: `${base(c)}/oauth/token`,
            registration_endpoint: `${base(c)}/oauth/register`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: [
                'none',
                'client_secret_post',
                'client_secret_basic'
            ]
        })
    );

    routes.post('/oauth/register', async c => {
        const parsed = registration.safeParse(
            await c.req.json().catch(() => null)
        );
        if (!parsed.success) {
            return c.json(
                {
                    error: 'invalid_client_metadata',
                    error_description: parsed.error.issues
                        .map(i => i.message)
                        .join('; ')
                },
                400
            );
        }
        const body = parsed.data;
        const clientId = newSecret();
        const secret =
            body.token_endpoint_auth_method === 'none' ? null : newSecret();
        const issuedAt = now();
        oauth.addClient(
            {
                clientId,
                name: body.client_name ?? null,
                redirectUris: body.redirect_uris
            },
            secret,
            issuedAt
        );
        return c.json(
            {
                client_id: clientId,
                ...(secret && {
                    client_secret: secret,
                    client_secret_expires_at: 0
                }),
                client_id_issued_at: Math.floor(issuedAt / 1000),
                client_name: body.client_name,
                redirect_uris: body.redirect_uris,
                token_endpoint_auth_method: body.token_endpoint_auth_method,
                grant_types: ['authorization_code', 'refresh_token'],
                response_types: ['code']
            },
            201
        );
    });

    if (deps.requireSession) {
        routes.use('/oauth/authorize', deps.requireSession);
    }

    routes.get('/oauth/authorize', c => {
        const request = authorizationRequest(c.req.query(), oauth);
        if ('page' in request) return c.html(request.page, 400);
        if ('redirect' in request) return c.redirect(request.redirect, 303);
        return c.html(<ConsentPage {...request} />);
    });

    routes.post('/oauth/authorize', async c => {
        const body = Object.fromEntries(
            Object.entries(await c.req.parseBody()).map(([k, v]) => [
                k,
                String(v)
            ])
        );
        const request = authorizationRequest(body, oauth);
        if ('page' in request) return c.html(request.page, 400);
        if ('redirect' in request) return c.redirect(request.redirect, 303);
        if (body.decision !== 'allow') {
            return c.redirect(
                callback(request.redirectUri, request.state, {
                    error: 'access_denied'
                }),
                303
            );
        }
        const code = newSecret();
        oauth.purgeExpired(now());
        oauth.addCode(code, request, now() + CODE_TTL_MS);
        return c.redirect(
            callback(request.redirectUri, request.state, { code }),
            303
        );
    });

    routes.post('/oauth/token', async c => {
        const body = Object.fromEntries(
            Object.entries(await c.req.parseBody()).map(([k, v]) => [
                k,
                String(v)
            ])
        );
        const client = authenticateClient(c, body, oauth);
        if (!client) return tokenError(c, 'invalid_client', 401);

        if (body.grant_type === 'authorization_code') {
            const grant = oauth.takeCode(body.code ?? '', now());
            if (
                !grant ||
                grant.clientId !== client ||
                grant.redirectUri !== body.redirect_uri ||
                sha256(body.code_verifier ?? '') !== grant.codeChallenge
            ) {
                return tokenError(c, 'invalid_grant');
            }
            return c.json(issueTokens(client));
        }

        if (body.grant_type === 'refresh_token') {
            const refresh = body.refresh_token ?? '';
            if (oauth.tokenClient(refresh, 'refresh', now()) !== client) {
                return tokenError(c, 'invalid_grant');
            }
            oauth.revokeToken(refresh);
            return c.json(issueTokens(client));
        }

        return tokenError(c, 'unsupported_grant_type');
    });

    function issueTokens(clientId: string) {
        const access = newSecret();
        const refresh = newSecret();
        oauth.purgeExpired(now());
        oauth.addToken(access, 'access', clientId, now() + ACCESS_TTL_S * 1000);
        oauth.addToken(refresh, 'refresh', clientId, now() + REFRESH_TTL_MS);
        return {
            access_token: access,
            token_type: 'Bearer',
            expires_in: ACCESS_TTL_S,
            refresh_token: refresh
        };
    }

    const requireMcpAuth = createMiddleware(async (c, next) => {
        const token = c.req
            .header('authorization')
            ?.match(/^Bearer\s+(\S+)$/i)?.[1];
        const valid =
            token !== undefined &&
            ((deps.staticToken !== undefined &&
                safeEqual(token, deps.staticToken)) ||
                oauth.tokenClient(token, 'access', now()) !== undefined);
        if (valid) return next();
        c.header(
            'WWW-Authenticate',
            `Bearer resource_metadata="${base(c)}/.well-known/oauth-protected-resource"`
        );
        return c.json({ error: 'invalid_token' }, 401);
    });

    return { routes, requireMcpAuth };
}

type AuthorizationRequest = {
    clientId: string;
    clientName: string | null;
    redirectUri: string;
    codeChallenge: string;
    state: string | undefined;
};

function authorizationRequest(
    params: Record<string, string | undefined>,
    oauth: OAuthStore
): AuthorizationRequest | { page: string } | { redirect: string } {
    const client = oauth.client(params.client_id ?? '');
    const redirectUri = params.redirect_uri ?? '';
    if (!client || !client.redirectUris.includes(redirectUri)) {
        return {
            page: String(
                <ErrorPage message="Unknown client or redirect URI. Remove the connector and add it again." />
            )
        };
    }
    const fail = (error: string) => ({
        redirect: callback(redirectUri, params.state, { error })
    });
    if (params.response_type !== 'code')
        return fail('unsupported_response_type');
    if (!params.code_challenge || params.code_challenge_method !== 'S256') {
        return fail('invalid_request');
    }
    return {
        clientId: client.clientId,
        clientName: client.name,
        redirectUri,
        codeChallenge: params.code_challenge,
        state: params.state
    };
}

function authenticateClient(
    c: Context,
    body: Record<string, string>,
    oauth: OAuthStore
): string | undefined {
    let clientId = body.client_id;
    let secret = body.client_secret;
    const basic = c.req.header('authorization')?.match(/^Basic\s+(\S+)$/i);
    if (basic?.[1]) {
        const decoded = Buffer.from(basic[1], 'base64').toString();
        const split = decoded.indexOf(':');
        clientId = decodeURIComponent(decoded.slice(0, split));
        secret = decodeURIComponent(decoded.slice(split + 1));
    }
    const client = oauth.client(clientId ?? '');
    if (!client) return undefined;
    if (!client.hasSecret) return client.clientId;
    return secret && oauth.clientSecretMatches(client.clientId, secret)
        ? client.clientId
        : undefined;
}

function tokenError(c: Context, error: string, status: 400 | 401 = 400) {
    return c.json({ error }, status);
}

function callback(
    redirectUri: string,
    state: string | undefined,
    params: Record<string, string>
): string {
    const url = new URL(redirectUri);
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }
    if (state !== undefined) url.searchParams.set('state', state);
    return url.href;
}

function baseUrl(c: Context, publicUrl: URL | undefined): string {
    if (publicUrl) return publicUrl.origin;
    const url = new URL(c.req.url);
    const proto =
        c.req.header('x-forwarded-proto') ?? url.protocol.slice(0, -1);
    const host =
        c.req.header('x-forwarded-host') ?? c.req.header('host') ?? url.host;
    return `${proto}://${host}`;
}

function isAllowedRedirect(uri: string): boolean {
    const url = new URL(uri);
    if (url.protocol === 'https:') return true;
    return (
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    );
}

function ConsentPage(p: AuthorizationRequest) {
    return (
        <Layout title="Health · Connect">
            <section>
                <h2>Connect {p.clientName ?? 'an app'}?</h2>
                <p>
                    {p.clientName ?? 'This app'} will be able to read your
                    weights, readings and food log. It cannot change anything.
                </p>
                <p class="muted">
                    It will return to {new URL(p.redirectUri).host}.
                </p>
                <form method="post" action="/oauth/authorize" class="entry">
                    <input type="hidden" name="client_id" value={p.clientId} />
                    <input
                        type="hidden"
                        name="redirect_uri"
                        value={p.redirectUri}
                    />
                    <input type="hidden" name="response_type" value="code" />
                    <input
                        type="hidden"
                        name="code_challenge"
                        value={p.codeChallenge}
                    />
                    <input
                        type="hidden"
                        name="code_challenge_method"
                        value="S256"
                    />
                    {p.state !== undefined && (
                        <input type="hidden" name="state" value={p.state} />
                    )}
                    <button type="submit" name="decision" value="allow">
                        Allow
                    </button>
                    <button
                        type="submit"
                        name="decision"
                        value="deny"
                        class="link"
                    >
                        Deny
                    </button>
                </form>
            </section>
        </Layout>
    );
}

function ErrorPage(props: { message: string }) {
    return (
        <Layout title="Health · Connect">
            <div class="error">{props.message}</div>
        </Layout>
    );
}
