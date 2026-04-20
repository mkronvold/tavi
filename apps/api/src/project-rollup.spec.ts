import { deriveProjectRollup } from './project-rollup';

describe('deriveProjectRollup', () => {
  it('marks a project blocked when all remaining tasks are blocked', () => {
    const rollup = deriveProjectRollup(
      [
        {
          archivedAt: null,
          dueDate: null,
          status: 'blocked',
        },
        {
          archivedAt: null,
          dueDate: null,
          status: 'blocked',
        },
        {
          archivedAt: null,
          dueDate: null,
          status: 'done',
        },
      ],
      null,
    );

    expect(rollup.derivedStatus).toBe('blocked');
    expect(rollup.taskBlockedCount).toBe(2);
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

  it('marks a project on hold when all remaining tasks are on hold', () => {
    const rollup = deriveProjectRollup(
      [
        {
          archivedAt: null,
          dueDate: new Date('2026-04-10T00:00:00.000Z'),
          status: 'on_hold',
        },
        {
          archivedAt: null,
          dueDate: null,
          status: 'done',
        },
      ],
      null,
    );

    expect(rollup.derivedStatus).toBe('on_hold');
    expect(rollup.taskOnHoldCount).toBe(1);
    expect(rollup.taskOverdueCount).toBe(0);
  });

  it('marks a project in progress when active tasks are mixed', () => {
    const rollup = deriveProjectRollup(
      [
        {
          archivedAt: null,
          dueDate: null,
          status: 'not_started',
        },
        {
          archivedAt: null,
          dueDate: null,
          status: 'on_hold',
        },
      ],
      null,
    );

    expect(rollup.derivedStatus).toBe('in_progress');
  });

  it('marks a project in progress when completed work remains alongside todo tasks', () => {
    const rollup = deriveProjectRollup(
      [
        {
          archivedAt: null,
          dueDate: null,
          status: 'done',
        },
        {
          archivedAt: null,
          dueDate: null,
          status: 'not_started',
        },
      ],
      null,
    );

    expect(rollup.derivedStatus).toBe('in_progress');
  });

  it('marks a project not started only when all non-canceled tasks are not started', () => {
    const rollup = deriveProjectRollup(
      [
        {
          archivedAt: null,
          dueDate: null,
          status: 'not_started',
        },
        {
          archivedAt: null,
          dueDate: null,
          status: 'canceled',
        },
      ],
      null,
    );

    expect(rollup.derivedStatus).toBe('not_started');
  });

  it('marks a project review when any actionable task is review', () => {
    const rollup = deriveProjectRollup(
      [
        {
          archivedAt: null,
          dueDate: null,
          status: 'review',
        },
        {
          archivedAt: null,
          dueDate: null,
          status: 'in_progress',
        },
      ],
      null,
    );

    expect(rollup.derivedStatus).toBe('review');
  });

  it('marks a project demo when no task is review and any actionable task is demo', () => {
    const rollup = deriveProjectRollup(
      [
        {
          archivedAt: null,
          dueDate: null,
          status: 'demo',
        },
        {
          archivedAt: null,
          dueDate: null,
          status: 'in_progress',
        },
      ],
      null,
    );

    expect(rollup.derivedStatus).toBe('demo');
  });
});
