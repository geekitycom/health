import { describe, expect, it } from 'vitest';
import { harness } from './support/harness.js';

describe('web UI', () => {
    it('defaults the day page to today in the configured time zone', async () => {
        const { app } = harness();
        const html = await (await app.request('/')).text();
        expect(html).toContain('value="2026-10-25"');
        expect(html).toContain('value="09:30"');
    });

    it('saves a weight once per day, updating on resubmit', async () => {
        const { post, store } = harness();
        await post('/weights', { date: '2026-10-24', weight: '220.4' });
        const res = await post('/weights', {
            date: '2026-10-24',
            weight: '219.8',
            note: 'after run'
        });
        expect(res.status).toBe(303);
        expect(res.headers.get('location')).toBe('/?date=2026-10-24');
        expect(store.weights({ from: '2026-10-01', to: '2026-10-31' })).toEqual(
            [{ date: '2026-10-24', weight: 219.8, note: 'after run' }]
        );
    });

    it('shows weight change and GKI on the day page', async () => {
        const { app, post } = harness();
        await post('/weights', { date: '2026-10-24', weight: '220' });
        await post('/weights', { date: '2026-10-25', weight: '218.5' });
        await post('/readings', {
            date: '2026-10-25',
            time: '07:00',
            kind: 'glucose',
            value: '90'
        });
        await post('/readings', {
            date: '2026-10-25',
            time: '07:20',
            kind: 'ketones',
            value: '1.5'
        });
        const html = await (await app.request('/?date=2026-10-25')).text();
        expect(html).toContain('-1.5 lb since 2026-10-24');
        expect(html).toContain('Ketones 1.5 mmol/L');
        expect(html).toContain('<td class="num">3.3</td>');
    });

    it('records one kind of reading and ignores fields for other kinds', async () => {
        const { post, store } = harness();
        await post('/readings', {
            date: '2026-10-25',
            time: '08:00',
            kind: 'blood_pressure',
            value: '1.2',
            systolic: '118',
            diastolic: '76'
        });
        expect(
            store.readings({ from: '2026-10-25', to: '2026-10-25' })
        ).toEqual([
            {
                id: 1,
                date: '2026-10-25',
                time: '08:00',
                kind: 'blood_pressure',
                systolic: 118,
                diastolic: 76,
                note: null
            }
        ]);
    });

    it('rejects a reading with half a blood pressure', async () => {
        const { post, store } = harness();
        const res = await post('/readings', {
            date: '2026-10-25',
            time: '07:00',
            kind: 'blood_pressure',
            systolic: '120'
        });
        expect(res.headers.get('location')).toContain('error=');
        expect(
            store.readings({ from: '2026-10-25', to: '2026-10-25' })
        ).toEqual([]);
    });

    it('totals net carbs for the day and deletes items', async () => {
        const { app, post, store } = harness();
        const day = { from: '2026-10-25', to: '2026-10-25' };
        await post('/foods', {
            date: '2026-10-25',
            time: '08:00',
            meal: 'breakfast',
            description: 'Eggs and avocado',
            calories: '450',
            carbs: '9',
            fiber: '7'
        });
        await post('/foods', {
            date: '2026-10-25',
            time: '12:30',
            meal: 'lunch',
            description: 'Salad',
            carbs: '6',
            fiber: '2'
        });
        const html = await (await app.request('/?date=2026-10-25')).text();
        expect(html).toMatch(/Total<\/th>.*<th class="num">6<\/th><th>/s);

        const [first] = store.foods(day);
        await post(`/foods/${first?.id}/delete`, { back: '/?date=2026-10-25' });
        expect(store.foods(day).map(f => f.description)).toEqual(['Salad']);
    });
});

describe('sign in', () => {
    async function signIn(
        post: ReturnType<typeof harness>['post'],
        password: string
    ) {
        return post('/login', { password, next: '/history?days=7' });
    }

    it('redirects to the login form with the page to return to', async () => {
        const { app } = harness({ APP_PASSWORD: 'secret' });
        const res = await app.request('/history?days=7');
        expect(res.status).toBe(303);
        expect(res.headers.get('location')).toBe(
            '/login?next=%2Fhistory%3Fdays%3D7'
        );
        const form = await (await app.request('/login')).text();
        expect(form).toContain('autocomplete="current-password"');
        expect((await app.request('/health')).status).toBe(200);
    });

    it('rejects a wrong password', async () => {
        const { post } = harness({ APP_PASSWORD: 'secret' });
        const res = await signIn(post, 'nope');
        expect(res.status).toBe(401);
        expect(res.headers.get('set-cookie')).toBeNull();
        expect(await res.text()).toContain('Wrong password.');
    });

    it('keeps a session cookie after signing in', async () => {
        const { app, post } = harness({ APP_PASSWORD: 'secret' });
        const res = await signIn(post, 'secret');
        expect(res.status).toBe(303);
        expect(res.headers.get('location')).toBe('/history?days=7');
        const cookie = res.headers.get('set-cookie') ?? '';
        expect(cookie).toContain('HttpOnly');
        const session = cookie.split(';')[0] ?? '';

        const page = await app.request('/', { headers: { cookie: session } });
        expect(page.status).toBe(200);
        expect(await page.text()).toContain('Sign out');

        const forged = session.replace(/=\d+/, '=99999999999999');
        const rejected = await app.request('/', {
            headers: { cookie: forged }
        });
        expect(rejected.status).toBe(303);
    });

    it('clears the session on sign out', async () => {
        const { post } = harness({ APP_PASSWORD: 'secret' });
        const res = await post('/logout', {});
        expect(res.headers.get('location')).toBe('/login');
        expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    });

    it('blocks writes without a session', async () => {
        const { post, store } = harness({ APP_PASSWORD: 'secret' });
        const res = await post('/weights', {
            date: '2026-10-25',
            weight: '200'
        });
        expect(res.headers.get('location')).toBe('/login?next=%2F');
        expect(store.weights({ from: '2026-10-25', to: '2026-10-25' })).toEqual(
            []
        );
    });

    it('marks the cookie Secure behind an https proxy', async () => {
        const { app } = harness({ APP_PASSWORD: 'secret' });
        const res = await app.request('/login', {
            method: 'POST',
            body: new URLSearchParams({ password: 'secret' }),
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'x-forwarded-proto': 'https'
            }
        });
        expect(res.headers.get('set-cookie')).toContain('Secure');
    });
});
