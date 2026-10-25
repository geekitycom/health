import { addDays } from '../dates.js';
import type { DateRange } from '../entries.js';
import { isActiveOn, YES_NO, type Goal, type GoalAnswer } from './model.js';

export function datesIn(range: DateRange): string[] {
    const dates: string[] = [];
    for (let d = range.from; d <= range.to; d = addDays(d, 1)) dates.push(d);
    return dates;
}

/** Each goal with its answers in the range and the asked days left blank. */
export function goalLog(
    goals: Goal[],
    answers: GoalAnswer[],
    range: DateRange
) {
    const dates = datesIn(range);
    return goals.map(goal => {
        const own = answers.filter(a => a.goalId === goal.id);
        const answered = new Set(own.map(a => a.date));
        return {
            ...goal,
            answers: own.map(({ date, value, answeredAt }) => ({
                date,
                value,
                answeredAt
            })),
            unansweredDates: dates.filter(
                d => isActiveOn(goal, d) && !answered.has(d)
            )
        };
    });
}

/** Per-goal adherence counts for the summary. */
export function goalStats(
    goals: Goal[],
    answers: GoalAnswer[],
    range: DateRange
) {
    const dates = datesIn(range);
    return goals.map(goal => {
        const own = answers.filter(a => a.goalId === goal.id);
        const counts: Record<string, number> = {};
        if (goal.kind !== 'text') {
            const choices = goal.kind === 'yes_no' ? YES_NO : goal.options;
            for (const choice of choices) counts[choice] = 0;
            for (const a of own) counts[a.value] = (counts[a.value] ?? 0) + 1;
        }
        return {
            id: goal.id,
            prompt: goal.prompt,
            kind: goal.kind,
            daysAsked: dates.filter(d => isActiveOn(goal, d)).length,
            answered: own.length,
            ...(goal.kind !== 'text' && { counts })
        };
    });
}
