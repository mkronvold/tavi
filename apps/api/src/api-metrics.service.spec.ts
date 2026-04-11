import { ApiMetricsService } from './api-metrics.service';

describe('ApiMetricsService', () => {
  it('records request counters and latency histograms', async () => {
    const metrics = new ApiMetricsService();

    metrics.recordRequest({
      durationMs: 125,
      method: 'get',
      route: '/api/projects/:projectId',
      statusCode: 200,
    });

    const snapshot = await metrics.snapshot();

    expect(snapshot).toContain('tavi_api_http_requests_total');
    expect(snapshot).toContain('tavi_api_http_request_duration_seconds_bucket');
    expect(snapshot).toContain('method="GET"');
    expect(snapshot).toContain('route="/api/projects/:projectId"');
    expect(snapshot).toContain('status_code="200"');
  });
});
