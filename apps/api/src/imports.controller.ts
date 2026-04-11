import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  createLoopImportSchema,
  updateLoopImportMappingSchema,
} from '@tavi/schemas';
import type { AuthenticatedRequest } from './auth.types';
import { ImportsService } from './imports.service';
import { SessionGuard } from './session.guard';
import { parseInput } from './validation';

@Controller('imports')
@UseGuards(SessionGuard)
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Get()
  listImports(@Req() request: AuthenticatedRequest) {
    return this.importsService.listImports(request.user!);
  }

  @Post('loop')
  createLoopImport(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parseInput(createLoopImportSchema, body);
    return this.importsService.createLoopImport(input, request.user!);
  }

  @Get(':importId')
  getLoopImport(
    @Param('importId') importId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.importsService.getLoopImport(importId, request.user!);
  }

  @Patch(':importId/mapping')
  updateLoopImportMapping(
    @Param('importId') importId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parseInput(updateLoopImportMappingSchema, body);
    return this.importsService.updateLoopImportMapping(
      importId,
      input,
      request.user!,
    );
  }

  @Post(':importId/commit')
  queueLoopImportCommit(
    @Param('importId') importId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.importsService.queueLoopImportCommit(importId, request.user!);
  }
}
