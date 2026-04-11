import {
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
  createSavedViewSchema,
  renameSavedViewSchema,
  updateSavedViewSchema,
} from '@tavi/schemas';
import type { AuthenticatedRequest } from './auth.types';
import { SessionGuard } from './session.guard';
import { parseInput } from './validation';
import { SavedViewsService } from './saved-views.service';

@Controller('views')
@UseGuards(SessionGuard)
export class ViewsController {
  constructor(private readonly savedViewsService: SavedViewsService) {}

  @Get()
  listSavedViews(@Req() request: AuthenticatedRequest) {
    return this.savedViewsService.listSavedViews(request.user!);
  }

  @Post()
  createSavedView(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const input = parseInput(createSavedViewSchema, body);
    return this.savedViewsService.createSavedView(input, request.user!);
  }

  @Patch(':viewId')
  updateSavedView(
    @Param('viewId') viewId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parseInput(updateSavedViewSchema, body);
    return this.savedViewsService.updateSavedView(viewId, input, request.user!);
  }

  @Patch(':viewId/name')
  renameSavedView(
    @Param('viewId') viewId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parseInput(renameSavedViewSchema, body);
    return this.savedViewsService.renameSavedView(viewId, input, request.user!);
  }

  @Delete(':viewId')
  deleteSavedView(
    @Param('viewId') viewId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.savedViewsService.deleteSavedView(viewId, request.user!);
  }
}
