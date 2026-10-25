import { Hono } from 'hono';
import type { z } from 'zod';
import type { WeightUnit } from '../config.js';
import { addDays, isValidDate, lastDays, type LocalNow } from '../dates.js';
import { foodInput, readingInput, weightInput } from '../entries.js';
import type { Store } from '../store.js';
import { DayPage, HistoryPage } from './pages.js';

export type WebDeps = {
    store: Store;
    weightUnit: WeightUnit;
    now(): LocalNow;
};

const NUMERIC_FIELDS = new Set([
    'weight',
    'glucose',
    'ketones',
    'systolic',
    'diastolic',
    'pulse',
    'calories',
    'fat',
    'protein',
    'carbs',
    'fiber'
]);

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
                weightUnit={deps.weightUnit}
                weight={store.weights({ from: date, to: date })[0]}
                previousWeight={store.latestWeightBefore(date)}
                readings={store.readings({ from: date, to: date })}
                foods={store.foods({ from: date, to: date })}
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
                dates={dates}
                weights={store.weights(range)}
                readings={store.readings(range)}
                foods={store.foods(range)}
            />
        );
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
    save('/foods', foodInput, input => store.addFood(input));

    const remove = (path: string, del: (key: string) => void) =>
        app.post(path, async c => {
            del(c.req.param('key') ?? '');
            const back = String((await c.req.parseBody()).back ?? '/');
            return c.redirect(
                back.startsWith('/') && !back.startsWith('//') ? back : '/',
                303
            );
        });

    remove('/weights/:key/delete', date => store.deleteWeight(date));
    remove('/readings/:key/delete', id => store.deleteReading(Number(id)));
    remove('/foods/:key/delete', id => store.deleteFood(Number(id)));

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
