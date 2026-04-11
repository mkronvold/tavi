import { BadRequestException } from '@nestjs/common';

type MockLoopImportPreview = {
  invalidRowCount: number;
  missingRequiredMappings: string[];
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
  invalidRowCount: 0,
  missingRequiredMappings: [],
  projectSourceIdRowCount: 0,
  rows: [],
  taskSourceIdRowCount: 0,
  totalRowCount: 1,
  validRowCount: 1,
  warningRowCount: 0,
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

jest.mock('@tavi/schemas', () => ({
  buildLoopImportPreview: mockBuildLoopImportPreview,
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
    const findUniqueImportJobMock = jest.fn();
    const updateImportJobMock: jest.MockedFunction<
      (args: UpdateImportJobCall) => Promise<unknown>
    > = jest.fn();
    const findManyImportRowsMock = jest.fn();
    const updateManyImportRowsMock: jest.MockedFunction<
      (args: UpdateManyImportRowsCall) => Promise<unknown>
    > = jest.fn();
    const findManyUsersMock = jest.fn();
    const transactionMock = jest.fn((operations: unknown[]) =>
      Promise.resolve(operations),
    );
    const requireAdminAccessMock = jest.fn();
    const prisma = {
      importJob: {
        create: createImportJobMock,
        findUnique: findUniqueImportJobMock,
        update: updateImportJobMock,
      },
      importRow: {
        findMany: findManyImportRowsMock,
        updateMany: updateManyImportRowsMock,
      },
      user: {
        findMany: findManyUsersMock,
      },
      $transaction: transactionMock,
    } as unknown as PrismaService;
    const authService = {
      requireAdminAccess: requireAdminAccessMock,
    } as unknown as AuthService;

    return {
      mocks: {
        createImportJobMock,
        findManyImportRowsMock,
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
    mockBuildLoopImportPreview.mockReturnValue(createMockPreview());
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
