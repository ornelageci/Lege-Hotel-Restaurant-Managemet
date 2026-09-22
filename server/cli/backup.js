/* Usage: npm run backup  (creates data/backups/lege-YYYYMMDD-HHMMSS.db without stopping the server) */
const path = require('path');
const fs = require('fs');
const config = require('../config');
const dbLib = require('../db');

(async () => {
  const db = dbLib.open(config.dbPath, config.hotelName);
  const dir = path.join(path.dirname(config.dbPath), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const file = path.join(dir, `lege-${stamp}.db`);
  await db.backup(file);
  console.log(`Backup saved: ${file}`);
  db.close();
})();
