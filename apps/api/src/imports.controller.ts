import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
  updateLoopImportRowDecisionsSchema,
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

  @Delete(':importId')
  cancelLoopImport(
    @Param('importId') importId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.importsService.cancelLoopImport(importId, request.user!);
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

  @Patch(':importId/rows/:rowNumber/decisions')
  updateLoopImportRowDecisions(
    @Param('importId') importId: string,
    @Param('rowNumber') rowNumber: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parseInput(updateLoopImportRowDecisionsSchema, body);
    const parsedRowNumber = Number.parseInt(rowNumber, 10);

    if (!Number.isInteger(parsedRowNumber) || parsedRowNumber < 1) {
      throw new BadRequestException('Row number must be a positive integer');
    }

    return this.importsService.updateLoopImportRowDecisions(
      importId,
      parsedRowNumber,
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
