import type { DateRange } from './entries.js';

export type LocalNow = { date: string; time: string };

export function localNow(now: Date, timeZone: string): LocalNow {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        })
            .formatToParts(now)
            .map(p => [p.type, p.value])
    );
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        time: `${parts.hour}:${parts.minute}`
    };
}

export function addDays(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

export function lastDays(today: string, days: number): DateRange {
    return { from: addDays(today, 1 - days), to: today };
}

export function isValidDate(date: string): boolean {
    return (
        /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        new Date(`${date}T00:00:00Z`).toISOString().startsWith(date)
    );
}
