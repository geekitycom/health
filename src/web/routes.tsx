import { Hono } from 'hono';
import type { z } from 'zod';
import type { WeightUnit } from '../config.js';
import { addDays, isValidDate, lastDays, type LocalNow } from '../dates.js';
import { readingInput, weightInput } from '../entries.js';
import { isActiveOn, parseAnswer } from '../goals/model.js';
import type { Store } from '../store.js';
import { safePath } from './auth.js';
import { DayPage, HistoryPage } from './pages.js';

export type WebDeps = {
    store: Store;
    weightUnit: WeightUnit;
    signOut: boolean;
    now(): LocalNow;
};

const NUMERIC_FIELDS = new Set(['weight', 'value', 'systolic', 'diastolic']);

export function webRoutes(deps: WebDeps) {
    const { store } = deps;
    const app = new Hono();

    app.get('/', c => {
        const now = deps.now();
        const requested = c.req.query('date');
        const date = requested && isValidDate(requested) ? requested : now.date;
        return c.html(
            <DayPage
                date={date}
                isToday={date === now.date}
                defaultTime={date === now.date ? now.time : '08:00'}
                goals={store.goals.goalsInRange({ from: date, to: date })}
                goalAnswers={store.goals.answers({ from: date, to: date })}
                weightUnit={deps.weightUnit}
                signOut={deps.signOut}
                weight={store.weights({ from: date, to: date })[0]}
                previousWeight={store.latestWeightBefore(date)}
                readings={store.readings({ from: date, to: date })}
                recentWeights={store.weights(lastDays(date, 30))}
                error={c.req.query('error')}
            />
        );
    });

    app.get('/history', c => {
        const days = Math.min(
            Math.max(Number(c.req.query('days')) || 30, 1),
            366
        );
        const range = lastDays(deps.now().date, days);
        const dates = Array.from({ length: days }, (_, i) =>
            addDays(range.to, -i)
        );
        return c.html(
            <HistoryPage
                days={days}
                weightUnit={deps.weightUnit}
                signOut={deps.signOut}
                dates={dates}
                weights={store.weights(range)}
                readings={store.readings(range)}
            />
        );
    });

    app.post('/goals/:id/answer', async c => {
        const body = await c.req.parseBody();
        const date = String(body.date ?? '');
        const raw = String(body.value ?? '');
        const back = `/?date=${encodeURIComponent(date)}`;
        const goal = store.goals.goal(Number(c.req.param('id')));
        const fail = (message: string) =>
            c.redirect(
                `${back}&error=${encodeURIComponent(message)}#goals`,
                303
            );
        if (!goal || !isValidDate(date)) return fail('Unknown goal or date.');
        if (raw.trim() === '') {
            store.goals.clearAnswer(goal.id, date);
            return c.redirect(`${back}#goals`, 303);
        }
        if (!isActiveOn(goal, date))
            return fail('That goal is not asked on this day.');
        const value = parseAnswer(goal, raw);
        if (value === undefined)
            return fail(`Not a valid answer for "${goal.prompt}".`);
        store.goals.setAnswer({
            goalId: goal.id,
            date,
            value,
            answeredAt: deps.now().time
        });
        return c.redirect(`${back}#goals`, 303);
    });

    const save = <S extends z.ZodType>(
        path: string,
        schema: S,
        write: (input: z.infer<S>) => void
    ) =>
        app.post(path, async c => {
            const fields = formFields(await c.req.parseBody());
            const back = `/?date=${encodeURIComponent(String(fields.date ?? ''))}`;
            const parsed = schema.safeParse(fields);
            if (!parsed.success) {
                const message = parsed.error.issues
                    .map(
                        i =>
                            (i.path.length ? `${i.path.join('.')}: ` : '') +
                            i.message
                    )
                    .join('; ');
                return c.redirect(
                    `${back}&error=${encodeURIComponent(message)}`,
                    303
                );
            }
            write(parsed.data);
            return c.redirect(back, 303);
        });

    save('/weights', weightInput, input => store.upsertWeight(input));
    save('/readings', readingInput, input => store.addReading(input));

    const remove = (path: string, del: (key: string) => void) =>
        app.post(path, async c => {
            del(c.req.param('key') ?? '');
            const back = (await c.req.parseBody()).back;
            return c.redirect(safePath(String(back)), 303);
        });

    remove('/weights/:key/delete', date => store.deleteWeight(date));
    remove('/readings/:key/delete', id => store.deleteReading(Number(id)));

    return app;
}

function formFields(body: Record<string, unknown>) {
    const fields: Record<string, string | number> = {};
    for (const [key, raw] of Object.entries(body)) {
        if (typeof raw !== 'string') continue;
        const value = raw.trim();
        if (value === '') continue;
        fields[key] = NUMERIC_FIELDS.has(key) ? Number(value) : value;
    }
    return fields;
}
