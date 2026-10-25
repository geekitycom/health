import { YES_NO, type Goal, type GoalAnswer } from '../goals/model.js';

const LABELS: Record<string, string> = { yes: 'Yes', no: 'No' };

export function GoalsSection(props: {
    date: string;
    goals: Goal[];
    answers: GoalAnswer[];
}) {
    if (!props.goals.length) return null;
    const answerFor = new Map(props.answers.map(a => [a.goalId, a]));
    const done = props.goals.filter(g => answerFor.has(g.id)).length;

    return (
        <section id="goals">
            <h2>
                Goals{' '}
                <span class="muted">
                    {done}/{props.goals.length}
                </span>
            </h2>
            <ul class="goals">
                {props.goals.map(goal => (
                    <GoalItem
                        date={props.date}
                        goal={goal}
                        answer={answerFor.get(goal.id)}
                    />
                ))}
            </ul>
        </section>
    );
}

function GoalItem(props: {
    date: string;
    goal: Goal;
    answer: GoalAnswer | undefined;
}) {
    const { goal, answer } = props;
    const action = `/goals/${goal.id}/answer`;
    const hidden = <input type="hidden" name="date" value={props.date} />;

    return (
        <li>
            <div class="goal-prompt">
                {goal.prompt}
                {answer && (
                    <span class="muted"> · answered {answer.answeredAt}</span>
                )}
            </div>
            {goal.kind === 'text' ? (
                <form method="post" action={action} class="goal-text">
                    {hidden}
                    <input
                        name="value"
                        value={answer?.value ?? ''}
                        aria-label={goal.prompt}
                    />
                    <button type="submit">Save</button>
                </form>
            ) : (
                <form method="post" action={action} class="goal-choices">
                    {hidden}
                    {(goal.kind === 'yes_no' ? YES_NO : goal.options).map(
                        option => (
                            <button
                                type="submit"
                                name="value"
                                value={option}
                                class="choice"
                                aria-pressed={
                                    answer?.value === option ? 'true' : 'false'
                                }
                            >
                                {LABELS[option] ?? option}
                            </button>
                        )
                    )}
                    {answer && (
                        <button
                            type="submit"
                            name="value"
                            value=""
                            class="link"
                        >
                            clear
                        </button>
                    )}
                </form>
            )}
        </li>
    );
}
