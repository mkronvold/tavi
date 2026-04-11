import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateLoopImportInput,
  LoopImportMapping,
  LoopImportUser,
  UpdateLoopImportMappingInput,
} from '@tavi/schemas';
import {
  buildLoopImportPreview,
  loopImportFieldDefinitions,
  loopImportMappingSchema,
} from '@tavi/schemas';
import { Prisma } from '@prisma/client';
import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import { PrismaService } from './prisma.service';

type ImportJobRecord = {
  completedAt: Date | null;
  createdAt: Date;
  createdProjectCount: number;
  createdRowCount: number;
  createdTaskCount: number;
  createdByUserId: string;
  failedRowCount: number;
  fileName: string;
  headers: Prisma.JsonValue | null;
  id: string;
  lastError: string | null;
  mapping: Prisma.JsonValue | null;
  skippedRowCount: number;
  sourceSystem: string;
  status: string;
  suggestedMapping: Prisma.JsonValue | null;
  totalRowCount: number;
  updatedAt: Date;
  updatedProjectCount: number;
  updatedRowCount: number;
  updatedTaskCount: number;
};

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  async listImports(actor: SessionUser) {
    this.authService.requireAdminAccess(actor);

    const imports = await this.prisma.importJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: {
        createdBy: {
          select: {
            email: true,
            id: true,
            name: true,
          },
        },
      },
    });

    return imports.map((job) => ({
      ...serializeImportJob(job),
      createdBy: {
        email: job.createdBy.email,
        id: job.createdBy.id,
        name: job.createdBy.name,
      },
    }));
  }

  async createLoopImport(input: CreateLoopImportInput, actor: SessionUser) {
    this.authService.requireAdminAccess(actor);

    const content = input.content.trim();

    if (!content) {
      throw new BadRequestException('Import file content cannot be empty');
    }

    const job = await this.prisma.importJob.create({
      data: {
        createdByUserId: actor.id,
        fileName: input.fileName.trim(),
        sourceContent: input.content,
        sourceSystem: 'loop',
        status: 'queued_parse',
      },
    });

    return serializeImportJob(job);
  }

  async getLoopImport(importId: string, actor: SessionUser) {
    this.authService.requireAdminAccess(actor);

    const [job, stagedRows, resultRows, users] = await Promise.all([
      this.prisma.importJob.findUnique({
        where: { id: importId },
      }),
      this.prisma.importRow.findMany({
        where: { importId },
        orderBy: { rowNumber: 'asc' },
        select: {
          rawData: true,
          rowNumber: true,
        },
      }),
      this.prisma.importRow.findMany({
        where: {
          importId,
          rowOutcome: {
            not: 'pending',
          },
        },
        orderBy: { rowNumber: 'asc' },
        take: 25,
        select: {
          message: true,
          projectId: true,
          projectOutcome: true,
          rowNumber: true,
          rowOutcome: true,
          taskId: true,
          taskOutcome: true,
          validationErrors: true,
        },
      }),
      this.getImportUsers(),
    ]);

    if (!job) {
      throw new NotFoundException('Import not found');
    }

    const headers = readHeaderList(job.headers);
    const mapping = readLoopImportMapping(job.mapping);
    const suggestedMapping = readLoopImportMapping(job.suggestedMapping);
    const preview = buildLoopImportPreview({
      defaultUserId: job.createdByUserId,
      mapping,
      rawRows: stagedRows.map((row) => parseRawRow(row.rawData)),
      sampleSize: 25,
      users,
    });
    const mappedHeaders = new Set(
      Object.values(mapping).filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0,
      ),
    );

    return {
      ...serializeImportJob(job),
      fields: loopImportFieldDefinitions,
      headers,
      mapping,
      preview: {
        ...preview,
        rows: preview.rows.map((row) => ({
          errors: row.errors,
          projectExternalId: row.project.externalId,
          projectIdentityStrategy: row.project.identityStrategy,
          projectTitle: row.project.title,
          rowNumber: row.rowNumber,
          taskExternalId: row.task.externalId,
          taskIdentityStrategy: row.task.identityStrategy,
          taskStatus: row.task.status,
          taskTitle: row.task.title,
          warnings: row.warnings,
        })),
        unmappedHeaders: headers.filter((header) => !mappedHeaders.has(header)),
      },
      results: resultRows.map((row) => ({
        message: row.message,
        projectId: row.projectId,
        projectOutcome: row.projectOutcome,
        rowNumber: row.rowNumber,
        rowOutcome: row.rowOutcome,
        taskId: row.taskId,
        taskOutcome: row.taskOutcome,
        validationErrors: readValidationErrors(row.validationErrors),
      })),
      suggestedMapping,
    };
  }

  async updateLoopImportMapping(
    importId: string,
    input: UpdateLoopImportMappingInput,
    actor: SessionUser,
  ) {
    this.authService.requireAdminAccess(actor);

    const job = await this.prisma.importJob.findUnique({
      where: { id: importId },
      select: {
        headers: true,
        id: true,
        status: true,
      },
    });

    if (!job) {
      throw new NotFoundException('Import not found');
    }

    if (job.status !== 'awaiting_review') {
      throw new BadRequestException('Only staged imports can update mapping');
    }

    const headers = readHeaderList(job.headers);

    if (headers.length === 0) {
      throw new BadRequestException('Import headers are not available yet');
    }

    const unavailableHeaders = listUnavailableMappedHeaders(
      headers,
      input.mapping,
    );

    if (unavailableHeaders.length > 0) {
      throw new BadRequestException(
        `Mapped headers are not present in the staged import: ${unavailableHeaders.join(', ')}`,
      );
    }

    const mapping = sanitizeLoopImportMapping(headers, input.mapping);

    await this.prisma.importJob.update({
      where: { id: importId },
      data: {
        mapping: mapping as Prisma.InputJsonValue,
      },
    });

    return this.getLoopImport(importId, actor);
  }

  async queueLoopImportCommit(importId: string, actor: SessionUser) {
    this.authService.requireAdminAccess(actor);

    const [job, stagedRows, users] = await Promise.all([
      this.prisma.importJob.findUnique({
        where: { id: importId },
        select: {
          createdByUserId: true,
          id: true,
          mapping: true,
          status: true,
        },
      }),
      this.prisma.importRow.findMany({
        where: { importId },
        orderBy: { rowNumber: 'asc' },
        select: {
          rawData: true,
          rowNumber: true,
        },
      }),
      this.getImportUsers(),
    ]);

    if (!job) {
      throw new NotFoundException('Import not found');
    }

    if (job.status !== 'awaiting_review') {
      throw new BadRequestException('Only staged imports can be committed');
    }

    if (stagedRows.length === 0) {
      throw new BadRequestException('No staged rows are available to import');
    }

    const preview = buildLoopImportPreview({
      defaultUserId: job.createdByUserId,
      mapping: readLoopImportMapping(job.mapping),
      rawRows: stagedRows.map((row) => parseRawRow(row.rawData)),
      sampleSize: 0,
      users,
    });

    if (preview.missingRequiredMappings.length > 0) {
      throw new BadRequestException(
        `Map required fields before committing: ${preview.missingRequiredMappings.join(', ')}`,
      );
    }

    if (preview.validRowCount === 0) {
      throw new BadRequestException(
        'No valid rows remain after applying the current mapping',
      );
    }

    await this.prisma.$transaction([
      this.prisma.importJob.update({
        where: { id: importId },
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
      }),
      this.prisma.importRow.updateMany({
        where: { importId },
        data: {
          message: null,
          projectId: null,
          projectOutcome: 'pending',
          rowOutcome: 'pending',
          taskId: null,
          taskOutcome: 'pending',
          validationErrors: Prisma.DbNull,
        },
      }),
    ]);

    return this.getLoopImport(importId, actor);
  }

  private async getImportUsers(): Promise<LoopImportUser[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { name: 'asc' },
      select: {
        email: true,
        id: true,
        name: true,
      },
    });

    return users.map((user) => ({
      email: user.email,
      id: user.id,
      name: user.name,
    }));
  }
}

function readHeaderList(value: Prisma.JsonValue | null) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((header): header is string => typeof header === 'string');
}

function readLoopImportMapping(
  value: Prisma.JsonValue | null,
): LoopImportMapping {
  const result = loopImportMappingSchema.safeParse(
    normalizeLegacyLoopImportMapping(value),
  );
  return result.success ? stripUndefinedMappings(result.data) : {};
}

function sanitizeLoopImportMapping(
  headers: string[],
  mapping: LoopImportMapping,
): LoopImportMapping {
  const availableHeaders = new Set(headers);
  const sanitized: LoopImportMapping = {};

  for (const [field, value] of Object.entries(mapping)) {
    if (value === null) {
      sanitized[field as keyof LoopImportMapping] = null;
      continue;
    }

    if (typeof value === 'string' && availableHeaders.has(value)) {
      sanitized[field as keyof LoopImportMapping] = value;
    }
  }

  return sanitized;
}

function listUnavailableMappedHeaders(
  headers: string[],
  mapping: LoopImportMapping,
) {
  const availableHeaders = new Set(headers);

  return Object.values(mapping).filter(
    (value): value is string =>
      typeof value === 'string' &&
      value.length > 0 &&
      !availableHeaders.has(value),
  );
}

function parseRawRow(value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return {};
  }

  return value as Record<string, unknown>;
}

function readValidationErrors(value: Prisma.JsonValue | null) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

function serializeImportJob(job: ImportJobRecord) {
  return {
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    createdProjectCount: job.createdProjectCount,
    createdRowCount: job.createdRowCount,
    createdTaskCount: job.createdTaskCount,
    failedRowCount: job.failedRowCount,
    fileName: job.fileName,
    id: job.id,
    lastError: job.lastError,
    skippedRowCount: job.skippedRowCount,
    sourceSystem: job.sourceSystem,
    status: job.status,
    totalRowCount: job.totalRowCount,
    updatedAt: job.updatedAt,
    updatedProjectCount: job.updatedProjectCount,
    updatedRowCount: job.updatedRowCount,
    updatedTaskCount: job.updatedTaskCount,
  };
}

function stripUndefinedMappings(
  mapping: Record<string, string | null | undefined>,
) {
  return Object.fromEntries(
    Object.entries(mapping).filter(([, value]) => value !== undefined),
  ) as LoopImportMapping;
}

function normalizeLegacyLoopImportMapping(value: Prisma.JsonValue | null) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return {};
  }

  const mapping = { ...(value as Record<string, unknown>) };

  if (
    mapping['taskNotes'] === undefined &&
    typeof mapping['taskDescription'] === 'string'
  ) {
    mapping['taskNotes'] = mapping['taskDescription'];
  }

  return mapping;
}
