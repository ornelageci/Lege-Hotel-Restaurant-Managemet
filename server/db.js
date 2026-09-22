const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA_V1 = `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','reception')),
  created_at TEXT NOT NULL
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE categories (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cap INTEGER NOT NULL CHECK (cap >= 1),
  inc INTEGER NOT NULL CHECK (inc >= 1),
  extra INTEGER NOT NULL DEFAULT 0 CHECK (extra >= 0)
);
CREATE TABLE prices (
  cat TEXT NOT NULL REFERENCES categories(key),
  month INTEGER NOT NULL CHECK (month BETWEEN -1 AND 11),   -- -1 = base price
  amount INTEGER NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (cat, month)
);
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  floor INTEGER NOT NULL,
  cat TEXT NOT NULL REFERENCES categories(key),
  dirty INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE guests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  points INTEGER NOT NULL DEFAULT 0,
  visits INTEGER NOT NULL DEFAULT 0,
  prefs TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_guests_name ON guests (name COLLATE NOCASE);
CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL REFERENCES guests(id),
  room_id TEXT NOT NULL REFERENCES rooms(id),
  arr TEXT NOT NULL,
  dep TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('confirmed','checkedin','checkedout','cancelled')),
  source TEXT NOT NULL DEFAULT 'Direkt',
  adults INTEGER NOT NULL CHECK (adults >= 1),
  custom INTEGER NOT NULL DEFAULT 0 CHECK (custom >= 0),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT,
  CHECK (dep > arr)
);
CREATE INDEX idx_res_room ON reservations (room_id, arr, dep);
CREATE INDEX idx_res_status ON reservations (status);
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash','card','transfer')),
  at TEXT NOT NULL,
  user_id TEXT
);
CREATE INDEX idx_pay_res ON payments (reservation_id);
CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL REFERENCES guests(id),
  type TEXT NOT NULL,
  note TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  day TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  detail TEXT
);
`;

// V2: roles renamed: admin -> manager, reception -> receptionist.
const SCHEMA_V2 = `
CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('manager','receptionist')),
  created_at TEXT NOT NULL
);
INSERT INTO users_new (id,email,name,password_hash,role,created_at)
  SELECT id,email,name,password_hash,CASE role WHEN 'admin' THEN 'manager' ELSE 'receptionist' END,created_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
`;

// V3: English data, email log, bar/restaurant (menu, orders) and beach umbrellas.
const SCHEMA_V3 = `
UPDATE reservations SET source = CASE source
  WHEN 'Direkt' THEN 'Direct' WHEN 'Telefon' THEN 'Phone' WHEN 'Agjenci' THEN 'Agency' WHEN 'Tjetër' THEN 'Other' ELSE source END;
UPDATE requests SET type = CASE type
  WHEN 'Restorant' THEN 'Restaurant' WHEN 'Shërbim dhome' THEN 'Room service' WHEN 'Ekskursion' THEN 'Excursion' WHEN 'Tjetër' THEN 'Other' ELSE type END;
UPDATE categories SET name = 'Family Duplex' WHERE name = 'Duplex familjar';

CREATE TABLE email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent','failed','skipped')),
  error TEXT
);

CREATE TABLE menu_items (
  id TEXT PRIMARY KEY,
  outlet TEXT NOT NULL CHECK (outlet IN ('bar','restaurant')),
  section TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  outlet TEXT NOT NULL CHECK (outlet IN ('bar','restaurant')),
  reservation_id TEXT REFERENCES reservations(id),      -- set when charged to a room
  label TEXT NOT NULL DEFAULT '',                       -- table number or walk-in name
  total INTEGER NOT NULL CHECK (total >= 0),
  status TEXT NOT NULL CHECK (status IN ('room','paid','void')),
  method TEXT CHECK (method IN ('cash','card')),        -- how a "paid" order was settled
  note TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT,
  voided_by TEXT
);
CREATE INDEX idx_orders_res ON orders (reservation_id);
CREATE INDEX idx_orders_day ON orders (day, outlet);
CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  qty INTEGER NOT NULL CHECK (qty >= 1)
);
CREATE INDEX idx_items_order ON order_items (order_id);

CREATE TABLE beach_bookings (
  id TEXT PRIMARY KEY,
  spot INTEGER NOT NULL CHECK (spot >= 1),
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  guest_name TEXT NOT NULL,
  reservation_id TEXT REFERENCES reservations(id),      -- set when the person is a hotel guest
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT,
  CHECK (to_date >= from_date)
);
CREATE INDEX idx_beach_spot ON beach_bookings (spot, from_date, to_date);
INSERT INTO settings (key, value) VALUES ('beach_umbrellas', '39');

-- Sample menu. The manager edits it from Bar & Restaurant > Manage menu.
INSERT INTO menu_items (id, outlet, section, name, price) VALUES
  ('bar-espresso','bar','Coffee','Espresso',150),
  ('bar-macchiato','bar','Coffee','Macchiato',170),
  ('bar-cappuccino','bar','Coffee','Cappuccino',250),
  ('bar-juice','bar','Soft drinks','Fresh orange juice',400),
  ('bar-water-still','bar','Soft drinks','Still water 0.5 L',100),
  ('bar-water-sparkling','bar','Soft drinks','Sparkling water 0.5 L',150),
  ('bar-cola','bar','Soft drinks','Cola',200),
  ('bar-beer-draft','bar','Beer & wine','Draft beer 0.5 L',300),
  ('bar-beer-bottle','bar','Beer & wine','Bottled beer',250),
  ('bar-wine','bar','Beer & wine','House wine (glass)',400),
  ('bar-raki','bar','Spirits & cocktails','Raki (shot)',250),
  ('bar-spritz','bar','Spirits & cocktails','Aperol Spritz',700),
  ('bar-mojito','bar','Spirits & cocktails','Mojito',700),
  ('rest-byrek','restaurant','Starters','Byrek (spinach pie)',400),
  ('rest-greek','restaurant','Starters','Greek salad',600),
  ('rest-tomato','restaurant','Starters','Tomato and cucumber salad',450),
  ('rest-seabass','restaurant','Mains','Grilled sea bass',1600),
  ('rest-tavekosi','restaurant','Mains','Tave kosi (baked lamb and yoghurt)',1200),
  ('rest-chicken','restaurant','Mains','Grilled chicken',1100),
  ('rest-seafood-pasta','restaurant','Mains','Seafood spaghetti',1300),
  ('rest-burger','restaurant','Mains','Beef burger',900),
  ('rest-baklava','restaurant','Desserts','Baklava',400),
  ('rest-fruit','restaurant','Desserts','Fruit plate',500),
  ('rest-icecream','restaurant','Desserts','Ice cream (3 scoops)',400);
`;

const MIGRATIONS = [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3];

function migrate(db) {
  let v = db.pragma('user_version', { simple: true });
  while (v < MIGRATIONS.length) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
    v += 1;
  }
}

/** Initial hotel setup: 20 rooms, two categories, September prices. Runs only on an empty database. */
function initHotel(db, hotelName) {
  const has = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
  if (has) return;
  db.transaction(() => {
    db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('hotel_name', hotelName);
    db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('fx', '91.5');
    const cat = db.prepare('INSERT INTO categories (key,name,cap,inc,extra) VALUES (?,?,?,?,?)');
    cat.run('std', 'Standard', 2, 2, 0);
    cat.run('dup', 'Family Duplex', 10, 2, 2500);
    const price = db.prepare('INSERT INTO prices (cat,month,amount) VALUES (?,?,?)');
    for (const k of ['std', 'dup']) { price.run(k, -1, 7500); price.run(k, 8, 7500); }
    const room = db.prepare('INSERT INTO rooms (id,floor,cat,dirty) VALUES (?,?,?,0)');
    for (let i = 1; i <= 10; i++) room.run(`1${String(i).padStart(2, '0')}`, 1, 'std');
    for (let i = 1; i <= 10; i++) room.run(`2${String(i).padStart(2, '0')}`, 2, 'dup');
  })();
}

function open(dbPath, hotelName = 'Lege') {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  initHotel(db, hotelName);
  return db;
}

module.exports = { open, migrate, MIGRATIONS };
