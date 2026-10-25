import { describe, expect, it } from 'vitest';
import { harness } from './support/harness.js';
import { call, connect } from './support/mcp.js';

const TODAY = '2026-10-25';

async function setup() {
    const h = harness();
    const client = await connect(h.app);
    const dayPage = async (date = TODAY) =>
        (await h.app.request(`/?date=${date}`)).text();
    const answer = (id: number, value: string, date = TODAY) =>
        h.post(`/goals/${id}/answer`, { date, value });
    return { ...h, client, dayPage, answer };
}

describe('daily goals', () => {
    it('asks a coach-created yes/no goal and records the answer', async () => {
        const { client, dayPage, answer } = await setup();
        const { goal } = await call(client, 'create_goal', {
            prompt: "Ate chia pudding first, made tomorrow's",
            kind: 'yes_no'
        });
        expect(goal).toMatchObject({
            kind: 'yes_no',
            startDate: TODAY,
            endDate: null
        });

        expect(await dayPage()).toContain(
            'Ate chia pudding first, made tomorrow&#39;s'
        );
        const res = await answer(goal.id, 'yes');
        expect(res.headers.get('location')).toBe(`/?date=${TODAY}#goals`);
        expect(await dayPage()).toMatch(
            /aria-pressed="true"[^>]*>Yes<|value="yes"[^>]*aria-pressed="true"/
        );

        const log = await call(client, 'get_goal_answers', { days: 3 });
        expect(log.goals[0]).toMatchObject({
            id: goal.id,
            answers: [{ date: TODAY, value: 'yes', answeredAt: '09:30' }],
            unansweredDates: []
        });
    });

    it('answers each goal on its own', async () => {
        const { client, store, answer } = await setup();
        const { goal: water } = await call(client, 'create_goal', {
            prompt: 'Water intake',
            kind: 'choice',
            options: ['Under 2L', '2-3L', 'Over 3L']
        });
        const { goal: mood } = await call(client, 'create_goal', {
            prompt: 'How did today feel?',
            kind: 'text'
        });

        await answer(water.id, '2-3L');
        expect(store.goals.answers({ from: TODAY, to: TODAY })).toEqual([
            {
                goalId: water.id,
                date: TODAY,
                value: '2-3L',
                answeredAt: '09:30'
            }
        ]);

        await answer(mood.id, 'Steady energy, no cravings');
        await answer(water.id, '');
        expect(store.goals.answers({ from: TODAY, to: TODAY })).toEqual([
            {
                goalId: mood.id,
                date: TODAY,
                value: 'Steady energy, no cravings',
                answeredAt: '09:30'
            }
        ]);
    });

    it('rejects answers that are not one of the options', async () => {
        const { client, store, answer } = await setup();
        const { goal } = await call(client, 'create_goal', {
            prompt: 'Water intake',
            kind: 'choice',
            options: ['Under 2L', 'Over 2L']
        });
        const res = await answer(goal.id, 'Lots');
        expect(res.headers.get('location')).toContain('error=');
        expect(store.goals.answers({ from: TODAY, to: TODAY })).toEqual([]);
    });

    it('refuses a choice goal without options', async () => {
        const { client } = await setup();
        const result = await client.callTool({
            name: 'create_goal',
            arguments: { prompt: 'Pick one', kind: 'choice' }
        });
        expect(result.isError).toBe(true);
        expect((await call(client, 'list_goals')).goals).toEqual([]);
    });

    it('starts on start_date and stops after end_goal, keeping answers', async () => {
        const { client, dayPage, answer } = await setup();
        const { goal: later } = await call(client, 'create_goal', {
            prompt: 'Walked after dinner',
            kind: 'yes_no',
            start_date: '2026-10-26'
        });
        expect(await dayPage()).not.toContain('Walked after dinner');
        expect(await dayPage('2026-10-26')).toContain('Walked after dinner');
        expect(
            (await answer(later.id, 'yes')).headers.get('location')
        ).toContain('error=');

        const { goal } = await call(client, 'create_goal', {
            prompt: 'No snacks after 8pm',
            kind: 'yes_no',
            start_date: '2026-10-20'
        });
        await answer(goal.id, 'no', '2026-10-22');
        await call(client, 'end_goal', { id: goal.id });

        expect(await dayPage()).not.toContain('No snacks after 8pm');
        expect(await dayPage('2026-10-22')).toContain('No snacks after 8pm');
        expect((await call(client, 'list_goals')).goals).toHaveLength(1);
        expect(
            (await call(client, 'list_goals', { include_ended: true })).goals
        ).toHaveLength(2);

        const log = await call(client, 'get_goal_answers', {
            from: '2026-10-20',
            to: TODAY
        });
        expect(
            log.goals.find((g: { id: number }) => g.id === goal.id)
        ).toMatchObject({
            endDate: TODAY,
            answers: [{ date: '2026-10-22', value: 'no' }],
            unansweredDates: [
                '2026-10-20',
                '2026-10-21',
                '2026-10-23',
                '2026-10-24'
            ]
        });
    });

    it('reports adherence in the summary', async () => {
        const { client, answer } = await setup();
        const { goal } = await call(client, 'create_goal', {
            prompt: 'Hit protein target',
            kind: 'yes_no',
            start_date: '2026-10-23'
        });
        await answer(goal.id, 'yes', '2026-10-23');
        await answer(goal.id, 'no', '2026-10-24');
        await answer(goal.id, 'yes', TODAY);
        const summary = await call(client, 'get_summary', { days: 7 });
        expect(summary.goals).toEqual([
            {
                id: goal.id,
                prompt: 'Hit protein target',
                kind: 'yes_no',
                daysAsked: 3,
                answered: 3,
                counts: { yes: 2, no: 1 }
            }
        ]);
    });
});
