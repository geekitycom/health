import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type {
    DateRange,
    Food,
    FoodInput,
    Reading,
    ReadingInput,
    Weight,
    WeightInput
} from './entries.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS weights (
    date TEXT PRIMARY KEY,
    weight REAL NOT NULL,
    note TEXT
);
CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    glucose REAL,
    ketones REAL,
    systolic INTEGER,
    diastolic INTEGER,
    pulse INTEGER,
    note TEXT
);
CREATE INDEX IF NOT EXISTS readings_date ON readings (date, time);
CREATE TABLE IF NOT EXISTS foods (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    meal TEXT NOT NULL,
    description TEXT NOT NULL,
    calories REAL,
    fat REAL,
    protein REAL,
    carbs REAL,
    fiber REAL,
    note TEXT
);
CREATE INDEX IF NOT EXISTS foods_date ON foods (date, time);
`;

export type Store = ReturnType<typeof openStore>;

export function openStore(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec(SCHEMA);

    const all = <T>(sql: string, ...params: SQLInputValue[]) =>
        db.prepare(sql).all(...params) as T[];
    const run = (sql: string, ...params: SQLInputValue[]) =>
        db.prepare(sql).run(...params);
    const nullable = (value: string | number | undefined) => value ?? null;

    return {
        upsertWeight(input: WeightInput) {
            run(
                `INSERT INTO weights (date, weight, note) VALUES (?, ?, ?)
                 ON CONFLICT (date) DO UPDATE
                 SET weight = excluded.weight, note = excluded.note`,
                input.date,
                input.weight,
                nullable(input.note)
            );
        },
        deleteWeight(date: string) {
            run('DELETE FROM weights WHERE date = ?', date);
        },
        weights(range: DateRange): Weight[] {
            return all(
                'SELECT * FROM weights WHERE date BETWEEN ? AND ? ORDER BY date',
                range.from,
                range.to
            );
        },
        latestWeightBefore(date: string): Weight | undefined {
            return all<Weight>(
                'SELECT * FROM weights WHERE date < ? ORDER BY date DESC LIMIT 1',
                date
            )[0];
        },

        addReading(input: ReadingInput): number {
            return Number(
                run(
                    `INSERT INTO readings
                     (date, time, glucose, ketones, systolic, diastolic, pulse, note)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    input.date,
                    input.time,
                    nullable(input.glucose),
                    nullable(input.ketones),
                    nullable(input.systolic),
                    nullable(input.diastolic),
                    nullable(input.pulse),
                    nullable(input.note)
                ).lastInsertRowid
            );
        },
        deleteReading(id: number) {
            run('DELETE FROM readings WHERE id = ?', id);
        },
        readings(range: DateRange): Reading[] {
            return all(
                `SELECT * FROM readings WHERE date BETWEEN ? AND ?
                 ORDER BY date, time, id`,
                range.from,
                range.to
            );
        },

        addFood(input: FoodInput): number {
            return Number(
                run(
                    `INSERT INTO foods
                     (date, time, meal, description, calories, fat, protein, carbs, fiber, note)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    input.date,
                    input.time,
                    input.meal,
                    input.description,
                    nullable(input.calories),
                    nullable(input.fat),
                    nullable(input.protein),
                    nullable(input.carbs),
                    nullable(input.fiber),
                    nullable(input.note)
                ).lastInsertRowid
            );
        },
        deleteFood(id: number) {
            run('DELETE FROM foods WHERE id = ?', id);
        },
        foods(range: DateRange): Food[] {
            return all(
                `SELECT * FROM foods WHERE date BETWEEN ? AND ?
                 ORDER BY date, time, id`,
                range.from,
                range.to
            );
        },

        close() {
            db.close();
        }
    };
}
