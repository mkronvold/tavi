import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import { PrismaService } from './prisma.service';
import { ProjectsService } from './projects.service';

describe('ProjectsService', () => {
  type CreateProjectCall = {
    data: Record<string, unknown>;
  };

  type UpdateProjectCall = {
    data: Record<string, unknown>;
    where: { id: string };
  };

  const actor: SessionUser = {
    id: 'user-1',
    email: 'editor@tavi.local',
    name: 'Tavi Editor',
    role: 'editor',
  };

  const existingProject = {
    id: 'project-1',
    title: 'Roadmap refresh',
    summary: 'Validate overrides',
    notes: null,
    trackerLink: null,
    ownerUserId: 'user-1',
    dueDate: null,
    priority: 'medium',
    derivedStatus: 'in_progress',
    displayStatus: 'in_progress',
    manualStatus: null,
    archivedAt: null,
  };

  const createService = () => {
    const createProjectMock: jest.MockedFunction<
      (args: CreateProjectCall) => Promise<unknown>
    > = jest.fn();
    const findUniqueMock = jest.fn();
    const updateProjectMock: jest.MockedFunction<
      (args: UpdateProjectCall) => Promise<unknown>
    > = jest.fn();
    const requireEditAccessMock = jest.fn();
    const recordAuditCalls: Array<Parameters<AuthService['recordAudit']>> = [];
    const recordAuditMock = jest.fn(
      (...args: Parameters<AuthService['recordAudit']>) => {
        recordAuditCalls.push(args);
        return Promise.resolve();
      },
    );
    const prisma = {
      project: {
        create: createProjectMock,
        findUnique: findUniqueMock,
        update: updateProjectMock,
      },
    } as unknown as PrismaService;
    const authService = {
      requireEditAccess: requireEditAccessMock,
      recordAudit: recordAuditMock,
    } as unknown as AuthService;

    return {
      mocks: {
        createProjectMock,
        findUniqueMock,
        recordAuditCalls,
        recordAuditMock,
        requireEditAccessMock,
        updateProjectMock,
      },
      service: new ProjectsService(prisma, authService),
    };
  };

  it('creates projects with normalized tracker links and audit metadata', async () => {
    const { mocks, service } = createService();

    mocks.createProjectMock.mockResolvedValue({
      ...existingProject,
      trackerLink: 'https://tracker.example.com/projects/roadmap-refresh',
    });

    const result = await service.createProject(
      {
        title: 'Roadmap refresh',
        summary: 'Validate overrides',
        trackerLink: '  https://tracker.example.com/projects/roadmap-refresh  ',
        ownerUserId: 'user-1',
        priority: 'medium',
      },
      actor,
    );

    expect(mocks.requireEditAccessMock).toHaveBeenCalledWith(actor);
    expect(mocks.createProjectMock).toHaveBeenCalledWith({
      data: {
        title: 'Roadmap refresh',
        summary: 'Validate overrides',
        notes: null,
        trackerLink: 'https://tracker.example.com/projects/roadmap-refresh',
        ownerUserId: 'user-1',
        dueDate: null,
        priority: 'medium',
        derivedStatus: 'not_started',
        displayStatus: 'not_started',
      },
    });
    expect(mocks.recordAuditCalls[0]).toEqual([
      actor.id,
      'project',
      'project-1',
      'create',
      {
        title: 'Roadmap refresh',
        ownerUserId: 'user-1',
        priority: 'medium',
        dueDate: null,
        trackerLink: 'https://tracker.example.com/projects/roadmap-refresh',
      },
    ]);
    expect(result).toMatchObject({
      id: 'project-1',
      trackerLink: 'https://tracker.example.com/projects/roadmap-refresh',
    });
  });

  it('updates project notes without requiring a manual status change', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueMock.mockResolvedValue(existingProject);
    mocks.updateProjectMock.mockResolvedValue({
      ...existingProject,
      notes: 'Keep team aligned',
    });

    const result = await service.updateProject(
      'project-1',
      {
        notes: '  Keep team aligned  ',
      },
      actor,
    );

    expect(mocks.requireEditAccessMock).toHaveBeenCalledWith(actor);
    const updateCall = mocks.updateProjectMock.mock.calls[0]?.[0];

    expect(updateCall).toMatchObject({
      where: { id: 'project-1' },
      data: {
        notes: 'Keep team aligned',
      },
    });
    expect(mocks.recordAuditMock).toHaveBeenCalledTimes(1);
    expect(mocks.recordAuditCalls[0]).toEqual([
      actor.id,
      'project',
      'project-1',
      'update',
      {
        title: 'Roadmap refresh',
        summary: 'Validate overrides',
        ownerUserId: 'user-1',
        priority: 'medium',
        dueDate: null,
        trackerLink: null,
        changedFields: ['notes'],
      },
    ]);
    expect(result).toMatchObject({
      id: 'project-1',
      notes: 'Keep team aligned',
    });
  });

  it('updates tracker links as project metadata and allows clearing them', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueMock.mockResolvedValue({
      ...existingProject,
      trackerLink: 'https://tracker.example.com/projects/roadmap-refresh',
    });
    mocks.updateProjectMock.mockResolvedValue({
      ...existingProject,
      trackerLink: null,
    });

    const result = await service.updateProject(
      'project-1',
      {
        trackerLink: null,
      },
      actor,
    );

    const updateCall = mocks.updateProjectMock.mock.calls[0]?.[0];

    expect(updateCall).toMatchObject({
      where: { id: 'project-1' },
      data: {
        trackerLink: null,
      },
    });
    expect(mocks.recordAuditCalls[0]).toEqual([
      actor.id,
      'project',
      'project-1',
      'update',
      {
        title: 'Roadmap refresh',
        summary: 'Validate overrides',
        ownerUserId: 'user-1',
        priority: 'medium',
        dueDate: null,
        trackerLink: null,
        changedFields: ['trackerLink'],
      },
    ]);
    expect(result).toMatchObject({
      id: 'project-1',
      trackerLink: null,
    });
  });

  it('sets manual status overrides without requiring notes', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueMock.mockResolvedValue(existingProject);
    mocks.updateProjectMock.mockResolvedValue({
      ...existingProject,
      displayStatus: 'blocked',
      manualStatus: 'blocked',
    });

    const result = await service.updateProject(
      'project-1',
      {
        manualStatus: 'blocked',
      },
      actor,
    );

    expect(mocks.requireEditAccessMock).toHaveBeenCalledWith(actor);
    const updateCall = mocks.updateProjectMock.mock.calls[0]?.[0];

    expect(updateCall).toMatchObject({
      where: { id: 'project-1' },
      data: {
        displayStatus: 'blocked',
        manualStatus: 'blocked',
        notes: null,
      },
    });
    expect(mocks.recordAuditMock).toHaveBeenCalledTimes(1);
    expect(mocks.recordAuditCalls[0]).toEqual([
      actor.id,
      'project',
      'project-1',
      'status_override_set',
      {
        manualStatus: 'blocked',
        previousManualStatus: null,
        previousNotes: null,
        derivedStatus: 'in_progress',
      },
    ]);
    expect(result).toMatchObject({
      id: 'project-1',
      displayStatus: 'blocked',
      manualStatus: 'blocked',
      notes: null,
    });
  });

  it('records both metadata and override audit events when notes and status change together', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueMock.mockResolvedValue(existingProject);
    mocks.updateProjectMock.mockResolvedValue({
      ...existingProject,
      displayStatus: 'blocked',
      manualStatus: 'blocked',
      notes: 'Awaiting dependency',
      priority: 'high',
      title: 'Roadmap refresh v2',
    });

    await service.updateProject(
      'project-1',
      {
        title: 'Roadmap refresh v2',
        priority: 'high',
        manualStatus: 'blocked',
        notes: '  Awaiting dependency  ',
      },
      actor,
    );

    expect(mocks.recordAuditMock).toHaveBeenCalledTimes(2);
    expect(mocks.recordAuditCalls[0]).toEqual([
      actor.id,
      'project',
      'project-1',
      'update',
      {
        title: 'Roadmap refresh v2',
        summary: 'Validate overrides',
        ownerUserId: 'user-1',
        priority: 'high',
        dueDate: null,
        trackerLink: null,
        changedFields: ['title', 'notes', 'priority'],
      },
    ]);
    expect(mocks.recordAuditCalls[1]).toEqual([
      actor.id,
      'project',
      'project-1',
      'status_override_set',
      {
        manualStatus: 'blocked',
        notes: 'Awaiting dependency',
        previousManualStatus: null,
        previousNotes: null,
        derivedStatus: 'in_progress',
      },
    ]);
  });

  it('clears manual status overrides back to the derived status while preserving notes', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueMock.mockResolvedValue({
      ...existingProject,
      displayStatus: 'blocked',
      manualStatus: 'blocked',
      notes: 'Awaiting dependency',
    });
    mocks.updateProjectMock.mockResolvedValue({
      ...existingProject,
      displayStatus: 'in_progress',
      manualStatus: null,
      notes: 'Awaiting dependency',
    });

    const result = await service.updateProject(
      'project-1',
      {
        manualStatus: null,
      },
      actor,
    );

    const updateCall = mocks.updateProjectMock.mock.calls[0]?.[0];

    expect(updateCall).toMatchObject({
      where: { id: 'project-1' },
      data: {
        displayStatus: 'in_progress',
        manualStatus: null,
        notes: 'Awaiting dependency',
      },
    });
    expect(mocks.recordAuditCalls[0]).toEqual([
      actor.id,
      'project',
      'project-1',
      'status_override_clear',
      {
        previousManualStatus: 'blocked',
        previousNotes: 'Awaiting dependency',
        derivedStatus: 'in_progress',
        notes: 'Awaiting dependency',
      },
    ]);
    expect(result).toMatchObject({
      id: 'project-1',
      displayStatus: 'in_progress',
      manualStatus: null,
      notes: 'Awaiting dependency',
    });
  });
});
