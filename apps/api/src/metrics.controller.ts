import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiMetricsService } from './api-metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: ApiMetricsService) {}

  @Get()
  async getMetrics(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('cache-control', 'no-store');
    reply.header('content-type', this.metrics.contentType);

    return this.metrics.snapshot();
  }
}
