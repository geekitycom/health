import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { WeightUnit } from './config.js';
import { lastDays } from './dates.js';
import { localDate, type DateRange } from './entries.js';
import type { Store } from './store.js';
import { dailyTotals, gkiByKetoneId, netCarbs, summarize } from './summary.js';

export type McpDeps = {
    store: Store;
    weightUnit: WeightUnit;
    today(): string;
};

const rangeArgs = {
    from: localDate
        .optional()
        .describe('First day to include (YYYY-MM-DD). Defaults from `days`.'),
    to: localDate
        .optional()
        .describe('Last day to include (YYYY-MM-DD). Defaults to today.'),
    days: z
        .int()
        .min(1)
        .max(366)
        .optional()
        .describe('Number of days ending at `to` when `from` is omitted.')
};

const DEFAULT_DAYS = 30;

export function createMcpServer(deps: McpDeps): McpServer {
    const { store } = deps;
    const server = new McpServer(
        { name: 'health', version: '0.1.0' },
        {
            instructions: [
                'Read-only access to a personal keto and weight-loss log.',
                `Weight is in ${deps.weightUnit}. Glucose is mg/dL, ketones are mmol/L, blood pressure is mmHg.`,
                'GKI is the glucose-ketone index (glucose mmol/L divided by ketones), paired from glucose and ketone readings taken within 30 minutes of each other.',
                'Food macros are grams; net carbs = carbs - fiber.',
                'Dates and times are local to the user.'
            ].join(' ')
        }
    );

    const resolve = (args: {
        from?: string | undefined;
        to?: string | undefined;
        days?: number | undefined;
    }): DateRange => {
        const to = args.to ?? deps.today();
        return args.from
            ? { from: args.from, to }
            : lastDays(to, args.days ?? DEFAULT_DAYS);
    };
    const json = (data: unknown) => ({
        content: [
            { type: 'text' as const, text: JSON.stringify(data, null, 2) }
        ]
    });
    const readOnly = { readOnlyHint: true, openWorldHint: false };

    server.registerTool(
        'get_summary',
        {
            title: 'Progress summary',
            description:
                'Weight trend, metric averages (glucose, ketones, GKI, blood pressure) and average daily macros over a date range. Start here.',
            inputSchema: rangeArgs,
            annotations: readOnly
        },
        args =>
            json({
                today: deps.today(),
                weightUnit: deps.weightUnit,
                ...summarize(store, resolve(args))
            })
    );

    server.registerTool(
        'get_weights',
        {
            title: 'Daily weights',
            description: `Daily weigh-ins (${deps.weightUnit}) in a date range, oldest first.`,
            inputSchema: rangeArgs,
            annotations: readOnly
        },
        args => {
            const range = resolve(args);
            return json({
                range,
                weightUnit: deps.weightUnit,
                weights: store.weights(range)
            });
        }
    );

    server.registerTool(
        'get_readings',
        {
            title: 'Metric readings',
            description:
                'Glucose (mg/dL), ketone (mmol/L) and blood pressure (mmHg) readings in a date range, oldest first. Each reading has a `kind`. Ketone readings include `gki` when a glucose reading was taken within 30 minutes, otherwise null.',
            inputSchema: rangeArgs,
            annotations: readOnly
        },
        args => {
            const range = resolve(args);
            const readings = store.readings(range);
            const gki = gkiByKetoneId(readings);
            return json({
                range,
                readings: readings.map(r =>
                    r.kind === 'ketones'
                        ? { ...r, gki: gki.get(r.id) ?? null }
                        : r
                )
            });
        }
    );

    server.registerTool(
        'get_food_log',
        {
            title: 'Food log',
            description:
                'Every logged food item with macros (grams) and per-day totals including net carbs, in a date range.',
            inputSchema: rangeArgs,
            annotations: readOnly
        },
        args => {
            const range = resolve(args);
            const foods = store.foods(range);
            return json({
                range,
                dailyTotals: dailyTotals(foods),
                items: foods.map(f => ({ ...f, netCarbs: netCarbs(f) }))
            });
        }
    );

    return server;
}
