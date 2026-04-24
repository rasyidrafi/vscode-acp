import type { ReactElement } from 'react';

import type { ActivePlan } from '../../src/shared/chatModel';

interface ActivePlanPanelProps {
  plan: ActivePlan;
}

export function ActivePlanPanel({ plan }: ActivePlanPanelProps): ReactElement {
  const completedCount = plan.entries.filter((entry) => entry.status === 'completed').length;
  const totalCount = plan.entries.length;
  const inProgress = plan.entries.find((entry) => entry.status === 'inProgress');

  return (
    <section className="active-plan-panel" aria-label="Active plan">
      <div className="active-plan-header">
        <div>
          <span className="active-plan-kicker">Current Plan</span>
          <strong>{completedCount}/{totalCount} complete</strong>
        </div>
        {inProgress ? <span className="active-plan-pill">Working on: {inProgress.text}</span> : null}
      </div>
      {plan.explanation ? <p className="active-plan-explanation">{plan.explanation}</p> : null}
      <div className="active-plan-list">
        {plan.entries.map((entry, index) => (
          <div key={entry.id} className={`active-plan-entry ${entry.status}`}>
            <span className="active-plan-index" aria-hidden="true">{index + 1}</span>
            <span className="active-plan-text">{entry.text}</span>
            <span className="active-plan-status">
              {entry.status === 'completed' ? 'Done' : entry.status === 'inProgress' ? 'In Progress' : 'Pending'}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
