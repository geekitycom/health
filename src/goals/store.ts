import type { DatabaseSync } from 'node:sqlite';
import type { DateRange } from '../entries.js';
import type { Goal, GoalAnswer, GoalInput } from './model.js';

export const GOALS_SCHEMA = `
CREATE TABLE goals (
    id INTEGER PRIMARY KEY,
    prompt TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('yes_no', 'choice', 'text')),
    options TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT,
    CHECK ((kind = 'choice') = (options IS NOT NULL))
);
CREATE TABLE goal_answers (
    goal_id INTEGER NOT NULL REFERENCES goals (id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    value TEXT NOT NULL,
    answered_at TEXT NOT NULL,
    PRIMARY KEY (goal_id, date)
);
`;

type GoalRow = {
    id: number;
    prompt: string;
    kind: Goal['kind'];
    options: string | null;
    start_date: string;
    end_date: string | null;
};

function toGoal(row: GoalRow): Goal {
    const base = {
        id: row.id,
        prompt: row.prompt,
        startDate: row.start_date,
        endDate: row.end_date
    };
    return row.kind === 'choice'
        ? {
              ...base,
              kind: 'choice',
              options: JSON.parse(row.options ?? '[]') as string[]
          }
        : { ...base, kind: row.kind };
}

export type GoalsStore = ReturnType<typeof goalsStore>;

export function goalsStore(db: DatabaseSync) {
    const goals = (sql: string, ...params: string[]) =>
        (db.prepare(sql).all(...params) as GoalRow[]).map(toGoal);
    const goal = (id: number): Goal | undefined =>
        goals('SELECT * FROM goals WHERE id = ?', String(id))[0];

    return {
        addGoal(input: GoalInput & { startDate: string }): Goal {
            const row = db
                .prepare(
                    `INSERT INTO goals (prompt, kind, options, start_date)
                     VALUES (?, ?, ?, ?) RETURNING *`
                )
                .get(
                    input.prompt,
                    input.kind,
                    input.kind === 'choice'
                        ? JSON.stringify(input.options)
                        : null,
                    input.startDate
                ) as GoalRow;
            return toGoal(row);
        },

        goal,

        /** Stops asking from `date` on. Keeps the goal and its answers. */
        endGoal(id: number, date: string): Goal | undefined {
            db.prepare(
                'UPDATE goals SET end_date = ? WHERE id = ? AND end_date IS NULL'
            ).run(date, id);
            return goal(id);
        },

        allGoals(): Goal[] {
            return goals('SELECT * FROM goals ORDER BY id');
        },

        /** Goals active at any point in the range, plus any answered in it. */
        goalsInRange(range: DateRange): Goal[] {
            return goals(
                `SELECT * FROM goals
                 WHERE (start_date <= ? AND (end_date IS NULL OR end_date > ?))
                    OR id IN (SELECT goal_id FROM goal_answers
                              WHERE date BETWEEN ? AND ?)
                 ORDER BY id`,
                range.to,
                range.from,
                range.from,
                range.to
            );
        },

        answers(range: DateRange): GoalAnswer[] {
            return (
                db
                    .prepare(
                        `SELECT goal_id, date, value, answered_at FROM goal_answers
                         WHERE date BETWEEN ? AND ? ORDER BY date, goal_id`
                    )
                    .all(range.from, range.to) as {
                    goal_id: number;
                    date: string;
                    value: string;
                    answered_at: string;
                }[]
            ).map(r => ({
                goalId: r.goal_id,
                date: r.date,
                value: r.value,
                answeredAt: r.answered_at
            }));
        },

        setAnswer(answer: GoalAnswer) {
            db.prepare(
                `INSERT INTO goal_answers (goal_id, date, value, answered_at)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT (goal_id, date) DO UPDATE
                 SET value = excluded.value, answered_at = excluded.answered_at`
            ).run(answer.goalId, answer.date, answer.value, answer.answeredAt);
        },

        clearAnswer(goalId: number, date: string) {
            db.prepare(
                'DELETE FROM goal_answers WHERE goal_id = ? AND date = ?'
            ).run(goalId, date);
        }
    };
}
