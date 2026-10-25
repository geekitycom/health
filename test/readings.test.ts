import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { Reading } from '../src/entries.js';
import { openStore } from '../src/store.js';
import { gkiByKetoneId } from '../src/summary.js';

const base = { date: '2026-10-25', note: null };

describe('GKI pairing', () => {
    it('pairs each ketone reading with the nearest glucose within 30 minutes', () => {
        const readings: Reading[] = [
            { ...base, id: 1, time: '07:00', kind: 'glucose', value: 108 },
            { ...base, id: 2, time: '07:25', kind: 'glucose', value: 90 },
            { ...base, id: 3, time: '07:30', kind: 'ketones', value: 1.5 },
            { ...base, id: 4, time: '12:00', kind: 'ketones', value: 2 }
        ];
        expect([...gkiByKetoneId(readings)]).toEqual([[3, 3.3]]);
    });

    it('does not pair readings from different days', () => {
        const readings: Reading[] = [
            { ...base, id: 1, time: '23:55', kind: 'glucose', value: 90 },
            {
                ...base,
                id: 2,
                date: '2026-10-26',
                time: '00:05',
                kind: 'ketones',
                value: 1.5
            }
        ];
        expect(gkiByKetoneId(readings).size).toBe(0);
    });
});

describe('0.1.0 database migration', () => {
    it('splits combined readings into one row per kind and keeps other data', () => {
        const path = `${process.env.TMPDIR ?? '/tmp'}/health-migrate-${process.pid}-${Date.now()}.db`;
        const legacy = new DatabaseSync(path);
        legacy.exec(`
            CREATE TABLE weights (date TEXT PRIMARY KEY, weight REAL NOT NULL, note TEXT);
            CREATE TABLE readings (
                id INTEGER PRIMARY KEY, date TEXT NOT NULL, time TEXT NOT NULL,
                glucose REAL, ketones REAL, systolic INTEGER, diastolic INTEGER,
                pulse INTEGER, note TEXT
            );
            CREATE INDEX readings_date ON readings (date, time);
            CREATE TABLE foods (
                id INTEGER PRIMARY KEY, date TEXT NOT NULL, time TEXT NOT NULL,
                meal TEXT NOT NULL, description TEXT NOT NULL, calories REAL,
                fat REAL, protein REAL, carbs REAL, fiber REAL, note TEXT
            );
            INSERT INTO weights VALUES ('2026-10-25', 218.6, NULL);
            INSERT INTO readings (date, time, glucose, ketones, systolic, diastolic, pulse, note)
            VALUES ('2026-10-25', '07:15', 88, 1.8, 118, 76, 62, 'fasted'),
                   ('2026-10-25', '20:00', NULL, NULL, NULL, NULL, 70, NULL);
        `);
        legacy.close();

        const store = openStore(path);
        const day = { from: '2026-10-25', to: '2026-10-25' };
        expect(store.weights(day)).toHaveLength(1);
        expect(store.readings(day).map(({ id: _id, ...r }) => r)).toEqual([
            {
                ...base,
                time: '07:15',
                kind: 'glucose',
                value: 88,
                note: 'fasted'
            },
            {
                ...base,
                time: '07:15',
                kind: 'ketones',
                value: 1.8,
                note: 'fasted'
            },
            {
                ...base,
                time: '07:15',
                kind: 'blood_pressure',
                systolic: 118,
                diastolic: 76,
                note: 'fasted'
            }
        ]);
        store.close();

        const reopened = openStore(path);
        expect(reopened.readings(day)).toHaveLength(3);
        reopened.close();
        for (const suffix of ['', '-wal', '-shm'])
            rmSync(path + suffix, { force: true });
    });
});
