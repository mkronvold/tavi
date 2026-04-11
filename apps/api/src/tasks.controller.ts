import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  bulkArchiveTasksSchema,
  bulkUpdateTasksSchema,
  createTaskSchema,
  updateTaskSchema,
} from '@tavi/schemas';
import type { AuthenticatedRequest } from './auth.types';
import { SessionGuard } from './session.guard';
import { TasksService } from './tasks.service';
import { parseInput } from './validation';

@Controller()
@UseGuards(SessionGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post('projects/:projectId/tasks')
  createTask(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parseInput(createTaskSchema, {
      ...((body as Record<string, unknown>) ?? {}),
      projectId,
    });

    return this.tasksService.createTask(projectId, input, request.user!);
  }

  @Patch('tasks/bulk/archive')
  bulkArchiveTasks(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parseInput(bulkArchiveTasksSchema, body);
    return this.tasksService.bulkArchiveTasks(input, request.user!);
  }

  @Patch('tasks/bulk')
  bulkUpdateTasks(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const input = parseInput(bulkUpdateTasksSchema, body);
    return this.tasksService.bulkUpdateTasks(input, request.user!);
  }

  @Patch('tasks/:taskId')
  updateTask(
    @Param('taskId') taskId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parseInput(updateTaskSchema, body);
    return this.tasksService.updateTask(taskId, input, request.user!);
  }
}
