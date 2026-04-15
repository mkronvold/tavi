import { Module } from '@nestjs/common';
import { ApiMetricsService } from './api-metrics.service';
import { AppLogger } from './app-logger';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailService } from './email.service';
import { HealthController } from './health.controller';
import { ImportsController } from './imports.controller';
import { MetricsController } from './metrics.controller';
import { ImportsService } from './imports.service';
import { NotificationEventsService } from './notification-events.service';
import { LocalAccountsController } from './local-accounts.controller';
import { LocalAccountsService } from './local-accounts.service';
import { PrismaService } from './prisma.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { SessionGuard } from './session.guard';
import { SavedViewsService } from './saved-views.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { ViewsController } from './views.controller';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';

@Module({
  imports: [],
  controllers: [
    AuditController,
    AuthController,
    HealthController,
    ImportsController,
    LocalAccountsController,
    MetricsController,
    ProjectsController,
    TasksController,
    ViewsController,
    WorkspaceController,
  ],
  providers: [
    ApiMetricsService,
    AppLogger,
    AuditService,
    AuthService,
    EmailService,
    PrismaService,
    ImportsService,
    LocalAccountsService,
    NotificationEventsService,
    ProjectsService,
    SavedViewsService,
    SessionGuard,
    TasksService,
    WorkspaceService,
  ],
})
export class AppModule {}
