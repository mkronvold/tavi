import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  pruneRetentionDataSchema,
  updateRetentionSettingsSchema,
} from '@tavi/schemas';
import type { AuthenticatedRequest } from './auth.types';
import { RetentionService } from './retention.service';
import { SessionGuard } from './session.guard';
import { parseInput } from './validation';

@Controller('retention')
@UseGuards(SessionGuard)
export class RetentionController {
  constructor(private readonly retentionService: RetentionService) {}

  @Get()
  getRetentionStatus(@Req() request: AuthenticatedRequest) {
    return this.retentionService.getRetentionStatus(request.user!);
  }

  @Put()
  updateRetentionSettings(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.retentionService.updateRetentionSettings(
      parseInput(updateRetentionSettingsSchema, body),
      request.user!,
    );
  }

  @Post('prune')
  pruneRetentionData(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.retentionService.pruneRetentionData(
      parseInput(pruneRetentionDataSchema, body),
      request.user!,
    );
  }
}
