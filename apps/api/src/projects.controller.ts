import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { createProjectSchema, updateProjectSchema } from '@tavi/schemas';
import type { AuthenticatedRequest } from './auth.types';
import { ProjectsService } from './projects.service';
import { SessionGuard } from './session.guard';
import { parseInput } from './validation';

@Controller('projects')
@UseGuards(SessionGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  createProject(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const input = parseInput(createProjectSchema, body);
    return this.projectsService.createProject(input, request.user!);
  }

  @Patch(':projectId')
  updateProject(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parseInput(updateProjectSchema, body);
    return this.projectsService.updateProject(projectId, input, request.user!);
  }
}
