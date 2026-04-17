#!/usr/bin/env node

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number.parseInt(process.env.PORT ?? "4173", 10);
const distDir = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const indexPath = resolve(distDir, "index.html");

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

const server = createServer(async (request, response) => {
  if (!request.url) {
    response.writeHead(400);
    response.end("Missing request URL");
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  } catch {
    response.writeHead(400);
    response.end("Invalid request URL");
    return;
  }

  const filePath = await resolveServePath(pathname);

  if (!filePath) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    const extension = extname(filePath);
    response.writeHead(200, {
      "Cache-Control": cacheControlHeader(pathname, extension),
      "Content-Length": fileStat.size,
      "Content-Type": mimeTypes.get(extension) ?? "application/octet-stream",
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(500);
    response.end("Unable to read response asset");
  }
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`web.static.ready port=${port.toString()}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}

async function resolveServePath(pathname) {
  const candidate = pathname === "/" ? indexPath : resolve(distDir, `.${pathname}`);

  if (!isWithinDist(candidate)) {
    return null;
  }

  if (await isReadableFile(candidate)) {
    return candidate;
  }

  if (extname(pathname)) {
    return null;
  }

  return indexPath;
}

function isWithinDist(filePath) {
  return filePath === distDir || filePath.startsWith(`${distDir}${sep}`);
}

async function isReadableFile(filePath) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return false;
    }
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function cacheControlHeader(pathname, extension) {
  if (pathname === "/runtime-config.js") {
    return "no-store";
  }

  if (extension === ".html") {
    return "no-cache";
  }

  return "public, max-age=31536000, immutable";
}
