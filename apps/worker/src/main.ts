import { defaultPorts } from "@tavi/config";
import { PrismaClient } from "@prisma/client";
import { LoopImportWorker } from "./loop-import-worker.js";
import { WorkerObservability } from "./worker-observability.js";

const prisma = new PrismaClient();
const port = Number(process.env.PORT ?? defaultPorts.worker);
const controller = new AbortController();
const observability = new WorkerObservability(port);
const worker = new LoopImportWorker(prisma, observability);

const shutdown = (signal: string) => {
  if (controller.signal.aborted) {
    return;
  }

  observability.markShuttingDown();
  observability.logger.info("worker.shutdown.requested", { signal });
  controller.abort();
};

process.on("SIGINT", () => {
  shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

void (async () => {
  try {
    await observability.startServer();
    observability.logger.info("worker.starting", { port });
    await prisma.$connect();
    observability.markReady(true);
    observability.logger.info("worker.ready", { port });
    await worker.run(controller.signal);
    observability.logger.info("worker.stopped");
  } catch (error) {
    process.exitCode = 1;
    observability.logger.fatal("worker.fatal", {
      error: error instanceof Error ? error : String(error),
    });
  } finally {
    observability.markReady(false);

    await observability.stopServer().catch((error) => {
      observability.logger.error("worker.observability.stop_failed", { error });
    });
    await prisma.$disconnect().catch((error) => {
      observability.logger.error("worker.database.disconnect_failed", {
        error,
      });
    });
  }
})();
