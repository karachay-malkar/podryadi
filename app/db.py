"""SQLite persistence for the MVP; swap via a repository layer before scaling."""
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DATA_DIR = Path(os.environ.get('PODRYADI_DATA_DIR', Path(__file__).resolve().parents[1] / 'data'))
DB_FILE = DATA_DIR / 'podryadi.sqlite3'

SCHEMA = '''
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('customer','contractor')),
 display_name TEXT NOT NULL,
 city TEXT NOT NULL DEFAULT '',
 specialties TEXT NOT NULL DEFAULT '',
 about TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 csrf TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
 email TEXT PRIMARY KEY,
 count INTEGER NOT NULL DEFAULT 0,
 last_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS jobs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 customer_id INTEGER NOT NULL REFERENCES users(id),
 title TEXT NOT NULL,
 description TEXT NOT NULL,
 category TEXT NOT NULL,
 city TEXT NOT NULL,
 budget INTEGER,
 start_when TEXT NOT NULL DEFAULT 'По договорённости',
 floor INTEGER CHECK(floor BETWEEN 0 AND 200),
 elevator TEXT NOT NULL DEFAULT 'unknown' CHECK(elevator IN ('yes','no','unknown')),
 access_details TEXT NOT NULL DEFAULT '',
 materials_policy TEXT NOT NULL DEFAULT 'contractor' CHECK(materials_policy IN ('contractor','customer','discuss')),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','selected','completed','cancelled')),
 selected_offer_id INTEGER,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(budget IS NULL OR budget > 0)
);
CREATE INDEX IF NOT EXISTS jobs_feed ON jobs(status,city,category,created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_customer ON jobs(customer_id,created_at DESC);
CREATE TABLE IF NOT EXISTS job_contacts (
 job_id INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
 phone TEXT NOT NULL,
 email TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS work_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 label TEXT NOT NULL,
 unit TEXT NOT NULL,
 quantity REAL NOT NULL CHECK(quantity > 0),
 note TEXT NOT NULL DEFAULT '',
 ordinal INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_materials (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 rate_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
 label TEXT NOT NULL,
 unit TEXT NOT NULL,
 quantity REAL NOT NULL CHECK(quantity > 0),
 ordinal INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS materials_rate ON rate_materials(rate_id,ordinal);
CREATE TABLE IF NOT EXISTS photos (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 filename TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS offers (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 job_id INTEGER NOT NULL REFERENCES jobs(id),
 contractor_id INTEGER NOT NULL REFERENCES users(id),
 amount INTEGER NOT NULL CHECK(amount > 0),
 days INTEGER NOT NULL CHECK(days BETWEEN 1 AND 365),
 note TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','selected','rejected','withdrawn')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(job_id,contractor_id)
);
CREATE TABLE IF NOT EXISTS offer_rate_prices (
 offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
 rate_id INTEGER NOT NULL REFERENCES work_items(id),
 unit_price INTEGER NOT NULL CHECK(unit_price >= 0),
 PRIMARY KEY (offer_id,rate_id)
);
CREATE TABLE IF NOT EXISTS offer_material_prices (
 offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
 material_id INTEGER NOT NULL REFERENCES rate_materials(id),
 unit_price INTEGER NOT NULL CHECK(unit_price >= 0),
 PRIMARY KEY (offer_id,material_id)
);
CREATE INDEX IF NOT EXISTS offers_job ON offers(job_id);
CREATE INDEX IF NOT EXISTS offers_contractor ON offers(contractor_id,created_at DESC);
CREATE TABLE IF NOT EXISTS job_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 job_id INTEGER NOT NULL REFERENCES jobs(id),
 actor_id INTEGER NOT NULL REFERENCES users(id),
 action TEXT NOT NULL,
 detail TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS payment_intents (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 job_id INTEGER NOT NULL REFERENCES jobs(id),
 offer_id INTEGER NOT NULL REFERENCES offers(id),
 amount INTEGER NOT NULL CHECK(amount > 0),
 state TEXT NOT NULL DEFAULT 'unavailable' CHECK(state IN ('unavailable','pending','confirmed','refunded')),
 provider_reference TEXT UNIQUE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
'''


def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript(SCHEMA)
        # In-place additive schema upgrade. No duplicate tables or compatibility endpoints.
        columns = {row['name'] for row in conn.execute('PRAGMA table_info(jobs)')}
        if 'floor' not in columns:
            conn.execute('ALTER TABLE jobs ADD COLUMN floor INTEGER CHECK(floor BETWEEN 0 AND 200)')
        if 'elevator' not in columns:
            conn.execute("ALTER TABLE jobs ADD COLUMN elevator TEXT NOT NULL DEFAULT 'unknown'")
        if 'access_details' not in columns:
            conn.execute("ALTER TABLE jobs ADD COLUMN access_details TEXT NOT NULL DEFAULT ''")
        if 'materials_policy' not in columns:
            conn.execute("ALTER TABLE jobs ADD COLUMN materials_policy TEXT NOT NULL DEFAULT 'contractor'")


@contextmanager
def connect():
    conn = sqlite3.connect(DB_FILE, timeout=8, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    conn.execute('PRAGMA busy_timeout=8000')
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def transaction():
    with connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        try:
            yield conn
            conn.execute('COMMIT')
        except Exception:
            conn.execute('ROLLBACK')
            raise
