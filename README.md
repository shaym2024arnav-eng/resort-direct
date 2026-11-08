# Kaapi Hills: direct booking with allotment control and AI enquiry routing

A booking website and staff back office for a 76-key coffee-estate resort in Chikkamagaluru (take-home brief #5).

- **Guests** search dates and see live availability with prices including GST. They choose a rate plan, apply a promo code and pay with a test card in three steps, then get a confirmation.
- **Reservations staff** set daily rates, website allotment and blackout dates, manage promo codes, and export each day's bookings to CSV.
- **One enquiry inbox** for the web form, the wedding/event form, forwarded emails and WhatsApp (simulated). An AI router sorts each message (room booking, wedding, offsite, complaint), pulls out dates, guests and budget, assigns an owner and drafts a reply. Prices in drafts always come from the rate table, and a person always presses Send.

The hard part is that the site must never oversell. Every booking takes a 10-minute hold with a single conditional `UPDATE` over all its nights, and a database `CHECK (sold + held <= allotment)` backs it up. A test fires 20 simultaneous bookings at the last pool villa and checks that exactly one wins.

| | |
|---|---|
| Stack | React 19 + Vite, Node.js + Express 5, PostgreSQL, Gemini (`@google/genai`) |
| Tests | `cd backend && npm test`: 55 tests (pricing/GST, concurrency, AI guard rails, access control) |
| AI evaluation | `cd backend && npm run eval` |
| Run / deploy / logins | [deployment.md](deployment.md) |
| Design and decisions | [docs/TDD.docx](docs/TDD.docx) (also PDF and Markdown) |
| Assumptions | [docs/assumptions.md](docs/assumptions.md) |

```
backend/   Express API, migrations, seed, services (pricing, inventory), AI router, tests
frontend/  React app: guest site + staff app (/staff)
docs/      TDD, assumptions, screenshots
```
