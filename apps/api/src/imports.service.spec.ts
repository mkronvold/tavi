import { BadRequestException } from '@nestjs/common';

type MockLoopImportPreview = {
  blockingMissingUserRowCount: number;
  invalidRowCount: number;
  missingUserRowCount: number;
  missingUsers: unknown[];
  missingTaskAssigneeRowCount: number;
  missingTaskAssignees: unknown[];
  missingRequiredMappings: string[];
  overlappingProjectRowCount: number;
  overlappingTaskRowCount: number;
  projectSourceIdRowCount: number;
  rows: unknown[];
  taskSourceIdRowCount: number;
  totalRowCount: number;
  validRowCount: number;
  warningRowCount: number;
};

const createMockPreview = (
  overrides: Partial<MockLoopImportPreview> = {},
): MockLoopImportPreview => ({
  blockingMissingUserRowCount: 0,
  invalidRowCount: 0,
  missingUserRowCount: 0,
  missingUsers: [],
  missingTaskAssigneeRowCount: 0,
  missingTaskAssignees: [],
  missingRequiredMappings: [],
  overlappingProjectRowCount: 0,
  overlappingTaskRowCount: 0,
  projectSourceIdRowCount: 0,
  rows: [],
  taskSourceIdRowCount: 0,
  totalRowCount: 1,
  validRowCount: 1,
  warningRowCount: 0,
  ...overrides,
});

const createMockPreviewRow = (overrides: Record<string, unknown> = {}) => ({
  errors: [],
  project: {
    dueDate: null,
    externalId: null,
    notes: null,
    ownerUserId: 'user-1',
    priority: 'medium',
    title: 'Loop migration',
  },
  projectOverlap: null,
  rawRow: {},
  rowNumber: 1,
  task: {
    assigneeUserId: 'user-1',
    dueDate: null,
    externalId: null,
    notes: null,
    priority: 'medium',
    status: 'todo',
    title: 'Confirm mapping',
  },
  taskOverlap: null,
  warnings: [],
  ...overrides,
});

const toMockMapping = (value: unknown) => {
  const mapping: Record<string, string | null | undefined> = {};

  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return mapping;
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string' || entry === null || entry === undefined) {
      mapping[key] = entry;
    }
  }

  return mapping;
};

const mockBuildLoopImportPreview = jest.fn(
  (): MockLoopImportPreview => createMockPreview(),
);
const mockLoopImportMappingSafeParse = jest.fn(
  (
    value: unknown,
  ): { success: true; data: Record<string, string | null | undefined> } => ({
    success: true,
    data: toMockMapping(value),
  }),
);
const normalizeImportKey = (value: string | null | undefined) =>
  (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

jest.mock('@tavi/schemas', () => ({
  buildLoopImportPreview: mockBuildLoopImportPreview,
  buildPreparedLoopImportProjectKey: (row: {
    project: {
      dueDate?: string | null;
      ownerUserId?: string | null;
      title?: string | null;
    };
  }) =>
    [
      'natural',
      normalizeImportKey(row.project.title),
      row.project.ownerUserId ?? '',
      row.project.dueDate ?? '',
    ].join(':'),
  buildPreparedLoopImportTaskKey: (
    projectId: string,
    row: {
      task: {
        assigneeUserId?: string | null;
        dueDate?: string | null;
        title?: string | null;
      };
    },
  ) =>
    [
      'natural',
      projectId,
      normalizeImportKey(row.task.title),
      row.task.assigneeUserId ?? '',
      row.task.dueDate ?? '',
    ].join(':'),
  hasPreparedLoopImportTask: (task: {
    externalId?: string | null;
    title?: string | null;
  }) => Boolean(task.externalId || task.title),
  expandLoopImportRows: ({
    mapping,
    rawRows,
  }: {
    mapping: Record<string, string | null | undefined>;
    rawRows: Array<Record<string, unknown>>;
  }) => {
    const taskTitleHeader = mapping.taskTitle;

    if (!taskTitleHeader) {
      return rawRows;
    }

    return rawRows.flatMap((rawRow) => {
      const taskTitle = rawRow[taskTitleHeader];

      if (typeof taskTitle !== 'string' || !taskTitle.includes('\n')) {
        return [rawRow];
      }

      return taskTitle
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .map((entry) => ({
          ...rawRow,
          [taskTitleHeader]: entry,
          ...(mapping.taskExternalId ? { [mapping.taskExternalId]: null } : {}),
        }));
    });
  },
  loopImportFieldDefinitions: [],
  loopImportMappingSchema: {
    safeParse: mockLoopImportMappingSafeParse,
  },
}));

import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import { ImportsService } from './imports.service';
import { PrismaService } from './prisma.service';

describe('ImportsService', () => {
  type UpdateImportJobCall = {
    data: Record<string, unknown>;
    where: { id: string };
  };
  type UpdateManyImportRowsCall = {
    data: Record<string, unknown>;
    where: { importId: string };
  };

  const actor: SessionUser = {
    id: 'user-1',
    email: 'admin@tavi.local',
    name: 'Tavi Admin',
    role: 'admin',
  };

  type LoopImportDetail = Awaited<ReturnType<ImportsService['getLoopImport']>>;

  const createService = () => {
    const createImportJobMock = jest.fn();
    const deleteImportJobMock = jest.fn();
    const findUniqueImportJobMock = jest.fn();
    const updateImportJobMock: jest.MockedFunction<
      (args: UpdateImportJobCall) => Promise<unknown>
    > = jest.fn();
    const findManyImportRowsMock = jest.fn();
    const deleteManyImportRowsMock = jest.fn();
    const createManyImportRowsMock = jest.fn();
    const updateManyImportRowsMock: jest.MockedFunction<
      (args: UpdateManyImportRowsCall) => Promise<unknown>
    > = jest.fn();
    const findManyUsersMock = jest.fn();
    const findManyProjectsMock = jest.fn().mockResolvedValue([]);
    const findManyTasksMock = jest.fn().mockResolvedValue([]);
    const requireAdminAccessMock = jest.fn();
    const prisma = {
      importJob: {
        create: createImportJobMock,
        delete: deleteImportJobMock,
        findUnique: findUniqueImportJobMock,
        update: updateImportJobMock,
      },
      importRow: {
        createMany: createManyImportRowsMock,
        deleteMany: deleteManyImportRowsMock,
        findMany: findManyImportRowsMock,
        updateMany: updateManyImportRowsMock,
      },
      user: {
        findMany: findManyUsersMock,
      },
      project: {
        findMany: findManyProjectsMock,
      },
      task: {
        findMany: findManyTasksMock,
      },
    } as unknown as PrismaService;
    const transactionMock = jest.fn((input: unknown) =>
      typeof input === 'function'
        ? Promise.resolve(
            (input as (tx: PrismaService) => void | Promise<unknown>)(prisma),
          )
        : Promise.resolve(input),
    );
    Object.assign(prisma, { $transaction: transactionMock });
    const authService = {
      requireAdminAccess: requireAdminAccessMock,
    } as unknown as AuthService;

    return {
      mocks: {
        createManyImportRowsMock,
        createImportJobMock,
        deleteImportJobMock,
        deleteManyImportRowsMock,
        findManyImportRowsMock,
        findManyProjectsMock,
        findManyTasksMock,
        findManyUsersMock,
        findUniqueImportJobMock,
        requireAdminAccessMock,
        transactionMock,
        updateImportJobMock,
        updateManyImportRowsMock,
      },
      service: new ImportsService(prisma, authService),
    };
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    mockBuildLoopImportPreview
      .mockReset()
      .mockImplementation(createMockPreview);
    mockLoopImportMappingSafeParse
      .mockReset()
      .mockImplementation((value: unknown) => ({
        success: true,
        data: toMockMapping(value),
      }));
  });

  it('rejects whitespace-only Loop CSV uploads', async () => {
    const { mocks, service } = createService();

    await expect(
      service.createLoopImport(
        {
          content: ' \n\t ',
          fileName: 'loop.csv',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(mocks.requireAdminAccessMock).toHaveBeenCalledWith(actor);
    expect(mocks.createImportJobMock).not.toHaveBeenCalled();
  });

  it('removes imports by deleting the import job and cascading rows', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueImportJobMock.mockResolvedValue({
      id: 'import-1',
    });
    mocks.deleteImportJobMock.mockResolvedValue({
      id: 'import-1',
    });

    const result = await service.removeLoopImport('import-1', actor);

    expect(mocks.requireAdminAccessMock).toHaveBeenCalledWith(actor);
    expect(mocks.findUniqueImportJobMock).toHaveBeenCalledWith({
      where: { id: 'import-1' },
      select: { id: true },
    });
    expect(mocks.deleteImportJobMock).toHaveBeenCalledWith({
      where: {
        id: 'import-1',
      },
    });
    expect(result).toEqual({ id: 'import-1' });
  });

  it('rejects removing an import that does not exist', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueImportJobMock.mockResolvedValue(null);

    await expect(service.removeLoopImport('import-1', actor)).rejects.toThrow(
      'Import not found',
    );
  });

  it('rejects mapping updates that reference headers outside the staged import', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueImportJobMock.mockResolvedValue({
      headers: ['Project Title', 'Task Title'],
      id: 'import-1',
      status: 'awaiting_review',
    });

    await expect(
      service.updateLoopImportMapping(
        'import-1',
        {
          mapping: {
            projectTitle: 'Missing Header',
            taskTitle: 'Task Title',
          },
        },
        actor,
      ),
    ).rejects.toThrow(
      'Mapped headers are not present in the staged import: Missing Header',
    );

    expect(mocks.updateImportJobMock).not.toHaveBeenCalled();
  });

  it('restages checklist rows when mapping updates', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueImportJobMock.mockResolvedValue({
      headers: ['Project Title', 'Checklist Item'],
      id: 'import-1',
      sourceContent:
        'Project Title,Checklist Item\nLoop migration,"Confirm mapping\nShip docs"\n',
      status: 'awaiting_review',
    });
    jest.spyOn(service, 'getLoopImport').mockResolvedValue({
      id: 'import-1',
      status: 'awaiting_review',
    } as LoopImportDetail);

    const result = await service.updateLoopImportMapping(
      'import-1',
      {
        mapping: {
          projectTitle: 'Project Title',
          taskTitle: 'Checklist Item',
        },
      },
      actor,
    );

    expect(mocks.deleteManyImportRowsMock).toHaveBeenCalledWith({
      where: { importId: 'import-1' },
    });
    expect(mocks.createManyImportRowsMock).toHaveBeenCalledWith({
      data: [
        {
          importId: 'import-1',
          rawData: {
            'Checklist Item': 'Confirm mapping',
            'Project Title': 'Loop migration',
          },
          rowNumber: 1,
        },
        {
          importId: 'import-1',
          rawData: {
            'Checklist Item': 'Ship docs',
            'Project Title': 'Loop migration',
          },
          rowNumber: 2,
        },
      ],
    });
    expect(mocks.updateImportJobMock).toHaveBeenCalledWith({
      where: { id: 'import-1' },
      data: {
        mapping: {
          projectTitle: 'Project Title',
          taskTitle: 'Checklist Item',
        },
        totalRowCount: 2,
      },
    });
    expect(result).toEqual({ id: 'import-1', status: 'awaiting_review' });
  });

  it('rejects mapping updates until staged headers are available', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueImportJobMock.mockResolvedValue({
      headers: null,
      id: 'import-1',
      status: 'awaiting_review',
    });

    await expect(
      service.updateLoopImportMapping(
        'import-1',
        {
          mapping: {
            projectTitle: 'Project Title',
          },
        },
        actor,
      ),
    ).rejects.toThrow('Import headers are not available yet');

    expect(mocks.updateImportJobMock).not.toHaveBeenCalled();
  });

  it('blocks commits until the required import mappings are present', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueImportJobMock.mockResolvedValue({
      createdByUserId: actor.id,
      id: 'import-1',
      mapping: {
        taskTitle: 'Task Title',
      },
      status: 'awaiting_review',
    });
    mocks.findManyImportRowsMock.mockResolvedValue([
      {
        rawData: {
          'Task Title': 'Confirm mapping',
        },
        rowNumber: 1,
      },
    ]);
    mocks.findManyUsersMock.mockResolvedValue([
      {
        email: actor.email,
        id: actor.id,
        name: actor.name,
      },
    ]);
    mockBuildLoopImportPreview.mockReturnValue(
      createMockPreview({
        missingRequiredMappings: ['projectTitle'],
        validRowCount: 0,
      }),
    );

    await expect(
      service.queueLoopImportCommit('import-1', actor),
    ).rejects.toThrow('Map required fields before committing: projectTitle');

    expect(mocks.transactionMock).not.toHaveBeenCalled();
  });

  it('propagates project overlap decisions across rows in the same project', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueImportJobMock.mockResolvedValue({
      createdByUserId: actor.id,
      id: 'import-1',
      mapping: {
        projectTitle: 'Project Title',
        taskTitle: 'Task Title',
      },
      sourceSystem: 'loop',
      status: 'awaiting_review',
    });
    mocks.findManyImportRowsMock.mockResolvedValue([
      {
        projectOverlapAction: 'update',
        rawData: {
          'Project Title': 'Loop migration',
          'Task Title': 'Confirm mapping',
        },
        rowNumber: 1,
        taskOverlapAction: 'update',
      },
      {
        projectOverlapAction: 'update',
        rawData: {
          'Project Title': 'Loop migration',
          'Task Title': 'Ship docs',
        },
        rowNumber: 2,
        taskOverlapAction: 'update',
      },
    ]);
    mocks.findManyUsersMock.mockResolvedValue([
      {
        email: actor.email,
        id: actor.id,
        name: actor.name,
      },
    ]);
    mocks.findManyProjectsMock.mockResolvedValue([
      {
        dueDate: null,
        id: 'project-1',
        notes: null,
        ownerUserId: actor.id,
        priority: 'medium',
        sourceExternalId: null,
        title: 'Loop migration',
      },
    ]);
    mockBuildLoopImportPreview.mockReturnValue(
      createMockPreview({
        rows: [
          {
            errors: [],
            project: {
              dueDate: null,
              externalId: null,
              ownerUserId: actor.id,
              title: 'Loop migration',
            },
            rowNumber: 1,
            rawRow: {},
            task: {
              assigneeUserId: actor.id,
              dueDate: null,
              externalId: null,
              title: 'Confirm mapping',
            },
            taskOverlap: null,
            warnings: [],
          },
          {
            errors: [],
            project: {
              dueDate: null,
              externalId: null,
              ownerUserId: actor.id,
              title: 'Loop migration',
            },
            rowNumber: 2,
            rawRow: {},
            task: {
              assigneeUserId: actor.id,
              dueDate: null,
              externalId: null,
              title: 'Ship docs',
            },
            taskOverlap: null,
            warnings: [],
          },
        ],
      }),
    );
    jest.spyOn(service, 'getLoopImport').mockResolvedValue({
      id: 'import-1',
      status: 'awaiting_review',
    } as LoopImportDetail);

    const result = await service.updateLoopImportRowDecisions(
      'import-1',
      1,
      {
        projectAction: 'ignore',
      },
      actor,
    );

    expect(mocks.updateManyImportRowsMock).toHaveBeenCalledWith({
      where: {
        importId: 'import-1',
        rowNumber: {
          in: [1, 2],
        },
      },
      data: {
        projectOverlapAction: 'ignore',
      },
    });
    expect(result).toEqual({ id: 'import-1', status: 'awaiting_review' });
  });

  it('blocks commits when there are no staged rows left to import', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueImportJobMock.mockResolvedValue({
      createdByUserId: actor.id,
      id: 'import-1',
      mapping: {
        projectTitle: 'Project Title',
        taskTitle: 'Task Title',
      },
      status: 'awaiting_review',
    });
    mocks.findManyImportRowsMock.mockResolvedValue([]);
    mocks.findManyUsersMock.mockResolvedValue([]);

    await expect(
      service.queueLoopImportCommit('import-1', actor),
    ).rejects.toThrow('No staged rows are available to import');

    expect(mocks.transactionMock).not.toHaveBeenCalled();
  });

  it('blocks commits until blocking missing users are resolved', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueImportJobMock.mockResolvedValue({
      createdByUserId: actor.id,
      id: 'import-1',
      mapping: {
        projectTitle: 'Project Title',
        taskAssignee: 'Task Assignee',
        taskTitle: 'Task Title',
      },
      status: 'awaiting_review',
    });
    mocks.findManyImportRowsMock.mockResolvedValue([
      {
        rawData: {
          'Project Title': 'Loop migration',
          'Task Assignee': 'Jane Doe <jane@example.com>',
          'Task Title': 'Confirm mapping',
        },
        rowNumber: 1,
      },
    ]);
    mocks.findManyUsersMock.mockResolvedValue([
      {
        email: actor.email,
        id: actor.id,
        name: actor.name,
      },
    ]);
    mockBuildLoopImportPreview.mockReturnValue(
      createMockPreview({
        blockingMissingUserRowCount: 1,
        missingUserRowCount: 1,
        missingUsers: [
          {
            blocksCommit: true,
            canCreate: true,
            email: 'jane@example.com',
            label: 'Jane Doe <jane@example.com>',
            name: 'Jane Doe',
            rowCount: 1,
            rowNumbers: [1],
            sourceLabels: ['Task assignee'],
          },
        ],
        rows: [
          createMockPreviewRow({
            warnings: [
              'Task assignee "Jane Doe <jane@example.com>" did not match a known user. Create the account or update the import before committing.',
            ],
          }),
        ],
        validRowCount: 1,
        missingTaskAssigneeRowCount: 1,
        missingTaskAssignees: [
          {
            canCreate: true,
            email: 'jane@example.com',
            label: 'Jane Doe <jane@example.com>',
            name: 'Jane Doe',
            rowCount: 1,
            rowNumbers: [1],
          },
        ],
      }),
    );

    await expect(
      service.queueLoopImportCommit('import-1', actor),
    ).rejects.toThrow(
      'Resolve missing import users that block commit before committing. Create the missing accounts or update the import.',
    );

    expect(mocks.transactionMock).not.toHaveBeenCalled();
  });

  it('queues valid imports and clears stale row results before commit', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueImportJobMock.mockResolvedValue({
      createdByUserId: actor.id,
      id: 'import-1',
      mapping: {
        projectTitle: 'Project Title',
        taskTitle: 'Task Title',
      },
      status: 'awaiting_review',
    });
    mocks.findManyImportRowsMock.mockResolvedValue([
      {
        rawData: {
          'Project Title': 'Loop migration',
          'Task Title': 'Confirm mapping',
        },
        rowNumber: 1,
      },
    ]);
    mocks.findManyUsersMock.mockResolvedValue([
      {
        email: actor.email,
        id: actor.id,
        name: actor.name,
      },
    ]);
    mockBuildLoopImportPreview.mockReturnValue(
      createMockPreview({
        rows: [createMockPreviewRow()],
      }),
    );
    jest.spyOn(service, 'getLoopImport').mockResolvedValue({
      id: 'import-1',
      status: 'queued_commit',
    } as LoopImportDetail);

    const result = await service.queueLoopImportCommit('import-1', actor);

    const importJobResetCall = mocks.updateImportJobMock.mock.calls[0]?.[0];
    const importRowResetCall =
      mocks.updateManyImportRowsMock.mock.calls[0]?.[0];

    expect(importJobResetCall).toMatchObject({
      where: { id: 'import-1' },
      data: {
        completedAt: null,
        createdProjectCount: 0,
        createdRowCount: 0,
        createdTaskCount: 0,
        failedRowCount: 0,
        lastError: null,
        skippedRowCount: 0,
        status: 'queued_commit',
        updatedProjectCount: 0,
        updatedRowCount: 0,
        updatedTaskCount: 0,
      },
    });
    expect(importRowResetCall.where).toEqual({ importId: 'import-1' });
    expect(importRowResetCall.data).toMatchObject({
      message: null,
      projectId: null,
      projectOutcome: 'pending',
      rowOutcome: 'pending',
      taskId: null,
      taskOutcome: 'pending',
    });
    expect(importRowResetCall.data['validationErrors']).toBeDefined();
    expect(mocks.transactionMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 'import-1', status: 'queued_commit' });
  });
});
