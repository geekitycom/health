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

export const READING_KINDS = {
    glucose: { label: 'Glucose', unit: 'mg/dL' },
    ketones: { label: 'Ketones', unit: 'mmol/L' },
    blood_pressure: { label: 'Blood pressure', unit: 'mmHg' }
} as const;
export type ReadingKind = keyof typeof READING_KINDS;

const readingBase = { date: localDate, time: localTime, note };
const bloodPressure = z.int().positive().max(300);

export const readingInput = z.discriminatedUnion('kind', [
    z.object({
        ...readingBase,
        kind: z.literal('glucose'),
        value: positive.max(1000)
    }),
    z.object({
        ...readingBase,
        kind: z.literal('ketones'),
        value: nonNegative.max(20)
    }),
    z.object({
        ...readingBase,
        kind: z.literal('blood_pressure'),
        systolic: bloodPressure,
        diastolic: bloodPressure
    })
]);
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

export type ReadingValue =
    | { kind: 'glucose' | 'ketones'; value: number }
    | { kind: 'blood_pressure'; systolic: number; diastolic: number };

export type Reading = {
    id: number;
    date: string;
    time: string;
    note: string | null;
} & ReadingValue;

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
