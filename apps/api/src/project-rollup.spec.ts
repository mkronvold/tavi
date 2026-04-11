import { deriveProjectRollup } from './project-rollup';

describe('deriveProjectRollup', () => {
  it('marks a project blocked when any open task is blocked', () => {
    const rollup = deriveProjectRollup(
      [
        {
          archivedAt: null,
          dueDate: null,
          status: 'todo',
        },
        {
          archivedAt: null,
          dueDate: null,
          status: 'blocked',
        },
      ],
      null,
    );

    expect(rollup.derivedStatus).toBe('blocked');
    expect(rollup.taskBlockedCount).toBe(1);
  });

  it('respects a manual status override for the display status', () => {
    const rollup = deriveProjectRollup(
      [
        {
          archivedAt: null,
          dueDate: null,
          status: 'done',
        },
      ],
      'in_progress',
    );

    expect(rollup.derivedStatus).toBe('done');
    expect(rollup.displayStatus).toBe('in_progress');
  });
});
