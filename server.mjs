import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { scanProduct } from "./scripts/risk-scan.mjs";

const port = Number(process.env.PORT || 4173);
const publicDir = join(process.cwd(), "public");
const assets = new Map([
  ["/", "index.html"],
  ["/app.js", "app.js"],
  ["/market.html", "market.html"],
  ["/market.js", "market.js"],
  ["/styles.css", "styles.css"]
]);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const jobs = new Map();

function startScanJob({ product, reviewLimit, apiKey }) {
  const id = randomUUID();
  const job = { id, status: "running", createdAt: Date.now(), events: [] };
  jobs.set(id, job);
  const emit = (event) => job.events.push({ sequence: job.events.length, ...event });

  scanProduct({ product, reviewLimit, apiKey, onProgress: emit })
    .then(() => { job.status = "complete"; })
    .catch((error) => {
      job.status = "failed";
      emit({ type: "scan_error", error: error instanceof Error ? error.message : "Scan failed" });
    });

  const cleanup = setTimeout(() => jobs.delete(id), 60 * 60 * 1000);
  cleanup.unref();
  return job;
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 20_000) throw new Error("Request body is too large");
  }
  return JSON.parse(body || "{}");
}

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (request.method === "POST" && pathname === "/api/scans") {
      const { product, reviewLimit, apiKey } = await readJson(request);
      if (typeof product !== "string" || product.trim().length < 2) {
        response.writeHead(400, { "content-type": "application/json" });
        return response.end(JSON.stringify({ error: "Enter a product name." }));
      }
      const job = startScanJob({
        product: product.slice(0, 80),
        reviewLimit,
        apiKey: typeof apiKey === "string" && apiKey.trim()
          ? apiKey.trim()
          : process.env.TINYFISH_API_KEY
      });
      response.writeHead(202, { "content-type": "application/json", "cache-control": "no-store" });
      return response.end(JSON.stringify({ id: job.id }));
    }

    const jobMatch = pathname.match(/^\/api\/scans\/([0-9a-f-]+)$/i);
    if (request.method === "GET" && jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) {
        response.writeHead(404, { "content-type": "application/json" });
        return response.end(JSON.stringify({ error: "Scan task was not found or has expired." }));
      }
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return response.end(JSON.stringify({ id: job.id, status: job.status, events: job.events }));
    }

    if (request.method === "GET" && assets.has(pathname)) {
      const file = join(publicDir, assets.get(pathname));
      response.writeHead(200, { "content-type": types[extname(file)], "cache-control": "no-store" });
      return response.end(await readFile(file));
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Scan failed" }));
  }
});

server.listen(port, () => {
  console.log(`Product Risk Atlas is running at http://localhost:${port}`);
});
