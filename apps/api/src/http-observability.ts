import '@fastify/cookie';
import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ApiMetricsService } from './api-metrics.service';
import { AppLogger } from './app-logger';

const ignoredRoutes = new Set(['/api/health', '/api/metrics']);

type RequestObservability = {
  correlationId: string;
  error?: unknown;
  requestId: string;
  startedAt: bigint;
  statusCode?: number;
};

interface ObservabilityRequest {
  id: string;
  method: string;
  url: string;
  ip: string;
  headers: Record<string, string | string[] | undefined>;
  routeOptions?: { url?: string };
  user?: { id: string };
  observability?: RequestObservability;
}

export function registerHttpObservability(app: NestFastifyApplication) {
  const fastify = app.getHttpAdapter().getInstance();
  const logger = app.get(AppLogger);
  const metrics = app.get(ApiMetricsService);

  fastify.addHook('onRequest', (req, reply, done) => {
    const request = req as ObservabilityRequest;
    const correlationId = readHeaderValue(request.headers['x-correlation-id']);
    const requestId =
      correlationId ??
      readHeaderValue(request.headers['x-request-id']) ??
      request.id ??
      randomUUID();

    request.observability = {
      correlationId: correlationId ?? requestId,
      requestId,
      startedAt: process.hrtime.bigint(),
    };

    reply.header('x-request-id', requestId);
    reply.header('x-correlation-id', correlationId ?? requestId);
    metrics.incrementActiveRequests();
    done();
  });

  fastify.addHook('onError', (req, reply, error: Error, done) => {
    const request = req as ObservabilityRequest;
    if (request.observability) {
      request.observability.error = error;
      request.observability.statusCode =
        reply.statusCode >= 400 ? reply.statusCode : inferStatusCode(error);
    }

    done();
  });

  fastify.addHook('onResponse', (req, reply, done) => {
    const request = req as ObservabilityRequest;
    const route = normalizeRoute(request);
    const durationMs =
      Number(
        process.hrtime.bigint() -
          (request.observability?.startedAt ?? process.hrtime.bigint()),
      ) / 1_000_000;
    const statusCode =
      request.observability?.statusCode ?? reply.statusCode ?? 200;
    const fields = {
      correlationId: request.observability?.correlationId,
      durationMs: Number(durationMs.toFixed(2)),
      method: request.method,
      path: stripQuery(request.url),
      remoteAddress: request.ip,
      requestId: request.observability?.requestId,
      route,
      statusCode,
      userId: request.user?.id,
    };

    metrics.decrementActiveRequests();

    if (!ignoredRoutes.has(route)) {
      metrics.recordRequest({
        durationMs,
        method: request.method,
        route,
        statusCode,
      });
    }

    if (statusCode >= 500) {
      logger.error('http.request', {
        ...fields,
        err: request.observability?.error,
      });
      done();
      return;
    }

    if (statusCode >= 400) {
      logger.warn('http.request', {
        ...fields,
        err: request.observability?.error,
      });
      done();
      return;
    }

    if (ignoredRoutes.has(route)) {
      logger.debug('http.request', fields);
      done();
      return;
    }

    logger.log('http.request', fields);
    done();
  });
}

function inferStatusCode(
  error: Error & { status?: number; statusCode?: number },
) {
  return error.statusCode ?? error.status ?? 500;
}

function normalizeRoute(request: ObservabilityRequest) {
  const path = stripQuery(request.url);
  const route =
    typeof request.routeOptions?.url === 'string'
      ? request.routeOptions.url
      : path;

  if (!route.startsWith('/api') && path.startsWith('/api')) {
    return `/api${route.startsWith('/') ? '' : '/'}${route}`;
  }

  return route;
}

function readHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function stripQuery(url: string) {
  return url.split('?', 1)[0];
}
