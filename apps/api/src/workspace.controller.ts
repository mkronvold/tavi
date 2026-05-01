import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { resetWorkspaceExamplesSchema } from '@tavi/schemas';
import type { AuthenticatedRequest } from './auth.types';
import { SessionGuard } from './session.guard';
import { parseInput } from './validation';
import { WorkspaceService } from './workspace.service';

@Controller('workspace')
@UseGuards(SessionGuard)
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get()
  getWorkspace(@Req() request: AuthenticatedRequest) {
    return this.workspaceService.getWorkspace(request.user!);
  }

  @Post('projects/:projectId/viewed')
  markProjectViewed(
    @Param('projectId') projectId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workspaceService.markProjectViewed(projectId, request.user!);
  }

  @Post('projects/viewed')
  markAllProjectsViewed(@Req() request: AuthenticatedRequest) {
    return this.workspaceService.markAllProjectsViewed(request.user!);
  }

  @Post('reset-examples')
  resetExamples(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const input = parseInput(resetWorkspaceExamplesSchema, body);
    return this.workspaceService.resetWorkspaceExamples(input, request.user!);
  }
}
