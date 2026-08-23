import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { BookingRunner } from "./booking-runner.js";
import { validateBookingInput } from "./validation.js";

const app = express();
const port = Number(process.env.PORT || 4173);
const host = "127.0.0.1";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(root, "public");
const jobs = new Map();
const eventClients = new Set();

app.disable("x-powered-by");
app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'");
  next();
});
app.use(express.json({ limit: "32kb" }));
app.use(express.static(publicDir));

app.get("/api/jobs", (_request, response) => {
  response.json(Array.from(jobs.values()).map((job) => job.toJSON()));
});

app.get("/api/jobs/:id", (request, response) => {
  const job = jobs.get(request.params.id);
  if (!job) return response.status(404).json({ error: "Job not found." });
  response.json(job.toJSON());
});

app.post("/api/jobs", (request, response) => {
  const active = Array.from(jobs.values()).find((job) => !["booked", "dry-run-ready", "failed", "stopped"].includes(job.status));
  if (active) return response.status(409).json({ error: "A booking job is already running. Stop it before starting another." });

  const validation = validateBookingInput(request.body);
  if (!validation.ok) return response.status(400).json({ errors: validation.errors });

  const id = crypto.randomUUID();
  const job = new BookingRunner(id, validation.value, { artifactsDir: path.join(root, "artifacts") });
  jobs.set(id, job);
  job.on("update", broadcast);
  broadcast(job.toJSON());
  void job.start();
  response.status(202).json(job.toJSON());
});

app.delete("/api/jobs/:id", async (request, response) => {
  const job = jobs.get(request.params.id);
  if (!job) return response.status(404).json({ error: "Job not found." });
  await job.stop();
  response.status(202).json({ ok: true });
});

app.get("/api/events", (request, response) => {
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders();
  response.write(`event: ready\ndata: {}\n\n`);
  eventClients.add(response);
  request.on("close", () => eventClients.delete(response));
});

app.get(/.*/, (_request, response) => response.sendFile(path.join(publicDir, "index.html")));

function broadcast(job) {
  const payload = `event: job\ndata: ${JSON.stringify(job)}\n\n`;
  for (const client of eventClients) client.write(payload);
}

app.listen(port, host, () => {
  console.log(`Padel Booker is ready at http://${host}:${port}`);
  console.log("Credentials stay in this process only and are cleared when a job finishes.");
});
