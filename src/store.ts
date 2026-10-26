import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type {
    DateRange,
    Reading,
    ReadingInput,
    Weight,
    WeightInput
} from './entries.js';
import { GOALS_SCHEMA, goalsStore } from './goals/store.js';
import { OAUTH_SCHEMA, oauthStore } from './oauth/store.js';

const BASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS weights (
    date TEXT PRIMARY KEY,
    weight REAL NOT NULL,
    note TEXT
);
`;

const READINGS_SCHEMA = `
CREATE TABLE readings (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('glucose', 'ketones', 'blood_pressure')),
    value REAL NOT NULL,
    diastolic INTEGER CHECK ((kind = 'blood_pressure') = (diastolic IS NOT NULL)),
    note TEXT
);
CREATE INDEX readings_date ON readings (date, time);
`;

// Index i upgrades a database from user_version i to i + 1.
const MIGRATIONS: ((db: DatabaseSync) => void)[] = [
    db => {
        db.exec(BASE_SCHEMA);
        const legacy = db
            .prepare(
                "SELECT 1 FROM pragma_table_info('readings') WHERE name = 'glucose'"
            )
            .get();
        if (!legacy) {
            db.exec(READINGS_SCHEMA);
            return;
        }
        // 0.1.0 stored glucose, ketones, blood pressure and pulse in one row.
        // Split each measurement into its own row; pulse is dropped.
        db.exec(`
            ALTER TABLE readings RENAME TO readings_v0;
            DROP INDEX IF EXISTS readings_date;
            ${READINGS_SCHEMA}
            INSERT INTO readings (date, time, kind, value, diastolic, note)
            SELECT date, time, kind, value, diastolic, note FROM (
                SELECT id, date, time, 'glucose' AS kind, glucose AS value,
                       NULL AS diastolic, note, 0 AS ord
                FROM readings_v0 WHERE glucose IS NOT NULL
                UNION ALL
                SELECT id, date, time, 'ketones', ketones, NULL, note, 1
                FROM readings_v0 WHERE ketones IS NOT NULL
                UNION ALL
                SELECT id, date, time, 'blood_pressure', systolic, diastolic, note, 2
                FROM readings_v0
                WHERE systolic IS NOT NULL AND diastolic IS NOT NULL
            ) ORDER BY id, ord;
            DROP TABLE readings_v0;
        `);
    },
    db => db.exec(OAUTH_SCHEMA),
    db => db.exec(GOALS_SCHEMA)
];

type ReadingRow = {
    id: number;
    date: string;
    time: string;
    kind: Reading['kind'];
    value: number;
    diastolic: number | null;
    note: string | null;
};

function toReading({ kind, value, diastolic, ...rest }: ReadingRow): Reading {
    return kind === 'blood_pressure'
        ? { ...rest, kind, systolic: value, diastolic: diastolic ?? 0 }
        : { ...rest, kind, value };
}

function migrate(db: DatabaseSync) {
    const { user_version: version } = db
        .prepare('PRAGMA user_version')
        .get() as { user_version: number };
    for (let v = version; v < MIGRATIONS.length; v++) {
        db.exec('BEGIN');
        try {
            MIGRATIONS[v]?.(db);
            db.exec(`PRAGMA user_version = ${v + 1}`);
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    }
}

export type Store = ReturnType<typeof openStore>;

export function openStore(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    migrate(db);

    const all = <T>(sql: string, ...params: SQLInputValue[]) =>
        db.prepare(sql).all(...params) as T[];
    const run = (sql: string, ...params: SQLInputValue[]) =>
        db.prepare(sql).run(...params);
    const nullable = (value: string | number | undefined) => value ?? null;

    return {
        oauth: oauthStore(db),
        goals: goalsStore(db),

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
            const bp = input.kind === 'blood_pressure';
            return Number(
                run(
                    `INSERT INTO readings (date, time, kind, value, diastolic, note)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    input.date,
                    input.time,
                    input.kind,
                    bp ? input.systolic : input.value,
                    bp ? input.diastolic : null,
                    nullable(input.note)
                ).lastInsertRowid
            );
        },
        deleteReading(id: number) {
            run('DELETE FROM readings WHERE id = ?', id);
        },
        readings(range: DateRange): Reading[] {
            return all<ReadingRow>(
                `SELECT * FROM readings WHERE date BETWEEN ? AND ?
                 ORDER BY date, time, id`,
                range.from,
                range.to
            ).map(toReading);
        },

        close() {
            db.close();
        }
    };
}
