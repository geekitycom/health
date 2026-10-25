import type { DateRange, Food, Reading } from './entries.js';
import type { Store } from './store.js';

const GLUCOSE_MG_DL_PER_MMOL_L = 18.016;

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

export function gki(reading: Pick<Reading, 'glucose' | 'ketones'>) {
    if (reading.glucose === null || !reading.ketones) return null;
    return round(reading.glucose / GLUCOSE_MG_DL_PER_MMOL_L / reading.ketones);
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
    const bp = readings.filter(r => r.systolic !== null);

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
            glucoseMgDl: stats(readings.map(r => r.glucose)),
            ketonesMmolL: stats(readings.map(r => r.ketones)),
            gki: stats(readings.map(gki)),
            systolic: stats(bp.map(r => r.systolic)),
            diastolic: stats(bp.map(r => r.diastolic)),
            pulse: stats(readings.map(r => r.pulse))
        },
        food: {
            daysLogged: days.length,
            averagePerLoggedDay: days.length
                ? roundMacros(averageMacros(days))
                : null
        }
    };
}

function stats(values: (number | null)[]) {
    const present = values.filter((v): v is number => v !== null);
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
