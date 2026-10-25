import { z } from 'zod';

export const localDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
export const localTime = z.string().regex(/^\d{2}:\d{2}$/, 'expected HH:MM');

const positive = z.number().positive();
const nonNegative = z.number().nonnegative();
const note = z.string().trim().max(1000).optional();

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type Meal = (typeof MEALS)[number];

export const weightInput = z.object({
    date: localDate,
    weight: positive.max(2000),
    note
});
export type WeightInput = z.infer<typeof weightInput>;

export const readingInput = z
    .object({
        date: localDate,
        time: localTime,
        glucose: positive.max(1000).optional(),
        ketones: nonNegative.max(20).optional(),
        systolic: z.int().positive().max(300).optional(),
        diastolic: z.int().positive().max(200).optional(),
        pulse: z.int().positive().max(300).optional(),
        note
    })
    .refine(r => (r.systolic === undefined) === (r.diastolic === undefined), {
        message: 'blood pressure needs both systolic and diastolic'
    })
    .refine(
        r =>
            r.glucose !== undefined ||
            r.ketones !== undefined ||
            r.systolic !== undefined ||
            r.pulse !== undefined,
        { message: 'enter at least one measurement' }
    );
export type ReadingInput = z.infer<typeof readingInput>;

export const foodInput = z.object({
    date: localDate,
    time: localTime,
    meal: z.enum(MEALS),
    description: z.string().trim().min(1).max(500),
    calories: nonNegative.max(20000).optional(),
    fat: nonNegative.max(2000).optional(),
    protein: nonNegative.max(2000).optional(),
    carbs: nonNegative.max(2000).optional(),
    fiber: nonNegative.max(2000).optional(),
    note
});
export type FoodInput = z.infer<typeof foodInput>;

export type Weight = {
    date: string;
    weight: number;
    note: string | null;
};

export type Reading = {
    id: number;
    date: string;
    time: string;
    glucose: number | null;
    ketones: number | null;
    systolic: number | null;
    diastolic: number | null;
    pulse: number | null;
    note: string | null;
};

export type Food = {
    id: number;
    date: string;
    time: string;
    meal: Meal;
    description: string;
    calories: number | null;
    fat: number | null;
    protein: number | null;
    carbs: number | null;
    fiber: number | null;
    note: string | null;
};

export type DateRange = { from: string; to: string };
