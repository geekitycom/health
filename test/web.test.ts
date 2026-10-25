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
            glucose: '90',
            ketones: '1.5'
        });
        const html = await (await app.request('/?date=2026-10-25')).text();
        expect(html).toContain('-1.5 lb since 2026-10-24');
        expect(html).toContain('<td class="num">3.3</td>');
    });

    it('rejects a reading with half a blood pressure', async () => {
        const { post, store } = harness();
        const res = await post('/readings', {
            date: '2026-10-25',
            time: '07:00',
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

    it('requires the password when APP_PASSWORD is set', async () => {
        const { app } = harness({ APP_PASSWORD: 'secret' });
        expect((await app.request('/')).status).toBe(401);
        const ok = await app.request('/', {
            headers: { authorization: `Basic ${btoa('me:secret')}` }
        });
        expect(ok.status).toBe(200);
        expect((await app.request('/health')).status).toBe(200);
    });
});
