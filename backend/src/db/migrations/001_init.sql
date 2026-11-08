-- Kaapi Hills direct booking: initial schema.
-- Money is stored as integer paise to avoid floating-point errors (₹1 = 100 paise).

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  phone         TEXT,
  role          TEXT NOT NULL CHECK (role IN ('guest', 'staff', 'gm')),
  team          TEXT CHECK (team IN ('reservations', 'sales', 'management')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS room_types (
  id               SERIAL PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('room', 'villa')),
  summary          TEXT NOT NULL,
  description      TEXT NOT NULL,
  size_sqft        INT NOT NULL,
  bed              TEXT NOT NULL,
  view             TEXT NOT NULL,
  max_adults       INT NOT NULL,
  max_children     INT NOT NULL,
  base_occupancy   INT NOT NULL DEFAULT 2,
  extra_adult_paise INT NOT NULL DEFAULT 0,
  total_units      INT NOT NULL,          -- physical keys at the resort
  amenities        JSONB NOT NULL DEFAULT '[]',
  photos           JSONB NOT NULL DEFAULT '[]',
  sort             INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rate_plans (
  id                     SERIAL PRIMARY KEY,
  code                   TEXT NOT NULL UNIQUE,
  name                   TEXT NOT NULL,
  description            TEXT NOT NULL,
  breakfast_per_adult_paise INT NOT NULL DEFAULT 0,
  discount_pct           NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct < 100),
  refundable             BOOLEAN NOT NULL DEFAULT true,
  sort                   INT NOT NULL DEFAULT 0
);

-- One row per room type per night. The website may sell only `allotment` units;
-- the CHECK makes overselling impossible at the database level, whatever the code does.
CREATE TABLE IF NOT EXISTS inventory (
  room_type_id INT NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  stay_date    DATE NOT NULL,
  allotment    INT NOT NULL CHECK (allotment >= 0),
  sold         INT NOT NULL DEFAULT 0 CHECK (sold >= 0),
  held         INT NOT NULL DEFAULT 0 CHECK (held >= 0),
  rate_paise   INT NOT NULL CHECK (rate_paise > 0),
  closed       BOOLEAN NOT NULL DEFAULT false,   -- blackout date
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_type_id, stay_date),
  CONSTRAINT inventory_no_overbooking CHECK (sold + held <= allotment)
);

CREATE TABLE IF NOT EXISTS promo_codes (
  id           SERIAL PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  description  TEXT NOT NULL DEFAULT '',
  discount_pct NUMERIC(5,2) NOT NULL CHECK (discount_pct > 0 AND discount_pct <= 50),
  min_nights   INT NOT NULL DEFAULT 1,
  valid_from   DATE NOT NULL,
  valid_to     DATE NOT NULL,
  max_uses     INT,
  used         INT NOT NULL DEFAULT 0,
  active       BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS bookings (
  id              SERIAL PRIMARY KEY,
  ref             TEXT NOT NULL UNIQUE,
  user_id         INT NOT NULL REFERENCES users(id),
  room_type_id    INT NOT NULL REFERENCES room_types(id),
  rate_plan_id    INT NOT NULL REFERENCES rate_plans(id),
  check_in        DATE NOT NULL,
  check_out       DATE NOT NULL,
  nights          INT NOT NULL,
  rooms           INT NOT NULL CHECK (rooms > 0),
  adults          INT NOT NULL CHECK (adults > 0),
  children        INT NOT NULL DEFAULT 0,
  guest_name      TEXT NOT NULL,
  guest_email     TEXT NOT NULL,
  guest_phone     TEXT NOT NULL,
  special_requests TEXT NOT NULL DEFAULT '',
  promo_code      TEXT,
  price           JSONB NOT NULL,          -- full night-by-night breakup at the time of booking
  total_paise     INT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('held', 'confirmed', 'cancelled', 'expired')),
  hold_expires_at TIMESTAMPTZ,
  payment_ref     TEXT,
  consent_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at    TIMESTAMPTZ,
  CHECK (check_out > check_in)
);
CREATE INDEX IF NOT EXISTS bookings_status_expiry ON bookings (status, hold_expires_at);
CREATE INDEX IF NOT EXISTS bookings_user ON bookings (user_id);

CREATE SEQUENCE IF NOT EXISTS enquiry_ref_seq START 4500;

CREATE TABLE IF NOT EXISTS enquiries (
  id            SERIAL PRIMARY KEY,
  ref           TEXT NOT NULL UNIQUE,
  channel       TEXT NOT NULL CHECK (channel IN ('web', 'event_form', 'email', 'whatsapp')),
  name          TEXT NOT NULL,
  contact       TEXT NOT NULL,
  message       TEXT NOT NULL,
  form_data     JSONB,                       -- structured fields from the event form
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processing    TEXT NOT NULL DEFAULT 'pending' CHECK (processing IN ('pending', 'done', 'failed')),
  category      TEXT CHECK (category IN ('room_booking', 'wedding', 'corporate_offsite', 'complaint', 'other')),
  confidence    NUMERIC(4,3),
  extracted     JSONB NOT NULL DEFAULT '{}',
  summary       TEXT,
  ai_source     TEXT CHECK (ai_source IN ('gemini', 'rules')),
  ai_note       TEXT,
  lane          TEXT NOT NULL DEFAULT 'unsorted' CHECK (lane IN ('routed', 'unsorted')),
  owner_id      INT REFERENCES users(id),
  needs_gm      BOOLEAN NOT NULL DEFAULT false,
  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'replied', 'closed')),
  draft_reply   TEXT,
  quote         JSONB,
  sent_reply    TEXT,
  replied_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS enquiries_lane ON enquiries (lane, status, received_at DESC);

CREATE TABLE IF NOT EXISTS enquiry_events (
  id          SERIAL PRIMARY KEY,
  enquiry_id  INT NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  user_id     INT REFERENCES users(id),
  action      TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alerts (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,
  enquiry_id  INT REFERENCES enquiries(id) ON DELETE CASCADE,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at     TIMESTAMPTZ
);
