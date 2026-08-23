import { EventEmitter } from "node:events";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { durationLabel } from "./validation.js";

const SITE_ORIGIN = "https://padelmates.se";
const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december"
];

export class BookingRunner extends EventEmitter {
  constructor(id, config, options = {}) {
    super();
    this.id = id;
    this.config = config;
    this.artifactsDir = options.artifactsDir ?? path.resolve("artifacts");
    this.browser = null;
    this.page = null;
    this.abortController = new AbortController();
    this.startedAt = null;
    this.finishedAt = null;
    this.attempts = 0;
    this.status = "queued";
    this.logs = [];
    this.error = null;
  }

  toJSON() {
    const { password: _password, authorized: _authorized, ...safeConfig } = this.config;
    return {
      id: this.id,
      status: this.status,
      attempts: this.attempts,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      error: this.error,
      config: { ...safeConfig, email: maskEmail(safeConfig.email) },
      logs: this.logs.slice(-100)
    };
  }

  log(message, level = "info") {
    const item = { at: new Date().toISOString(), level, message };
    this.logs.push(item);
    if (this.logs.length > 250) this.logs.shift();
    this.emit("update", this.toJSON());
  }

  setStatus(status) {
    this.status = status;
    this.emit("update", this.toJSON());
  }

  async start() {
    if (this.startedAt) return;
    this.startedAt = new Date().toISOString();
    this.setStatus("starting");

    try {
      const launchOptions = {
        headless: this.config.headless,
        args: ["--disable-background-timer-throttling"]
      };
      if (this.config.browserChannel !== "bundled") {
        launchOptions.channel = this.config.browserChannel || "chrome";
      }
      this.log(`Using ${browserName(this.config.browserChannel)}.`);
      this.browser = await chromium.launch(launchOptions);
      const context = await this.browser.newContext({
        locale: "en-GB",
        timezoneId: "Europe/Stockholm",
        viewport: { width: 1440, height: 1000 },
        reducedMotion: "reduce"
      });
      this.page = await context.newPage();
      this.page.setDefaultTimeout(15_000);
      this.page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));
      if (this.config.observationDelayMs > 0) {
        this.log(`Guided observation is on (${this.config.observationDelayMs / 1000}s between important steps).`);
      }

      await this.login();
      await this.monitorAndBook();
    } catch (error) {
      if (this.abortController.signal.aborted) {
        this.log("Stopped by user.", "warning");
        this.setStatus("stopped");
      } else {
        const message = readableError(error);
        this.error = message;
        this.log(message, "error");
        await this.captureFailure();
        this.setStatus("failed");
      }
    } finally {
      this.finishedAt = new Date().toISOString();
      this.config.password = "";
      await this.browser?.close().catch(() => {});
      this.browser = null;
      this.page = null;
      this.emit("update", this.toJSON());
    }
  }

  async stop() {
    if (["booked", "failed", "stopped"].includes(this.status)) return;
    this.abortController.abort();
    await this.browser?.close().catch(() => {});
  }

  assertRunning() {
    if (this.abortController.signal.aborted) throw new Error("Booking stopped.");
  }

  async login() {
    this.assertRunning();
    this.setStatus("signing-in");
    this.log("Opening Padel Mates and signing in…");
    try {
      await this.page.goto(`${SITE_ORIGIN}/sign-in`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch (error) {
      if (/ERR_NETWORK_ACCESS_DENIED|internet access is blocked/i.test(readableError(error))) {
        throw new Error(
          `Network access was denied for ${browserName(this.config.browserChannel)}. ` +
          "Choose another browser engine under Monitoring & safety, or allow that browser through your firewall/antivirus."
        );
      }
      throw error;
    }

    if (await this.page.getByText("Your Internet access is blocked", { exact: true }).count()) {
      throw new Error(
        `Network access was denied for ${browserName(this.config.browserChannel)}. ` +
        "Choose another browser engine under Monitoring & safety, or allow that browser through your firewall/antivirus."
      );
    }

    const email = this.page.locator('input[type="email"]').first();
    const password = this.page.locator('input[type="password"]').first();
    await email.waitFor({ state: "visible" });
    await this.observationPause("Sign-in form is ready.");
    await email.fill(this.config.email);
    await password.fill(this.config.password);
    await this.observationPause("Credentials entered; submitting sign-in.");

    const submit = this.page.locator('form button[type="submit"]').first();
    await submit.click();

    try {
      await this.page.waitForFunction(
        () => location.pathname !== "/sign-in" && !document.querySelector('input[type="password"]'),
        null,
        { timeout: 25_000 }
      );
    } catch {
      const errorText = await this.page.locator("label.text-red-500, p.text-red-500").allTextContents().catch(() => []);
      throw new Error(errorText.find(Boolean) || "Sign-in failed. Check the email and password, then try again.");
    }
    this.log("Signed in successfully.", "success");
    await this.observationPause("Sign-in completed.");
  }

  async monitorAndBook() {
    const deadline = Date.now() + this.config.maxWaitMinutes * 60_000;
    let firstLoad = true;

    while (Date.now() < deadline) {
      this.assertRunning();
      this.attempts += 1;
      this.setStatus("checking");
      this.log(`Checking ${this.config.date} at ${this.config.time} (attempt ${this.attempts})…`);

      if (firstLoad) {
        await this.page.goto(this.config.clubUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
        firstLoad = false;
        await this.observationPause("Club page loaded.");
      } else {
        await this.page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
      }

      await this.selectDate();
      const slot = await this.clickAvailableSlot();
      if (slot) {
        this.log(`Found ${slot.court} at ${this.config.time}. Moving immediately to checkout.`, "success");
        await this.completeCheckout();
        return;
      }

      this.setStatus("waiting");
      const refreshSeconds = this.nextRefreshSeconds();
      this.log(`Not available yet. Refreshing in ${refreshSeconds} seconds.`);
      await abortableDelay(refreshSeconds * 1000, this.abortController.signal);
    }

    throw new Error(`No matching slot became available within ${this.config.maxWaitMinutes} minutes.`);
  }

  async selectDate() {
    const picker = this.page.locator(".react-datepicker-wrapper button").filter({ visible: true }).first();
    await picker.waitFor({ state: "visible", timeout: 25_000 });
    await picker.click();

    const calendar = this.page.locator(".react-datepicker").filter({ visible: true }).first();
    await calendar.waitFor({ state: "visible" });

    const [targetYear, targetMonth, targetDay] = this.config.date.split("-").map(Number);
    for (let moves = 0; moves < 4; moves += 1) {
      const heading = calendar.locator("span.font-semibold").filter({ hasText: /[A-Za-z]+\s+\d{4}/ }).first();
      const headingText = (await heading.textContent())?.trim().toLowerCase() ?? "";
      const [monthName, yearText] = headingText.split(/\s+/);
      const shownMonth = MONTHS.indexOf(monthName) + 1;
      const shownYear = Number(yearText);
      if (!shownMonth || !shownYear) throw new Error("The Padel Mates date picker changed unexpectedly.");

      const delta = (targetYear - shownYear) * 12 + (targetMonth - shownMonth);
      if (delta === 0) break;
      const header = heading.locator("xpath=..");
      await header.locator("button").nth(delta > 0 ? 1 : 0).click();
    }

    const day = calendar
      .locator(".react-datepicker__day:not(.react-datepicker__day--outside-month)")
      .filter({ hasText: new RegExp(`^${targetDay}$`) })
      .first();
    if (!(await day.count())) throw new Error("Target date is outside the club’s selectable booking window.");
    await day.click();

    await this.page.waitForFunction(
      () => !document.querySelector(".animate-spin") || Boolean(document.querySelector("#profileNoSlotAvailableText")),
      null,
      { timeout: 25_000 }
    ).catch(() => {});
    await this.page.waitForTimeout(250);
    await this.observationPause(`Selected ${this.config.date}.`);
  }

  async clickAvailableSlot() {
    const grid = this.page.locator("div.min-w-max.relative").filter({ visible: true }).first();
    if (!(await grid.count())) return null;

    return grid.evaluate((root, options) => {
      const directRows = Array.from(root.children).filter((element) => element.classList.contains("flex"));
      if (directRows.length < 2) return null;

      const header = directRows[0];
      const hours = Array.from(header.children).slice(1).map((element) => element.textContent.trim());
      const [hour, minute] = options.time.split(":");
      const hourIndex = hours.indexOf(hour);
      if (hourIndex < 0) return null;

      const wantedCourt = options.courtName.toLocaleLowerCase();
      const rows = directRows.slice(1).filter((row) => {
        if (!wantedCourt) return true;
        return (row.querySelector("p")?.textContent ?? "").toLocaleLowerCase().includes(wantedCourt);
      });

      for (const row of rows) {
        const court = (row.querySelector("p")?.textContent ?? "court").trim();
        const hourGroups = Array.from(row.children).filter(
          (child) => child.querySelectorAll("div.transition-colors").length > 0
        );
        const group = hourGroups[hourIndex];
        if (!group) continue;
        const cells = Array.from(group.querySelectorAll("div.transition-colors"));
        const cell = cells[minute === "30" ? 1 : 0];
        if (!cell || cell.classList.contains("cursor-not-allowed") || !cell.classList.contains("cursor-pointer")) continue;
        cell.click();
        return { court };
      }
      return null;
    }, { time: this.config.time, courtName: this.config.courtName });
  }

  async completeCheckout() {
    this.assertRunning();
    this.setStatus("checkout");

    const durationHeading = this.page.getByText("Select Duration", { exact: true });
    await durationHeading.waitFor({ state: "visible", timeout: 10_000 });
    await this.observationPause(`Slot selected at ${this.config.time}; reviewing duration choices.`);
    const durationModal = durationHeading.locator("xpath=ancestor::div[contains(@class, 'shadow-xl')][1]");
    const wantedDuration = durationLabel(this.config.duration);
    const durationButton = durationModal.getByRole("button").filter({ hasText: wantedDuration }).first();
    if (!(await durationButton.count())) {
      const offered = await durationModal.getByRole("button").allTextContents();
      throw new Error(`The slot is available, but ${wantedDuration} is not offered. Available choices: ${offered.join(", ")}`);
    }
    await durationButton.click();
    await this.observationPause(`Selected ${wantedDuration}.`);
    await durationModal.getByRole("button").filter({ hasText: /^book\b/i }).last().click();

    const continueButton = this.page.locator("#continueToPay");
    await continueButton.waitFor({ state: "visible", timeout: 25_000 });
    await this.observationPause("Checkout summary is ready.");
    await continueButton.click();

    await this.page.waitForFunction(
      () => Boolean(document.querySelector("#payNowBtn")) ||
        Array.from(document.querySelectorAll("h4")).some((h) => h.textContent?.trim().toLowerCase() === "extras"),
      null,
      { timeout: 20_000 }
    );

    if (!(await this.page.locator("#payNowBtn").count())) {
      this.log("Club offers optional extras; continuing without adding any.");
      const extrasHeading = this.page.getByRole("heading", { name: /extras/i }).first();
      const extrasModal = extrasHeading.locator("xpath=ancestor::div[contains(@class, 'fixed')][1]");
      await extrasModal.getByRole("button").last().click();
    }

    const payButton = this.page.locator("#payNowBtn");
    await payButton.waitFor({ state: "visible", timeout: 20_000 });
    await this.observationPause("Payment page is ready.");

    if (this.config.mode === "manual") {
      this.setStatus("awaiting-payment");
      this.log("Payment page is ready. Complete the payment manually in the browser; the bot will keep waiting.", "success");
      await this.waitForManualPayment();
      this.log("Court booked successfully.", "success");
      this.setStatus("booked");
      return;
    }

    await payButton.waitFor({ state: "visible" });
    await this.page.waitForFunction(() => {
      const button = document.querySelector("#payNowBtn");
      return button && !button.disabled;
    }, null, { timeout: 20_000 }).catch(() => {
      throw new Error("Payment is not ready. Ensure the account has an allowed saved payment method or sufficient club credit.");
    });

    await this.observationPause("Final payment is about to be submitted.");
    this.log("Submitting the authorized booking and payment…");
    await payButton.click();
    const outcome = await this.waitForPaymentOutcome();
    if (!outcome.success) throw new Error(outcome.message);

    this.log("Court booked successfully.", "success");
    this.setStatus("booked");
  }

  async waitForPaymentOutcome() {
    const timeout = this.config.headless ? 60_000 : 180_000;
    const started = Date.now();
    while (Date.now() - started < timeout) {
      this.assertRunning();
      if (await this.page.locator("#successText, #paymentSuccess").count()) {
        return { success: true };
      }
      const alert = this.page.locator("#alertMessage").first();
      if (await alert.count()) {
        const text = (await alert.textContent())?.trim();
        if (text) return { success: false, message: text };
      }
      const hasChallenge = this.page.frames().some((frame) => /stripe|3ds|challenge/i.test(frame.url()));
      if (hasChallenge && this.config.headless) {
        return {
          success: false,
          message: "The bank requested 3-D Secure verification. Run again with ‘Show browser window’ enabled so you can approve it."
        };
      }
      await this.page.waitForTimeout(500);
    }
    return { success: false, message: "Payment did not confirm before the timeout. Check Padel Mates booking history before trying again." };
  }

  async waitForManualPayment() {
    let lastAlert = "";
    while (true) {
      this.assertRunning();
      if (await this.page.locator("#successText, #paymentSuccess").count()) return;

      const alert = this.page.locator("#alertMessage").first();
      if (await alert.count() && await alert.isVisible().catch(() => false)) {
        const text = (await alert.textContent())?.trim() ?? "";
        if (text && text !== lastAlert) {
          this.log(`Payment message: ${text}`, "warning");
          lastAlert = text;
        }
      }
      await this.page.waitForTimeout(500);
    }
  }

  async captureFailure() {
    if (!this.page || this.page.isClosed()) return;
    try {
      await mkdir(this.artifactsDir, { recursive: true });
      const screenshot = path.join(this.artifactsDir, `${this.id}-error.png`);
      await this.page.screenshot({ path: screenshot, fullPage: true });
      this.log(`Saved a diagnostic screenshot to ${screenshot}.`, "warning");
    } catch {
      // Preserve the original failure if screenshot capture also fails.
    }
  }

  async observationPause(message) {
    if (!this.config.observationDelayMs) return;
    this.assertRunning();
    this.log(`${message} Pausing briefly for observation.`);
    await abortableDelay(this.config.observationDelayMs, this.abortController.signal);
  }

  nextRefreshSeconds() {
    if (!this.config.randomiseRefresh) return this.config.pollIntervalSeconds;
    const min = this.config.refreshMinSeconds;
    const max = this.config.refreshMaxSeconds;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}

function maskEmail(email = "") {
  const [name, domain] = email.split("@");
  if (!domain) return "***";
  return `${name.slice(0, 2)}***@${domain}`;
}

function readableError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/browserType\.launch.*Executable doesn't exist/i.test(message)) {
    return "Chromium is not installed. Run: npx playwright install chromium";
  }
  if (/Target page, context or browser has been closed/i.test(message)) return "Booking stopped.";
  return message.replace(/^Error:\s*/i, "");
}

function browserName(channel) {
  if (channel === "msedge") return "system Microsoft Edge";
  if (channel === "bundled") return "bundled Playwright Chromium";
  return "system Google Chrome";
}

function abortableDelay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Booking stopped."));
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("Booking stopped."));
    }, { once: true });
  });
}
