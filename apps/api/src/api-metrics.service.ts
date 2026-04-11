import { Injectable } from '@nestjs/common';
import client from 'prom-client';

const REQUEST_DURATION_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

@Injectable()
export class ApiMetricsService {
  private readonly registry = new client.Registry();

  private readonly activeRequests = new client.Gauge({
    help: 'HTTP requests currently being handled by the Tavi API.',
    name: 'tavi_api_http_requests_in_flight',
    registers: [this.registry],
  });

  private readonly requestDurationSeconds = new client.Histogram({
    buckets: REQUEST_DURATION_BUCKETS,
    help: 'Request latency for the Tavi API.',
    labelNames: ['method', 'route', 'status_code'] as const,
    name: 'tavi_api_http_request_duration_seconds',
    registers: [this.registry],
  });

  private readonly requestsTotal = new client.Counter({
    help: 'Total HTTP requests handled by the Tavi API.',
    labelNames: ['method', 'route', 'status_code'] as const,
    name: 'tavi_api_http_requests_total',
    registers: [this.registry],
  });

  constructor() {
    client.collectDefaultMetrics({
      prefix: 'tavi_api_',
      register: this.registry,
    });
  }

  incrementActiveRequests() {
    this.activeRequests.inc();
  }

  decrementActiveRequests() {
    this.activeRequests.dec();
  }

  recordRequest(input: {
    durationMs: number;
    method: string;
    route: string;
    statusCode: number;
  }) {
    const labels = {
      method: input.method.toUpperCase(),
      route: input.route,
      status_code: input.statusCode.toString(),
    };

    this.requestsTotal.inc(labels);
    this.requestDurationSeconds.observe(labels, input.durationMs / 1000);
  }

  get contentType() {
    return this.registry.contentType;
  }

  async snapshot() {
    return this.registry.metrics();
  }
}
