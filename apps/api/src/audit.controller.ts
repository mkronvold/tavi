import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import {
  auditHistoryParamsSchema,
  auditHistoryQuerySchema,
} from '@tavi/schemas';
import type { AuthenticatedRequest } from './auth.types';
import { AuditService } from './audit.service';
import { SessionGuard } from './session.guard';
import { parseInput } from './validation';

@Controller('audit')
@UseGuards(SessionGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get(':entityType/:entityId')
  listAuditHistory(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const params = parseInput(auditHistoryParamsSchema, {
      entityType,
      entityId,
    });
    const { limit } = parseInput(auditHistoryQuerySchema, query);

    return this.auditService.listAuditHistory(
      params.entityType,
      params.entityId,
      limit,
      request.user!,
    );
  }
}
