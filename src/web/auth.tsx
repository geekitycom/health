import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { Layout } from './layout.js';

const COOKIE = 'health_session';
const SESSION_DAYS = 90;

export type AuthDeps = {
    password: string;
    now(): Date;
};

export function safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
}

export function safePath(path: string | undefined): string {
    return path?.startsWith('/') && !path.startsWith('//') ? path : '/';
}

export function passwordAuth(deps: AuthDeps) {
    // Changing APP_PASSWORD changes the key and signs everyone out.
    const secret = createHash('sha256')
        .update(`health-session:${deps.password}`)
        .digest();

    const routes = new Hono();

    routes.get('/login', c =>
        c.html(<LoginPage next={safePath(c.req.query('next'))} />)
    );

    routes.post('/login', async c => {
        const body = await c.req.parseBody();
        const next = safePath(String(body.next ?? '/'));
        if (!safeEqual(String(body.password ?? ''), deps.password)) {
            return c.html(<LoginPage next={next} failed />, 401);
        }
        const maxAge = SESSION_DAYS * 86400;
        await setSignedCookie(
            c,
            COOKIE,
            String(deps.now().getTime() + maxAge * 1000),
            secret,
            {
                path: '/',
                httpOnly: true,
                sameSite: 'Lax',
                secure: isHttps(c),
                maxAge
            }
        );
        return c.redirect(next, 303);
    });

    routes.post('/logout', c => {
        deleteCookie(c, COOKIE, { path: '/' });
        return c.redirect('/login', 303);
    });

    const requireSession = createMiddleware(async (c, next) => {
        const expires = await getSignedCookie(c, secret, COOKIE);
        if (expires && Number(expires) > deps.now().getTime()) {
            return next();
        }
        const url = new URL(c.req.url);
        const back = c.req.method === 'GET' ? url.pathname + url.search : '/';
        return c.redirect(`/login?next=${encodeURIComponent(back)}`, 303);
    });

    return { routes, requireSession };
}

function isHttps(c: Context): boolean {
    return (
        c.req.header('x-forwarded-proto') === 'https' ||
        new URL(c.req.url).protocol === 'https:'
    );
}

function LoginPage(props: { next: string; failed?: boolean }) {
    return (
        <Layout title="Health · Sign in">
            <section>
                <h2>Sign in</h2>
                {props.failed && <p class="error">Wrong password.</p>}
                <form class="entry" method="post" action="/login">
                    <input type="hidden" name="next" value={props.next} />
                    <input
                        type="text"
                        name="username"
                        autocomplete="username"
                        value="health"
                        hidden
                    />
                    <label class="wide">
                        Password
                        <input
                            type="password"
                            name="password"
                            autocomplete="current-password"
                            required
                            autofocus
                        />
                    </label>
                    <button type="submit">Sign in</button>
                </form>
            </section>
        </Layout>
    );
}
