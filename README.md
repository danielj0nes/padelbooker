# Padel Booker

Playwright browser assistant that signs into [Padel Mates](https://padelmates.se), watches one club/date/time combination, refreshes periodically, and moves through checkout as soon as an eligible court appears ;-)

## Setup

Requirements: Node.js 20 or newer.

```bash
npm install
npx playwright install chromium
```

## Running
```bash
npm start
```

Open `http://127.0.0.1:4173`.

**Manual payment** is the default. The bot reaches checkout and waits while you enter or confirm payment in the visible browser.

**Automatic payment** uses the account's saved payment method or club credit and submits payment automatically. Tick the authorisation checkbox that appears.

To watch the automation, keep **Show browser** enabled and set **Step pause** to `1.5` or `2.5` seconds.

Enable **Randomise** beside **Refresh** to choose a new delay for every check. Set the inclusive minimum and maximum delay in seconds (2–120).

The form remembers its settings in browser storage. Passwords and the automatic-payment authorisation are not stored; use the browser's password manager for the password.

If the bank asks for 3-D Secure, run with **Show browser window** enabled and approve the challenge manually. After a timeout or payment error, check Padel Mates booking history before retrying to avoid a duplicate booking.
