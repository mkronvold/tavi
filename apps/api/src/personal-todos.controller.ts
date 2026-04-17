import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  createPersonalTodoSchema,
  importPersonalTodosSchema,
  reorderPersonalTodosSchema,
  updatePersonalTodoSchema,
} from "@tavi/schemas";
import type { AuthenticatedRequest } from "./auth.types";
import { PersonalTodosService } from "./personal-todos.service";
import { SessionGuard } from "./session.guard";
import { parseInput } from "./validation";

@Controller("personal-todos")
@UseGuards(SessionGuard)
export class PersonalTodosController {
  constructor(private readonly personalTodosService: PersonalTodosService) {}

  @Post()
  createPersonalTodo(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parseInput(createPersonalTodoSchema, body);
    return this.personalTodosService.createPersonalTodo(input, request.user!);
  }

  @Patch("reorder")
  reorderPersonalTodos(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parseInput(reorderPersonalTodosSchema, body);
    return this.personalTodosService.reorderPersonalTodos(input, request.user!);
  }

  @Post("import")
  importPersonalTodos(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parseInput(importPersonalTodosSchema, body);
    return this.personalTodosService.importPersonalTodos(input, request.user!);
  }

  @Patch(":todoId")
  updatePersonalTodo(
    @Param("todoId") todoId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parseInput(updatePersonalTodoSchema, body);
    return this.personalTodosService.updatePersonalTodo(todoId, input, request.user!);
  }

  @Delete(":todoId")
  deletePersonalTodo(
    @Param("todoId") todoId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.personalTodosService.deletePersonalTodo(todoId, request.user!);
  }
}
