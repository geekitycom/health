import type { DateRange, Food, Reading } from './entries.js';
import type { Store } from './store.js';

const GLUCOSE_MG_DL_PER_MMOL_L = 18.016;
const GKI_PAIR_MINUTES = 30;

export type Macros = {
    calories: number;
    fat: number;
    protein: number;
    carbs: number;
    fiber: number;
    netCarbs: number;
};

export type DayTotals = Macros & { date: string; items: number };

export function netCarbs(food: Pick<Food, 'carbs' | 'fiber'>): number | null {
    if (food.carbs === null) return null;
    return Math.max(0, food.carbs - (food.fiber ?? 0));
}

/**
 * GKI for each ketone reading, keyed by its id, using the nearest glucose
 * reading on the same day taken within GKI_PAIR_MINUTES of it.
 */
export function gkiByKetoneId(readings: Reading[]): Map<number, number> {
    const result = new Map<number, number>();
    const glucose = readings.filter(r => r.kind === 'glucose');
    for (const ketone of readings) {
        if (ketone.kind !== 'ketones' || ketone.value <= 0) continue;
        let best: { value: number; gap: number } | undefined;
        for (const g of glucose) {
            if (g.kind !== 'glucose' || g.date !== ketone.date) continue;
            const gap = Math.abs(minutes(g.time) - minutes(ketone.time));
            if (gap <= GKI_PAIR_MINUTES && (!best || gap < best.gap)) {
                best = { value: g.value, gap };
            }
        }
        if (best) {
            result.set(
                ketone.id,
                round(best.value / GLUCOSE_MG_DL_PER_MMOL_L / ketone.value)
            );
        }
    }
    return result;
}

function minutes(time: string): number {
    return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export function dailyTotals(foods: Food[]): DayTotals[] {
    const days = new Map<string, DayTotals>();
    for (const food of foods) {
        let day = days.get(food.date);
        if (!day) {
            day = { date: food.date, items: 0, ...emptyMacros() };
            days.set(food.date, day);
        }
        day.items += 1;
        day.calories += food.calories ?? 0;
        day.fat += food.fat ?? 0;
        day.protein += food.protein ?? 0;
        day.carbs += food.carbs ?? 0;
        day.fiber += food.fiber ?? 0;
        day.netCarbs += netCarbs(food) ?? 0;
    }
    return [...days.values()].map(day => ({ ...day, ...roundMacros(day) }));
}

export function summarize(store: Store, range: DateRange) {
    const weights = store.weights(range);
    const readings = store.readings(range);
    const days = dailyTotals(store.foods(range));
    const first = weights[0];
    const last = weights.at(-1);
    const values = weights.map(w => w.weight);
    const bp = readings.filter(r => r.kind === 'blood_pressure');

    return {
        range,
        weight:
            first && last
                ? {
                      entries: weights.length,
                      start: first,
                      latest: last,
                      change: round(last.weight - first.weight),
                      min: Math.min(...values),
                      max: Math.max(...values),
                      previousBeforeRange:
                          store.latestWeightBefore(range.from) ?? null
                  }
                : null,
        readings: {
            entries: readings.length,
            glucoseMgDl: stats(valuesOf(readings, 'glucose')),
            ketonesMmolL: stats(valuesOf(readings, 'ketones')),
            gki: stats([...gkiByKetoneId(readings).values()]),
            systolic: stats(bp.map(r => r.systolic)),
            diastolic: stats(bp.map(r => r.diastolic))
        },
        food: {
            daysLogged: days.length,
            averagePerLoggedDay: days.length
                ? roundMacros(averageMacros(days))
                : null
        }
    };
}

function valuesOf(readings: Reading[], kind: 'glucose' | 'ketones') {
    return readings.flatMap(r => (r.kind === kind ? [r.value] : []));
}

function stats(present: number[]) {
    if (!present.length) return null;
    return {
        count: present.length,
        avg: round(present.reduce((a, b) => a + b, 0) / present.length),
        min: Math.min(...present),
        max: Math.max(...present)
    };
}

function emptyMacros(): Macros {
    return { calories: 0, fat: 0, protein: 0, carbs: 0, fiber: 0, netCarbs: 0 };
}

function averageMacros(days: Macros[]): Macros {
    const total = emptyMacros();
    for (const day of days) {
        for (const key of Object.keys(total) as (keyof Macros)[]) {
            total[key] += day[key];
        }
    }
    for (const key of Object.keys(total) as (keyof Macros)[]) {
        total[key] /= days.length;
    }
    return total;
}

function roundMacros(m: Macros): Macros {
    return {
        calories: Math.round(m.calories),
        fat: round(m.fat),
        protein: round(m.protein),
        carbs: round(m.carbs),
        fiber: round(m.fiber),
        netCarbs: round(m.netCarbs)
    };
}

function round(n: number): number {
    return Math.round(n * 10) / 10;
}
