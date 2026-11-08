# Deployment and running locally

**Live demo:** _add your Render URL here_
**Repository:** _add your GitHub URL here_

## Demo logins

| Role | Email | Password | What to try |
|---|---|---|---|
| Guest | guest@kaapihills.test | Guest@123 | Search dates, book, pay with a test card, see My bookings |
| Reservations staff | reservations@kaapihills.test | Staff@123 | Inbox ("Mine"), rates and allotment, bookings export |
| Sales (weddings, offsites) | sales@kaapihills.test | Staff@123 | Wedding and offsite enquiries routed to sales |
| General Manager | gm@kaapihills.test | Gm@12345 | Complaint alerts, Unsorted lane, re-routing |

Test cards: **4242 4242 4242 4242** succeeds and **4000 0000 0000 0002** is declined. Use any future expiry (e.g. 12/30) and any 3-digit CVC.

These are sample accounts on sample data. They aren't secrets, but change them before using the code for anything real.

---

## Run it locally

You need **Node.js 20+** and **PostgreSQL 14+**.

1. **Get the code**
   ```bash
   git clone <your-repo-url> resort-direct
   cd resort-direct
   ```

2. **Create two databases**: one for the app and one the tests can wipe.
   ```bash
   createdb resort
   createdb resort_test
   ```
   (No local Postgres? Use two free Neon databases and paste their URLs in step 3.)

3. **Configure the backend**
   ```bash
   cd backend
   cp .env.example .env
   ```
   Edit `.env` and set `DATABASE_URL`, `TEST_DATABASE_URL` and `JWT_SECRET` (any long random string).
   `GEMINI_API_KEY` is optional. Without it, enquiries are sorted by the rule-based fallback.

4. **Install, create tables and load sample data**
   ```bash
   npm install
   npm run setup        # runs migrations, then seeds demo data
   ```
   `npm run seed` resets the demo data at any time.

5. **Start the API** (port 5000)
   ```bash
   npm run dev
   ```

6. **Start the website**, in a second terminal
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Open **http://localhost:5173**. Vite forwards `/api` calls to port 5000.

7. **Run the tests** (from `backend/`)
   ```bash
   npm test             # 55 tests: pricing/GST, overbooking under concurrency, AI guard rails, API access control
   npm run eval         # accuracy of the enquiry router on 51 labelled messages (add GEMINI_API_KEY to include Gemini)
   ```

**Production-like run on one port:** from the repo root, run `npm run build` and then `npm start`. Open http://localhost:5000.

---

## How it is deployed

- **Database: Neon** (managed Postgres, free tier). Create a project and copy the pooled connection string.
- **App: one Render web service** (free tier). Express serves both the API (`/api/*`) and the built React app from the same origin. That keeps the session cookie first-party and avoids CORS altogether.
  - `render.yaml` in the repo root defines the service. In Render choose **New → Blueprint**, pick the repo, and fill in the variables it asks for.
  - Build command: `npm run build`. This installs both apps and builds the frontend.
  - Start command: `npm start`. This runs migrations, seeds demo data **only if the database is empty**, then starts the server.
  - Health check: `/api/health`
- On the free plan Render sleeps after inactivity, so the first request can take about 30–60 seconds to wake it.

## Environment variables (names only)

| Name | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `JWT_SECRET` | yes | Signs session cookies (Render can generate it) |
| `NODE_ENV` | yes in production | `production` turns on secure cookies |
| `PORT` | set by Render | Port to listen on |
| `GEMINI_API_KEY` | no | Turns on Gemini for enquiry classification and drafts |
| `GEMINI_MODEL` | no | Defaults to `gemini-3.6-flash` |
| `TEST_DATABASE_URL` | tests only | Database that the tests drop and re-create |
| `CLIENT_ORIGIN` | no | Only if the frontend is hosted on a different origin |

Never commit `.env`. It is in `.gitignore`, and `.env.example` lists the names with no values.
