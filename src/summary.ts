import type { DateRange, Reading } from './entries.js';
import { goalStats } from './goals/report.js';
import type { Store } from './store.js';

const GLUCOSE_MG_DL_PER_MMOL_L = 18.016;
const GKI_PAIR_MINUTES = 30;

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

export function summarize(store: Store, range: DateRange) {
    const weights = store.weights(range);
    const readings = store.readings(range);
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
        goals: goalStats(
            store.goals.goalsInRange(range),
            store.goals.answers(range),
            range
        )
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

function round(n: number): number {
    return Math.round(n * 10) / 10;
}
