# Padel Booker

Playwright browser assistant that signs into [Padel Mates](https://padelmates.se), watches one club/date/time combination, refreshes periodically, and moves through checkout as soon as an eligible court appears ;-)

## Setup

Requirements: Node.js 20 or newer.

```bash
npm install
npx playwright install chromium
npm start
```

Open `http://127.0.0.1:4173`.

Consider testing first with **Dry run**. It performs the sign-in, availability checks, slot selection, and checkout setup, then stops before the payment button and saves a screenshot under `artifacts/`.

To make a real booking, clear **Dry run**, then tick **Authorize live booking and payment**. Live mode submits the final booking and payment, so verify the club, date, time, duration, and court preference first.

To watch the automation, keep **Show browser** enabled and set **Step pause** to `1.5` or `2.5` seconds.

If the bank asks for 3-D Secure, run with **Show browser window** enabled and approve the challenge manually. After a timeout or payment error, check Padel Mates booking history before retrying to avoid a duplicate booking.
