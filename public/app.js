const form = document.querySelector("#booking-form");
const dryRun = document.querySelector("#dry-run");
const authorizeRow = document.querySelector("#authorize-row");
const authorized = document.querySelector("#authorized");
const errorBox = document.querySelector("#form-error");
const jobCard = document.querySelector("#job-card");
const stopButton = document.querySelector("#stop-job");
const submitButton = form.querySelector('button[type="submit"]');
const dateInput = document.querySelector("#date");
let currentJob = null;
let elapsedTimer = null;

setDateBounds();
dryRun.addEventListener("change", updateAuthorization);
updateAuthorization();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideError();
  submitButton.disabled = true;
  const data = new FormData(form);
  const payload = {
    clubUrl: data.get("clubUrl"),
    email: data.get("email"),
    password: data.get("password"),
    date: data.get("date"),
    time: data.get("time"),
    duration: Number(data.get("duration")),
    courtName: data.get("courtName"),
    pollIntervalSeconds: Number(data.get("pollIntervalSeconds")),
    maxWaitMinutes: Number(data.get("maxWaitMinutes")),
    observationDelayMs: Number(data.get("observationDelaySeconds")) * 1000,
    mode: dryRun.checked ? "dry-run" : "book",
    browserChannel: data.get("browserChannel"),
    headless: !document.querySelector("#show-browser").checked,
    authorized: authorized.checked
  };

  try {
    const response = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error((result.errors || [result.error]).join(" "));
    form.querySelector("#password").value = "";
    currentJob = result;
    renderJob(result);
    startElapsedClock(result.startedAt);
  } catch (error) {
    showError(error.message);
    submitButton.disabled = false;
  }
});

stopButton.addEventListener("click", async () => {
  if (!currentJob) return;
  stopButton.disabled = true;
  await fetch(`/api/jobs/${currentJob.id}`, { method: "DELETE" });
});

const events = new EventSource("/api/events");
events.addEventListener("job", (event) => {
  const job = JSON.parse(event.data);
  if (!currentJob || job.id === currentJob.id) {
    currentJob = job;
    renderJob(job);
  }
});

async function restoreJob() {
  const response = await fetch("/api/jobs");
  const jobs = await response.json();
  if (!jobs.length) return;
  currentJob = jobs[jobs.length - 1];
  renderJob(currentJob);
  startElapsedClock(currentJob.startedAt);
}
void restoreJob();

function renderJob(job) {
  jobCard.classList.remove("hidden");
  document.querySelector("#status-pill").textContent = job.status.replaceAll("-", " ");
  document.querySelector("#attempts").textContent = job.attempts;
  document.querySelector("#target").textContent = `${job.config.date} · ${job.config.time}`;
  document.querySelector("#job-title").textContent = titleFor(job.status);
  const terminal = ["booked", "dry-run-ready", "failed", "stopped"].includes(job.status);
  stopButton.disabled = terminal;
  stopButton.textContent = terminal ? "Monitoring ended" : "Stop monitoring";
  submitButton.disabled = !terminal;

  const log = document.querySelector("#event-log");
  log.innerHTML = "";
  for (const item of job.logs) {
    const line = document.createElement("div");
    line.className = `log-line ${item.level}`;
    const time = document.createElement("time");
    time.textContent = new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const message = document.createElement("span");
    message.textContent = item.message;
    line.append(time, message);
    log.append(line);
  }
  log.scrollTop = log.scrollHeight;
}

function titleFor(status) {
  return ({
    queued: "Queued",
    starting: "Starting the browser",
    "signing-in": "Signing in securely",
    checking: "Checking availability",
    waiting: "Watching for an opening",
    checkout: "Slot found — checking out",
    booked: "Court booked",
    "dry-run-ready": "Dry run complete",
    failed: "Needs attention",
    stopped: "Monitoring stopped"
  })[status] || "Booking monitor";
}

function startElapsedClock(startedAt) {
  clearInterval(elapsedTimer);
  const update = () => {
    if (!startedAt) return;
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
    const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
    document.querySelector("#elapsed").textContent = `${minutes}:${(seconds % 60).toString().padStart(2, "0")}`;
  };
  update();
  elapsedTimer = setInterval(update, 1000);
}

function updateAuthorization() {
  const live = !dryRun.checked;
  authorizeRow.classList.toggle("hidden", !live);
  authorized.required = live;
  if (!live) authorized.checked = false;
}

function setDateBounds() {
  const today = new Date();
  const max = new Date(today);
  max.setDate(max.getDate() + 60);
  const localDate = (date) => {
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  };
  dateInput.min = localDate(today);
  dateInput.max = localDate(max);
  dateInput.value = localDate(today);
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function hideError() {
  errorBox.hidden = true;
  errorBox.textContent = "";
}
