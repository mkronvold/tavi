import type { Priority, ProjectStatus, TaskStatus } from '@tavi/schemas';

type WorkspaceExampleParticipant = {
  id: string;
  name: string;
  email: string;
};

export type WorkspaceExampleTask = {
  assigneeUserId: string;
  dueDate: Date | null;
  notes: string | null;
  priority: Priority;
  status: TaskStatus;
  title: string;
};

export type WorkspaceExampleProject = {
  dueDate: Date | null;
  manualStatus: ProjectStatus | null;
  notes: string | null;
  ownerUserId: string;
  priority: Priority;
  tasks: WorkspaceExampleTask[];
  title: string;
  trackerLink: string | null;
};

const buildDueDate = (
  baseDate: Date,
  offsetDays: number | null,
): Date | null => {
  if (offsetDays === null) {
    return null;
  }

  const dueDate = new Date(baseDate);
  dueDate.setUTCDate(dueDate.getUTCDate() + offsetDays);
  return dueDate;
};

export const buildWorkspaceResetExamples = (
  participants: WorkspaceExampleParticipant[],
): WorkspaceExampleProject[] => {
  const baseDate = new Date();
  baseDate.setUTCHours(12, 0, 0, 0);

  const participantAt = (index: number) =>
    participants[index % participants.length] ?? participants[0];

  return [
    {
      title: 'Roadmap refresh',
      notes:
        'Manual status stays blocked until finance approves the sequence.\n\nSummary: Align the next quarter roadmap with the release review.',
      trackerLink: 'https://tracker.example.com/projects/roadmap-refresh',
      ownerUserId: participantAt(0).id,
      dueDate: buildDueDate(baseDate, 10),
      priority: 'high',
      manualStatus: 'blocked',
      tasks: [
        {
          title: 'Confirm kickoff notes',
          notes:
            'Shared owners, decisions, and review window with stakeholders.',
          assigneeUserId: participantAt(0).id,
          dueDate: buildDueDate(baseDate, -1),
          priority: 'medium',
          status: 'done',
        },
        {
          title: 'Validate milestone sequencing',
          notes: 'Waiting on launch-date updates from partner teams.',
          assigneeUserId: participantAt(1).id,
          dueDate: buildDueDate(baseDate, 3),
          priority: 'high',
          status: 'in_progress',
        },
        {
          title: 'Share review deck',
          notes: 'Add updated numbers before circulating the final deck.',
          assigneeUserId: participantAt(2).id,
          dueDate: buildDueDate(baseDate, 6),
          priority: 'medium',
          status: 'todo',
        },
      ],
    },
    {
      title: 'Kubernetes production rollout',
      notes:
        'Coordinate the cutover window with platform and support teams.\n\nSummary: Prepare the production deployment cutover and rollback plan.',
      trackerLink: 'https://tracker.example.com/projects/k8s-rollout',
      ownerUserId: participantAt(1).id,
      dueDate: buildDueDate(baseDate, 14),
      priority: 'high',
      manualStatus: null,
      tasks: [
        {
          title: 'Reserve change window',
          notes:
            'Blocked: platform team has not confirmed the maintenance slot.',
          assigneeUserId: participantAt(1).id,
          dueDate: buildDueDate(baseDate, 2),
          priority: 'high',
          status: 'blocked',
        },
        {
          title: 'Dry run deployment',
          notes: 'Repeat the dry run with the release candidate image tags.',
          assigneeUserId: participantAt(2).id,
          dueDate: buildDueDate(baseDate, 5),
          priority: 'high',
          status: 'todo',
        },
        {
          title: 'Update rollback runbook',
          notes: 'Reviewed the runbook updates with SRE coverage owners.',
          assigneeUserId: participantAt(0).id,
          dueDate: buildDueDate(baseDate, -2),
          priority: 'medium',
          status: 'done',
        },
      ],
    },
    {
      title: 'Accessibility polish',
      notes:
        'Good candidate for a short design and frontend pairing session.\n\nSummary: Close the remaining accessibility issues in the dense workspace.',
      trackerLink: 'https://tracker.example.com/projects/accessibility-polish',
      ownerUserId: participantAt(2).id,
      dueDate: buildDueDate(baseDate, 9),
      priority: 'medium',
      manualStatus: null,
      tasks: [
        {
          title: 'Audit contrast fixes',
          notes:
            'Recheck charts, badges, and status chips against the palette.',
          assigneeUserId: participantAt(2).id,
          dueDate: buildDueDate(baseDate, 4),
          priority: 'medium',
          status: 'todo',
        },
        {
          title: 'Keyboard flow pass',
          notes:
            'Cover import/export, settings, and project rollup interactions.',
          assigneeUserId: participantAt(0).id,
          dueDate: buildDueDate(baseDate, 6),
          priority: 'medium',
          status: 'todo',
        },
      ],
    },
    {
      title: 'Loop migration cleanup',
      notes:
        'A completed example project for the default workspace view.\n\nSummary: Finish the post-migration cleanup tasks after the import rollout.',
      trackerLink:
        'https://tracker.example.com/projects/loop-migration-cleanup',
      ownerUserId: participantAt(0).id,
      dueDate: buildDueDate(baseDate, 1),
      priority: 'low',
      manualStatus: null,
      tasks: [
        {
          title: 'Archive redundant Loop views',
          notes: 'Confirmed the old views are no longer used by the team.',
          assigneeUserId: participantAt(0).id,
          dueDate: buildDueDate(baseDate, -3),
          priority: 'low',
          status: 'done',
        },
        {
          title: 'Verify import mappings',
          notes: 'Checklist splitting and assignee matching validated cleanly.',
          assigneeUserId: participantAt(1).id,
          dueDate: buildDueDate(baseDate, -1),
          priority: 'medium',
          status: 'done',
        },
        {
          title: 'Retire backup export job',
          notes: 'Canceled because the backup export job is no longer needed.',
          assigneeUserId: participantAt(2).id,
          dueDate: null,
          priority: 'low',
          status: 'canceled',
        },
      ],
    },
  ];
};
