# Assumptions

Each assumption is something the brief didn't say. I made a decision, labelled it here, and kept it easy to change.

| # | Assumption | Why | Where to change it |
|---|---|---|---|
| A1 | The resort is called **Kaapi Hills**, a placeholder name. | The brief names it only "Company A". | Text in `frontend/src`, seed data |
| A2 | The 76 keys split into Estate Room 30, Valley View Room 24, Coffee Suite 10 (= 64 rooms), Plantation Villa 8, Pool Villa 4 (= 12 villas). | The brief gives only 64 rooms + 12 villas. | `backend/src/db/seed.js` |
| A3 | The website's default allotment is 6 / 5 / 2 / 2 / 1 units per night of those types. The rest is sold by the reservation system, agents and OTAs. | The brief says the site sells only the allotment admin sets, so the website gets a slice and not the whole house. | Admin screen, or seed |
| A4 | GST on accommodation is 5% when the price of one room for one night is ₹7,500 or less after discounts, and 18% above that. This has been the rule since 22 Sep 2025. The slab is decided per room per night. | Current GST rates for hotel accommodation; "show GST at the rate for the tariff". | `backend/src/config.js`, `services/pricing.js` |
| A5 | Breakfast sold as part of a room rate is a composite supply taxed at the accommodation rate, so it counts towards the ₹7,500 test. | That's the usual treatment of a bundled rate. A tax adviser should confirm it. | `services/pricing.js` |
| A6 | Base occupancy is 2 adults. Extra adults pay a fixed nightly charge and children stay free within each room's limit. | Common resort practice; the brief is silent. | `room_types` table |
| A7 | Rates: the weekday rate is +15% on Friday and Saturday nights and +30% from 20 Dec to 2 Jan, set per night in the inventory table. | Gives realistic variation and lets the GST slab change within a stay. | Admin screen |
| A8 | A booking holds rooms for **10 minutes** while the guest pays. Unpaid holds are released automatically. | Long enough to pay, short enough not to block stock. | `config.holdMinutes` |
| A9 | Payment is a mock gateway with test cards (4242… succeeds, 4000 0000 0000 0002 declines). Card details are checked and thrown away, never stored. | The brief says to mock payments. | `services/inventory.js` |
| A10 | Email and WhatsApp are simulated: staff can inject an incoming message, and a sent reply is logged, not delivered. | The brief says to mock messages and outside systems. | `routes/staff.js` |
| A11 | Rate plans: Stay only, Bed & breakfast (₹650 per adult per night), and an Advance saver (breakfast included, 12% off, non-refundable). | The brief asks for rate plans but doesn't list them. | `rate_plans` table |
| A12 | Online stays are 1–14 nights, up to 4 rooms per booking, up to 365 days ahead. Anything bigger goes to the enquiry form. | Keeps the web flow simple; groups need a person anyway. | `config.js` |
| A13 | Routing: room bookings go to the reservations team, weddings and offsites to sales, complaints to the GM. Each goes to the least-loaded person in the team. The confidence bar for automatic routing is 0.7. | The brief names the categories, not the teams. | `router/enquiries.js`, `config.routingConfidence` |
| A14 | Photos are generated landscape illustrations, not photographs. The site is ready for real ones: it uses a photo when one is saved as `frontend/public/images/<name>.jpg`, and otherwise a generated landscape illustration with the same name. | Real photos weren't supplied, and stock sites weren't reachable from the build environment. The illustrations weigh a few KB, which helps on slow hill-station networks. | `frontend/public/images`, `frontend/scripts/make-images.mjs` |
| A15 | DPDP Act 2023: we take an explicit consent tick for each booking and enquiry, store only what the booking needs, and never collect passport data online (Form C happens at check-in). | The brief lists these constraints; a full privacy notice and retention schedule are out of scope. | Checkout and enquiry forms |
| A16 | "Daily booking export" means a CSV of bookings made on a chosen day (also filterable by arrival day or "staying that night"). | The brief doesn't say which day. | Staff → Bookings |
| A17 | Guests need an account to book, so they can come back to "My bookings". Staff accounts are created by the resort, never by sign-up. | Simplest model that meets "sign-in with roles". | `routes/auth.js` |
