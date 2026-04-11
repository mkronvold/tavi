import { Test, type TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ApiMetricsService } from '../src/api-metrics.service';
import { AppLogger } from '../src/app-logger';
import { HealthController } from '../src/health.controller';
import { MetricsController } from '../src/metrics.controller';
import { registerHttpObservability } from '../src/http-observability';

describe('Observability endpoints (e2e)', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [HealthController, MetricsController],
      providers: [ApiMetricsService, AppLogger],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api');
    registerHttpObservability(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/api/health (GET)', async () => {
    const response = await app.inject({
      headers: {
        'x-correlation-id': 'corr-123',
      },
      method: 'GET',
      url: '/api/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe('corr-123');
    expect(response.headers['x-correlation-id']).toBe('corr-123');
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('/api/metrics (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/metrics',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('tavi_api_http_requests_total');
  });
});
