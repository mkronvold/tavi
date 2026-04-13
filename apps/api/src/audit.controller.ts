import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  auditChangesQuerySchema,
  auditHistoryParamsSchema,
  auditHistoryQuerySchema,
  auditLoginsQuerySchema,
  purgeAuditLogsSchema,
  setAuditLogRetentionSchema,
} from '@tavi/schemas';
import type { AuthenticatedRequest } from './auth.types';
import { AuditService } from './audit.service';
import { SessionGuard } from './session.guard';
import { parseInput } from './validation';

@Controller('audit')
@UseGuards(SessionGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('changes')
  listAuditChanges(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.auditService.listAuditChanges(
      parseInput(auditChangesQuerySchema, query),
      request.user!,
    );
  }

  @Get('retention')
  getAuditLogRetention(@Req() request: AuthenticatedRequest) {
    return this.auditService.getAuditLogRetentionPolicy(request.user!);
  }

  @Put('retention')
  setAuditLogRetention(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.auditService.setAuditLogRetentionPolicy(
      parseInput(setAuditLogRetentionSchema, body),
      request.user!,
    );
  }

  @Post('purge')
  purgeAuditLogs(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.auditService.purgeAuditLogs(
      parseInput(purgeAuditLogsSchema, body),
      request.user!,
    );
  }

  @Get('logins')
  listAuditLogins(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.auditService.listAuditLogins(
      parseInput(auditLoginsQuerySchema, query),
      request.user!,
    );
  }

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
