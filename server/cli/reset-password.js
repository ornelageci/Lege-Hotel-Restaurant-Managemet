/* Usage: npm run reset-password -- email@example.com
 * Sets a new password for an existing account (asks for it, or reads NEW_USER_PASSWORD). Lists the accounts if the email is not found. */
const readline = require('readline');
const config = require('../config');
const dbLib = require('../db');
const auth = require('../auth');

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

(async () => {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  const db = dbLib.open(config.dbPath, config.hotelName);
  const user = email && db.prepare('SELECT id, email, role FROM users WHERE email=?').get(email);
  if (!user) {
    console.error(email ? `No account with the email ${email}.` : 'Usage: npm run reset-password -- email@example.com');
    console.error('Existing accounts:');
    for (const u of db.prepare('SELECT email, role FROM users ORDER BY role, email').all()) console.error(`  ${u.email}  (${u.role})`);
    process.exit(1);
  }
  const password = process.env.NEW_USER_PASSWORD || await ask('New password (min. 10 characters): ');
  if (!auth.validPassword(password)) { console.error('The password must be at least 10 characters long.'); process.exit(1); }
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(auth.hashPassword(password), user.id);
  console.log(`Password changed for ${user.email} (${user.role}). Sign in with the new password.`);
})();
