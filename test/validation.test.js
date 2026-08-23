import test from "node:test";
import assert from "node:assert/strict";
import { BookingRunner } from "../src/booking-runner.js";
import { durationLabel, validateBookingInput } from "../src/validation.js";

const validInput = {
  email: "player@example.com",
  password: "not-a-real-password",
  clubUrl: "https://padelmates.se/club/example-club",
  date: "2026-08-24",
  time: "18:30",
  duration: 90,
  pollIntervalSeconds: 5,
  maxWaitMinutes: 120,
  mode: "manual",
  headless: false,
  authorized: false
};

test("accepts and normalizes valid manual payment", () => {
  const result = validateBookingInput(validInput, new Date("2026-08-23T10:00:00Z"));
  assert.equal(result.ok, true);
  assert.equal(result.value.clubUrl, "https://padelmates.se/club/example-club");
  assert.equal(result.value.duration, 90);
  assert.equal(result.value.browserChannel, "chrome");
  assert.equal(result.value.observationDelayMs, 0);
});

test("accepts a supported browser channel and defaults unknown values safely", () => {
  const edge = validateBookingInput(
    { ...validInput, browserChannel: "msedge" },
    new Date("2026-08-23T10:00:00Z")
  );
  const unknown = validateBookingInput(
    { ...validInput, browserChannel: "unknown" },
    new Date("2026-08-23T10:00:00Z")
  );
  assert.equal(edge.value.browserChannel, "msedge");
  assert.equal(unknown.value.browserChannel, "chrome");
});

test("rejects off-site URLs and unsupported minute boundaries", () => {
  const result = validateBookingInput(
    { ...validInput, clubUrl: "https://example.com/club/test", time: "18:15" },
    new Date("2026-08-23T10:00:00Z")
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /padelmates\.se/i);
  assert.match(result.errors.join(" "), /half-hour/i);
});

test("requires explicit authorization for live booking", () => {
  const result = validateBookingInput(
    { ...validInput, mode: "automatic", authorized: false },
    new Date("2026-08-23T10:00:00Z")
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /authorize/i);
});

test("manual payment requires a visible browser", () => {
  const result = validateBookingInput(
    { ...validInput, mode: "manual", headless: true },
    new Date("2026-08-23T10:00:00Z")
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /show browser/i);
});

test("formats duration labels like the live modal", () => {
  assert.equal(durationLabel(60), "1h 00m");
  assert.equal(durationLabel(90), "1h 30m");
});

test("validates guided observation pacing", () => {
  const guided = validateBookingInput(
    { ...validInput, observationDelayMs: 1500 },
    new Date("2026-08-23T10:00:00Z")
  );
  const excessive = validateBookingInput(
    { ...validInput, observationDelayMs: 5000 },
    new Date("2026-08-23T10:00:00Z")
  );
  assert.equal(guided.value.observationDelayMs, 1500);
  assert.equal(excessive.ok, false);
  assert.match(excessive.errors.join(" "), /observation delay/i);
});

test("accepts a valid random refresh range", () => {
  const result = validateBookingInput(
    {
      ...validInput,
      randomiseRefresh: true,
      refreshMinSeconds: 3,
      refreshMaxSeconds: 9
    },
    new Date("2026-08-23T10:00:00Z")
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.randomiseRefresh, true);
  assert.equal(result.value.refreshMinSeconds, 3);
  assert.equal(result.value.refreshMaxSeconds, 9);
});

test("rejects an inverted random refresh range", () => {
  const result = validateBookingInput(
    {
      ...validInput,
      randomiseRefresh: true,
      refreshMinSeconds: 12,
      refreshMaxSeconds: 4
    },
    new Date("2026-08-23T10:00:00Z")
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /cannot be greater/i);
});

test("chooses refresh delays inside the configured inclusive range", () => {
  const runner = new BookingRunner("test", {
    randomiseRefresh: true,
    refreshMinSeconds: 3,
    refreshMaxSeconds: 8
  });
  const samples = Array.from({ length: 100 }, () => runner.nextRefreshSeconds());
  assert.equal(samples.every((value) => Number.isInteger(value) && value >= 3 && value <= 8), true);
});
