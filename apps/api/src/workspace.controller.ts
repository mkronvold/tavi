import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.types';
import { SessionGuard } from './session.guard';
import { WorkspaceService } from './workspace.service';

@Controller('workspace')
@UseGuards(SessionGuard)
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get()
  getWorkspace(@Req() request: AuthenticatedRequest) {
    return this.workspaceService.getWorkspace(request.user!);
  }
}
