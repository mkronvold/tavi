import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  convertProjectToTaskSchema,
  createProjectSchema,
  updateProjectSchema,
} from '@tavi/schemas';
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

  @Post(':projectId/convert-to-task')
  convertProjectToTask(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parseInput(convertProjectToTaskSchema, body);
    return this.projectsService.convertProjectToTask(
      projectId,
      input,
      request.user!,
    );
  }

  @Delete(':projectId')
  deleteProject(
    @Param('projectId') projectId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.projectsService.deleteProject(projectId, request.user!);
  }
}
