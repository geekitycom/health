import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DateRange } from '../entries.js';
import { localDate } from '../entries.js';
import type { GoalsStore } from './store.js';
import { GOAL_KINDS, goalInput } from './model.js';
import { goalLog } from './report.js';

export type GoalToolDeps = {
    goals: GoalsStore;
    today(): string;
    resolve(args: {
        from?: string | undefined;
        to?: string | undefined;
        days?: number | undefined;
    }): DateRange;
    rangeArgs: z.ZodRawShape;
};

const json = (data: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }]
});
const error = (text: string) => ({
    content: [{ type: 'text' as const, text }],
    isError: true
});

export function registerGoalTools(server: McpServer, deps: GoalToolDeps) {
    const { goals } = deps;

    server.registerTool(
        'list_goals',
        {
            title: 'List daily goals',
            description:
                'Daily goals the user is asked about on their day page. Ended goals are hidden unless include_ended is true.',
            inputSchema: {
                include_ended: z.boolean().optional()
            },
            annotations: { readOnlyHint: true, openWorldHint: false }
        },
        ({ include_ended }) => {
            const today = deps.today();
            return json({
                goals: goals
                    .allGoals()
                    .filter(
                        g =>
                            include_ended ||
                            g.endDate === null ||
                            g.endDate > today
                    )
            });
        }
    );

    server.registerTool(
        'create_goal',
        {
            title: 'Create a daily goal',
            description: [
                'Add a question the user answers once per day on their day page, for example "Ate chia pudding first, made tomorrow\'s".',
                'kind "yes_no" gives Yes/No buttons, "choice" gives one button per entry in options (2 to 10), "text" gives a free-text box.',
                'Starts today unless start_date is given. Goals cannot be edited: end the old one and create a new one instead.'
            ].join(' '),
            inputSchema: {
                prompt: z
                    .string()
                    .describe('The question or goal shown to the user.'),
                kind: z.enum(GOAL_KINDS),
                options: z
                    .array(z.string())
                    .optional()
                    .describe('Required for kind "choice"; ignored otherwise.'),
                start_date: localDate
                    .optional()
                    .describe(
                        'First day to ask (YYYY-MM-DD). Defaults to today.'
                    )
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false
            }
        },
        args => {
            const parsed = goalInput.safeParse({
                kind: args.kind,
                prompt: args.prompt,
                startDate: args.start_date,
                ...(args.kind === 'choice' && { options: args.options })
            });
            if (!parsed.success) {
                return error(
                    parsed.error.issues
                        .map(i => `${i.path.join('.') || 'goal'}: ${i.message}`)
                        .join('; ')
                );
            }
            return json({
                goal: goals.addGoal({
                    ...parsed.data,
                    startDate: parsed.data.startDate ?? deps.today()
                })
            });
        }
    );

    server.registerTool(
        'end_goal',
        {
            title: 'End a daily goal',
            description:
                'Stop asking a goal starting today. The goal and its past answers are kept.',
            inputSchema: { id: z.int().positive() },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false
            }
        },
        ({ id }) => {
            const goal = goals.endGoal(id, deps.today());
            return goal ? json({ goal }) : error(`No goal with id ${id}.`);
        }
    );

    server.registerTool(
        'get_goal_answers',
        {
            title: 'Daily goal answers',
            description:
                'For each goal asked in a date range: its answers by date (with the local time answered) and the dates it was asked but left unanswered.',
            inputSchema: deps.rangeArgs,
            annotations: { readOnlyHint: true, openWorldHint: false }
        },
        args => {
            const range = deps.resolve(args);
            return json({
                range,
                goals: goalLog(
                    goals.goalsInRange(range),
                    goals.answers(range),
                    range
                )
            });
        }
    );
}
