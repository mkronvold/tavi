import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createStructuredLogger } from "@tavi/config/observability";
import client from "prom-client";

const JOB_DURATION_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];

export type WorkerJobResult = "completed" | "failed";

export type WorkerJobType =
  | "backup"
  | "commit"
  | "digest"
  | "notification"
  | "parse";

export class WorkerObservability {
  readonly logger = createStructuredLogger({ service: "worker" });

  private readonly registry = new client.Registry();

  private readonly activeJobs = new client.Gauge({
    help: "Background import jobs currently being processed by the Tavi worker.",
    labelNames: ["job_type"] as const,
    name: "tavi_worker_jobs_in_flight",
    registers: [this.registry],
  });

  private readonly jobsTotal = new client.Counter({
    help: "Background import jobs processed by the Tavi worker.",
    labelNames: ["job_type", "result"] as const,
    name: "tavi_worker_jobs_total",
    registers: [this.registry],
  });

  private readonly jobDurationSeconds = new client.Histogram({
    buckets: JOB_DURATION_BUCKETS,
    help: "Duration of background import jobs handled by the Tavi worker.",
    labelNames: ["job_type", "result"] as const,
    name: "tavi_worker_job_duration_seconds",
    registers: [this.registry],
  });

  private readonly importRowFailuresTotal = new client.Counter({
    help: "Import rows marked as failed by the Tavi worker.",
    name: "tavi_worker_import_row_failures_total",
    registers: [this.registry],
  });

  private readonly lastJobCompletionTimestampSeconds = new client.Gauge({
    help: "Unix timestamp of the last completed or failed worker job.",
    labelNames: ["job_type", "result"] as const,
    name: "tavi_worker_last_job_completion_timestamp_seconds",
    registers: [this.registry],
  });

  private readonly ready = new client.Gauge({
    help: "Worker readiness state.",
    name: "tavi_worker_ready",
    registers: [this.registry],
  });

  private readonly up = new client.Gauge({
    help: "Worker process availability.",
    name: "tavi_worker_up",
    registers: [this.registry],
  });

  private readonly state = {
    lastJobCompletedAt: undefined as string | undefined,
    ready: false,
    shuttingDown: false,
    startedAt: new Date().toISOString(),
  };

  private server: ReturnType<typeof createServer> | null = null;

  constructor(private readonly port: number) {
    client.collectDefaultMetrics({
      prefix: "tavi_worker_",
      register: this.registry,
    });

    this.ready.set(0);
    this.up.set(1);
  }

  async startServer() {
    if (this.server) {
      return;
    }

    this.server = createServer((request, response) => {
      void this.handleRequest(request, response).catch((error) => {
        this.logger.error("worker.observability.request_failed", { error });

        if (!response.headersSent) {
          respondJson(response, 500, { status: "error" });
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.server!;
      const onError = (error: Error) => reject(error);

      server.once("error", onError);
      server.listen(this.port, "0.0.0.0", () => {
        server.off("error", onError);
        resolve();
      });
    });
  }

  async stopServer() {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = null;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  markReady(isReady: boolean) {
    this.state.ready = isReady;
    this.ready.set(isReady ? 1 : 0);
  }

  markShuttingDown() {
    this.state.shuttingDown = true;
    this.markReady(false);
    this.up.set(0);
  }

  startJob(jobType: WorkerJobType) {
    this.activeJobs.inc({ job_type: jobType });

    return process.hrtime.bigint();
  }

  finishJob(
    jobType: WorkerJobType,
    result: WorkerJobResult,
    startedAt: bigint,
  ) {
    const durationSeconds =
      Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    const completedAt = new Date();

    this.activeJobs.dec({ job_type: jobType });
    this.jobsTotal.inc({ job_type: jobType, result });
    this.jobDurationSeconds.observe(
      { job_type: jobType, result },
      durationSeconds,
    );
    this.lastJobCompletionTimestampSeconds.set(
      { job_type: jobType, result },
      completedAt.getTime() / 1000,
    );
    this.state.lastJobCompletedAt = completedAt.toISOString();
  }

  recordRowFailure(count = 1) {
    this.importRowFailuresTotal.inc(count);
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "127.0.0.1"}`,
    );

    if (request.method !== "GET") {
      respondJson(response, 405, { status: "method_not_allowed" });
      return;
    }

    if (url.pathname === "/health") {
      const healthy = this.state.ready && !this.state.shuttingDown;

      respondJson(response, healthy ? 200 : 503, {
        lastJobCompletedAt: this.state.lastJobCompletedAt ?? null,
        ready: this.state.ready,
        service: "worker",
        shuttingDown: this.state.shuttingDown,
        startedAt: this.state.startedAt,
        status: healthy
          ? "ok"
          : this.state.shuttingDown
            ? "shutting_down"
            : "starting",
      });
      return;
    }

    if (url.pathname === "/metrics") {
      response.statusCode = 200;
      response.setHeader("cache-control", "no-store");
      response.setHeader("content-type", this.registry.contentType);
      response.end(await this.registry.metrics());
      return;
    }

    respondJson(response, 404, { status: "not_found" });
  }
}

function respondJson(
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}
