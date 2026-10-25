import type { WeightUnit } from '../config.js';
import { addDays } from '../dates.js';
import {
    MEALS,
    type Food,
    type Meal,
    type Reading,
    type Weight
} from '../entries.js';
import { dailyTotals, gki, netCarbs, type DayTotals } from '../summary.js';
import { Layout } from './layout.js';

export type DayPageProps = {
    date: string;
    isToday: boolean;
    defaultTime: string;
    weightUnit: WeightUnit;
    weight: Weight | undefined;
    previousWeight: Weight | undefined;
    readings: Reading[];
    foods: Food[];
    recentWeights: Weight[];
    error: string | undefined;
};

export function DayPage(p: DayPageProps) {
    const totals = dailyTotals(p.foods)[0];
    const change =
        p.weight && p.previousWeight
            ? p.weight.weight - p.previousWeight.weight
            : undefined;
    const back = `/?date=${p.date}`;

    return (
        <Layout title={`Health · ${p.date}`} nav="today">
            {p.error && <div class="error">{p.error}</div>}
            <section class="daynav">
                <a href={`/?date=${addDays(p.date, -1)}`}>← Prev</a>
                <form method="get" action="/">
                    <input type="date" name="date" value={p.date} />
                    <button type="submit">Go</button>
                </form>
                {p.isToday ? (
                    <span class="muted">Today</span>
                ) : (
                    <a href={`/?date=${addDays(p.date, 1)}`}>Next →</a>
                )}
            </section>

            <section>
                <h2>Weight</h2>
                <form class="entry" method="post" action="/weights">
                    <input type="hidden" name="date" value={p.date} />
                    <label>
                        Weight ({p.weightUnit})
                        <input
                            name="weight"
                            type="number"
                            step="0.1"
                            inputmode="decimal"
                            required
                            value={p.weight?.weight}
                        />
                    </label>
                    <label>
                        Note
                        <input name="note" value={p.weight?.note ?? ''} />
                    </label>
                    <label>
                        &nbsp;
                        <button type="submit">
                            {p.weight ? 'Update' : 'Save'}
                        </button>
                    </label>
                </form>
                {p.weight && (
                    <div class="muted" style="margin: 12px 0">
                        {change === undefined
                            ? 'First weigh-in.'
                            : `${signed(change)} ${p.weightUnit} since ${p.previousWeight?.date}.`}{' '}
                        <DeleteButton
                            action={`/weights/${p.date}/delete`}
                            back={back}
                        />
                    </div>
                )}
                <Sparkline weights={p.recentWeights} />
            </section>

            <section>
                <h2>Readings</h2>
                <form class="entry" method="post" action="/readings">
                    <input type="hidden" name="date" value={p.date} />
                    <label>
                        Time
                        <input
                            name="time"
                            type="time"
                            value={p.defaultTime}
                            required
                        />
                    </label>
                    <NumberField
                        name="glucose"
                        label="Glucose (mg/dL)"
                        step="1"
                    />
                    <NumberField
                        name="ketones"
                        label="Ketones (mmol/L)"
                        step="0.1"
                    />
                    <NumberField name="systolic" label="Systolic" step="1" />
                    <NumberField name="diastolic" label="Diastolic" step="1" />
                    <NumberField name="pulse" label="Pulse" step="1" />
                    <label class="wide">
                        Note
                        <input name="note" />
                    </label>
                    <button type="submit">Add reading</button>
                </form>
                {p.readings.length > 0 && (
                    <div class="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Time</th>
                                    <th class="num">Glucose</th>
                                    <th class="num">Ketones</th>
                                    <th class="num">GKI</th>
                                    <th class="num">BP</th>
                                    <th class="num">Pulse</th>
                                    <th>Note</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {p.readings.map(r => (
                                    <tr>
                                        <td>{r.time}</td>
                                        <td class="num">{r.glucose ?? ''}</td>
                                        <td class="num">{r.ketones ?? ''}</td>
                                        <td class="num">{gki(r) ?? ''}</td>
                                        <td class="num">
                                            {r.systolic !== null
                                                ? `${r.systolic}/${r.diastolic}`
                                                : ''}
                                        </td>
                                        <td class="num">{r.pulse ?? ''}</td>
                                        <td>{r.note ?? ''}</td>
                                        <td>
                                            <DeleteButton
                                                action={`/readings/${r.id}/delete`}
                                                back={back}
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <section>
                <h2>Food</h2>
                <form class="entry" method="post" action="/foods">
                    <input type="hidden" name="date" value={p.date} />
                    <label>
                        Time
                        <input
                            name="time"
                            type="time"
                            value={p.defaultTime}
                            required
                        />
                    </label>
                    <label>
                        Meal
                        <select name="meal">
                            {MEALS.map(m => (
                                <option
                                    value={m}
                                    selected={m === mealFor(p.defaultTime)}
                                >
                                    {m}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label class="wide">
                        What
                        <input name="description" required />
                    </label>
                    <NumberField name="calories" label="Calories" step="1" />
                    <NumberField name="fat" label="Fat (g)" step="0.1" />
                    <NumberField
                        name="protein"
                        label="Protein (g)"
                        step="0.1"
                    />
                    <NumberField name="carbs" label="Carbs (g)" step="0.1" />
                    <NumberField name="fiber" label="Fiber (g)" step="0.1" />
                    <label class="wide">
                        Note
                        <input name="note" />
                    </label>
                    <button type="submit">Add food</button>
                </form>
                {p.foods.length > 0 && (
                    <div class="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Time</th>
                                    <th>Food</th>
                                    <th class="num">Cal</th>
                                    <th class="num">Fat</th>
                                    <th class="num">Protein</th>
                                    <th class="num">Net carbs</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {p.foods.map(f => (
                                    <tr>
                                        <td>{f.time}</td>
                                        <td>
                                            {f.description}{' '}
                                            <span class="muted">{f.meal}</span>
                                            {f.note && (
                                                <div class="muted">
                                                    {f.note}
                                                </div>
                                            )}
                                        </td>
                                        <td class="num">{f.calories ?? ''}</td>
                                        <td class="num">{f.fat ?? ''}</td>
                                        <td class="num">{f.protein ?? ''}</td>
                                        <td class="num">{netCarbs(f) ?? ''}</td>
                                        <td>
                                            <DeleteButton
                                                action={`/foods/${f.id}/delete`}
                                                back={back}
                                            />
                                        </td>
                                    </tr>
                                ))}
                                {totals && (
                                    <tr>
                                        <th colspan={2}>Total</th>
                                        <th class="num">{totals.calories}</th>
                                        <th class="num">{totals.fat}</th>
                                        <th class="num">{totals.protein}</th>
                                        <th class="num">{totals.netCarbs}</th>
                                        <th />
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </Layout>
    );
}

export type HistoryPageProps = {
    days: number;
    weightUnit: WeightUnit;
    dates: string[];
    weights: Weight[];
    readings: Reading[];
    foods: Food[];
};

export function HistoryPage(p: HistoryPageProps) {
    const weightByDate = new Map(p.weights.map(w => [w.date, w]));
    const totalsByDate = new Map<string, DayTotals>(
        dailyTotals(p.foods).map(t => [t.date, t])
    );
    const readingsByDate = Map.groupBy(p.readings, r => r.date);
    const first = p.weights[0];
    const last = p.weights.at(-1);

    return (
        <Layout title="Health · History" nav="history">
            <section>
                <div class="daynav">
                    <h2>Last {p.days} days</h2>
                    <span>
                        {[7, 30, 90, 365].map(d => (
                            <>
                                {' '}
                                <a href={`/history?days=${d}`}>{d}d</a>
                            </>
                        ))}
                    </span>
                </div>
                <div class="stats">
                    <div class="stat">
                        <b>{last ? `${last.weight} ${p.weightUnit}` : '·'}</b>
                        <span>Latest weight</span>
                    </div>
                    <div class="stat">
                        <b>
                            {first && last
                                ? `${signed(last.weight - first.weight)} ${p.weightUnit}`
                                : '·'}
                        </b>
                        <span>Change in range</span>
                    </div>
                    <div class="stat">
                        <b>{totalsByDate.size}</b>
                        <span>Days with food logged</span>
                    </div>
                </div>
                <Sparkline weights={p.weights} />
            </section>
            <section class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th class="num">Weight</th>
                            <th>Readings</th>
                            <th class="num">Cal</th>
                            <th class="num">Protein</th>
                            <th class="num">Net carbs</th>
                        </tr>
                    </thead>
                    <tbody>
                        {p.dates.map(date => {
                            const t = totalsByDate.get(date);
                            return (
                                <tr>
                                    <td>
                                        <a href={`/?date=${date}`}>{date}</a>
                                    </td>
                                    <td class="num">
                                        {weightByDate.get(date)?.weight ?? ''}
                                    </td>
                                    <td>
                                        {(readingsByDate.get(date) ?? [])
                                            .map(describeReading)
                                            .join('; ')}
                                    </td>
                                    <td class="num">{t?.calories ?? ''}</td>
                                    <td class="num">{t?.protein ?? ''}</td>
                                    <td class="num">{t?.netCarbs ?? ''}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </section>
        </Layout>
    );
}

function NumberField(props: { name: string; label: string; step: string }) {
    return (
        <label>
            {props.label}
            <input
                name={props.name}
                type="number"
                step={props.step}
                min="0"
                inputmode="decimal"
            />
        </label>
    );
}

function DeleteButton(props: { action: string; back: string }) {
    return (
        <form method="post" action={props.action} style="display:inline">
            <input type="hidden" name="back" value={props.back} />
            <button type="submit" class="link">
                delete
            </button>
        </form>
    );
}

function Sparkline(props: { weights: Weight[] }) {
    if (props.weights.length < 2) return null;
    const values = props.weights.map(w => w.weight);
    const min = Math.min(...values);
    const span = Math.max(...values) - min || 1;
    const step = 100 / (values.length - 1);
    const points = values
        .map(
            (v, i) =>
                `${(i * step).toFixed(2)},${(38 - ((v - min) / span) * 36).toFixed(2)}`
        )
        .join(' ');
    return (
        <svg
            class="spark"
            viewBox="0 0 100 40"
            preserveAspectRatio="none"
            role="img"
            aria-label={`Weight from ${values[0]} to ${values.at(-1)}`}
        >
            <polyline points={points} />
        </svg>
    );
}

function describeReading(r: Reading): string {
    const parts = [
        r.glucose !== null && `G ${r.glucose}`,
        r.ketones !== null && `K ${r.ketones}`,
        gki(r) !== null && `GKI ${gki(r)}`,
        r.systolic !== null && `BP ${r.systolic}/${r.diastolic}`,
        r.pulse !== null && `HR ${r.pulse}`
    ].filter(Boolean);
    return `${r.time} ${parts.join(' ')}`;
}

function mealFor(time: string): Meal {
    const hour = Number(time.slice(0, 2));
    if (hour >= 4 && hour < 11) return 'breakfast';
    if (hour >= 11 && hour < 15) return 'lunch';
    if (hour >= 17 && hour < 21) return 'dinner';
    return 'snack';
}

function signed(n: number): string {
    const rounded = Math.round(n * 10) / 10;
    return rounded > 0 ? `+${rounded}` : String(rounded);
}
