import { z } from 'zod';
import { localDate } from '../entries.js';

export const GOAL_KINDS = ['yes_no', 'choice', 'text'] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

export const YES_NO = ['yes', 'no'] as const;

const prompt = z.string().trim().min(1).max(300);
const startDate = localDate.optional();

export const goalInput = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('yes_no'), prompt, startDate }),
    z.object({
        kind: z.literal('choice'),
        prompt,
        startDate,
        options: z
            .array(z.string().trim().min(1).max(100))
            .min(2)
            .max(10)
            .refine(o => new Set(o).size === o.length, {
                message: 'options must be unique'
            })
    }),
    z.object({ kind: z.literal('text'), prompt, startDate })
]);
export type GoalInput = z.infer<typeof goalInput>;

export type Goal = {
    id: number;
    prompt: string;
    startDate: string;
    /** First day the goal is no longer asked; null while active. */
    endDate: string | null;
} & (
    | { kind: 'yes_no' }
    | { kind: 'choice'; options: string[] }
    | { kind: 'text' }
);

export type GoalAnswer = {
    goalId: number;
    date: string;
    value: string;
    answeredAt: string;
};

export function isActiveOn(goal: Goal, date: string): boolean {
    return (
        goal.startDate <= date && (goal.endDate === null || date < goal.endDate)
    );
}

/** The stored form of an answer, or undefined when it does not fit the goal. */
export function parseAnswer(goal: Goal, raw: string): string | undefined {
    const value = raw.trim();
    switch (goal.kind) {
        case 'yes_no':
            return (YES_NO as readonly string[]).includes(value)
                ? value
                : undefined;
        case 'choice':
            return goal.options.includes(value) ? value : undefined;
        case 'text':
            return value && value.length <= 2000 ? value : undefined;
    }
}
