import { describe, expect, it } from 'vitest';
import { harness } from './support/harness.js';
import { call, connect } from './support/mcp.js';

function seed(store: ReturnType<typeof harness>['store']) {
    store.upsertWeight({ date: '2026-10-01', weight: 225 });
    store.upsertWeight({ date: '2026-10-25', weight: 219.5 });
    store.addReading({
        date: '2026-10-25',
        time: '07:00',
        kind: 'glucose',
        value: 90
    });
    store.addReading({
        date: '2026-10-25',
        time: '07:10',
        kind: 'ketones',
        value: 1.5
    });
    store.addReading({
        date: '2026-10-25',
        time: '19:00',
        kind: 'blood_pressure',
        systolic: 122,
        diastolic: 80
    });
    store.addFood({
        date: '2026-10-25',
        time: '08:00',
        meal: 'breakfast',
        description: 'Eggs',
        calories: 300,
        protein: 20,
        carbs: 3,
        fiber: 1
    });
}

describe('MCP server', () => {
    it('only lets goal tools write', async () => {
        const { app } = harness();
        const client = await connect(app);
        const { tools } = await client.listTools();
        const writers = tools
            .filter(t => !t.annotations?.readOnlyHint)
            .map(t => t.name)
            .sort();
        expect(writers).toEqual(['create_goal', 'end_goal']);
        expect(tools.map(t => t.name).sort()).toEqual([
            'create_goal',
            'end_goal',
            'get_food_log',
            'get_goal_answers',
            'get_readings',
            'get_summary',
            'get_weights',
            'list_goals'
        ]);
    });

    it('summarizes the last 30 days by default', async () => {
        const { app, store } = harness();
        seed(store);
        const summary = await call(await connect(app), 'get_summary');
        expect(summary.range).toEqual({ from: '2026-09-26', to: '2026-10-25' });
        expect(summary.weight.change).toBe(-5.5);
        expect(summary.readings.gki.avg).toBe(3.3);
        expect(summary.readings.systolic.avg).toBe(122);
        expect(summary.food.averagePerLoggedDay.netCarbs).toBe(2);
    });

    it('returns entries for an explicit range', async () => {
        const { app, store } = harness();
        seed(store);
        const client = await connect(app);
        const weights = await call(client, 'get_weights', {
            from: '2026-10-20',
            to: '2026-10-25'
        });
        expect(weights.weights).toEqual([
            { date: '2026-10-25', weight: 219.5, note: null }
        ]);
        const food = await call(client, 'get_food_log', { days: 1 });
        expect(food.dailyTotals[0]).toMatchObject({
            date: '2026-10-25',
            calories: 300,
            netCarbs: 2
        });
        const readings = await call(client, 'get_readings', { days: 1 });
        expect(readings.readings).toEqual([
            {
                id: 1,
                date: '2026-10-25',
                time: '07:00',
                kind: 'glucose',
                value: 90,
                note: null
            },
            {
                id: 2,
                date: '2026-10-25',
                time: '07:10',
                kind: 'ketones',
                value: 1.5,
                note: null,
                gki: 3.3
            },
            {
                id: 3,
                date: '2026-10-25',
                time: '19:00',
                kind: 'blood_pressure',
                systolic: 122,
                diastolic: 80,
                note: null
            }
        ]);
    });

    it('requires the bearer token when MCP_TOKEN is set', async () => {
        const { app } = harness({ MCP_TOKEN: 'tok', APP_PASSWORD: 'pw' });
        await expect(connect(app)).rejects.toThrow();
        const client = await connect(app, 'tok');
        expect((await client.listTools()).tools.length).toBe(8);
    });
});
