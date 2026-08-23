const form = document.querySelector("#booking-form");
const paymentModes = document.querySelectorAll('input[name="paymentMode"]');
const authorizeRow = document.querySelector("#authorize-row");
const authorized = document.querySelector("#authorized");
const errorBox = document.querySelector("#form-error");
const jobCard = document.querySelector("#job-card");
const stopButton = document.querySelector("#stop-job");
const submitButton = form.querySelector('button[type="submit"]');
const dateInput = document.querySelector("#date");
const randomiseRefresh = document.querySelector("#randomise-refresh");
const pollInterval = document.querySelector("#poll-interval");
const refreshRange = document.querySelector("#refresh-range");
const refreshMin = document.querySelector("#refresh-min");
const refreshMax = document.querySelector("#refresh-max");
const showBrowser = document.querySelector("#show-browser");
const FORM_STORAGE_KEY = "padelbooker.form.v1";
let currentJob = null;
let elapsedTimer = null;

setDateBounds();
restoreFormState();
for (const paymentMode of paymentModes) paymentMode.addEventListener("change", updateAuthorization);
randomiseRefresh.addEventListener("change", updateRefreshMode);
form.addEventListener("input", saveFormState);
form.addEventListener("change", saveFormState);
updateAuthorization();
updateRefreshMode();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveFormState();
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
    pollIntervalSeconds: Number(pollInterval.value),
    randomiseRefresh: randomiseRefresh.checked,
    refreshMinSeconds: Number(refreshMin.value),
    refreshMaxSeconds: Number(refreshMax.value),
    maxWaitMinutes: Number(data.get("maxWaitMinutes")),
    observationDelayMs: Number(data.get("observationDelaySeconds")) * 1000,
    mode: document.querySelector('input[name="paymentMode"]:checked').value,
    browserChannel: data.get("browserChannel"),
    headless: !showBrowser.checked,
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
  const terminal = ["booked", "failed", "stopped"].includes(job.status);
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
    "awaiting-payment": "Waiting for manual payment",
    booked: "Court booked",
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
  const automatic = document.querySelector('input[name="paymentMode"]:checked').value === "automatic";
  authorizeRow.classList.toggle("hidden", !automatic);
  authorized.required = automatic;
  if (!automatic) {
    authorized.checked = false;
    showBrowser.checked = true;
  }
  showBrowser.disabled = !automatic;
}

function updateRefreshMode() {
  const randomised = randomiseRefresh.checked;
  pollInterval.disabled = randomised;
  refreshRange.classList.toggle("hidden", !randomised);
  refreshMin.required = randomised;
  refreshMax.required = randomised;
}

function saveFormState() {
  const data = new FormData(form);
  const state = {
    clubUrl: data.get("clubUrl"),
    email: data.get("email"),
    date: data.get("date"),
    time: data.get("time"),
    duration: data.get("duration"),
    courtName: data.get("courtName"),
    pollIntervalSeconds: pollInterval.value,
    randomiseRefresh: randomiseRefresh.checked,
    refreshMinSeconds: refreshMin.value,
    refreshMaxSeconds: refreshMax.value,
    maxWaitMinutes: data.get("maxWaitMinutes"),
    observationDelaySeconds: data.get("observationDelaySeconds"),
    browserChannel: data.get("browserChannel"),
    paymentMode: data.get("paymentMode"),
    showBrowser: showBrowser.checked
  };
  try {
    localStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The form still works if browser storage is unavailable.
  }
}

function restoreFormState() {
  let state;
  try {
    state = JSON.parse(localStorage.getItem(FORM_STORAGE_KEY));
  } catch {
    return;
  }
  if (!state || typeof state !== "object") return;

  const textFields = [
    "clubUrl",
    "email",
    "date",
    "time",
    "duration",
    "courtName",
    "pollIntervalSeconds",
    "refreshMinSeconds",
    "refreshMaxSeconds",
    "maxWaitMinutes",
    "observationDelaySeconds"
  ];
  for (const name of textFields) {
    if (state[name] === undefined || state[name] === null) continue;
    const input = form.elements.namedItem(name);
    if (input) input.value = String(state[name]);
  }

  const browser = form.querySelector(`input[name="browserChannel"][value="${safeRadioValue(state.browserChannel)}"]`);
  if (browser) browser.checked = true;
  const payment = form.querySelector(`input[name="paymentMode"][value="${safeRadioValue(state.paymentMode)}"]`);
  if (payment) payment.checked = true;
  randomiseRefresh.checked = state.randomiseRefresh === true;
  if (typeof state.showBrowser === "boolean") showBrowser.checked = state.showBrowser;
}

function safeRadioValue(value) {
  return String(value ?? "").replace(/[^a-z-]/gi, "");
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
