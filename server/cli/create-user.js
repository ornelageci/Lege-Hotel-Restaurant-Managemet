/* Usage: npm run create-user -- email@example.com "First Last" manager|receptionist */
const readline = require('readline');
const config = require('../config');
const dbLib = require('../db');
const auth = require('../auth');

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

(async () => {
  const [email, name, role = 'receptionist'] = process.argv.slice(2);
  if (!email || !name) {
    console.error('Usage: npm run create-user -- email@example.com "First Last" [manager|receptionist]');
    process.exit(1);
  }
  const password = process.env.NEW_USER_PASSWORD || await askHidden('Password (min. 10 characters): ');
  const db = dbLib.open(config.dbPath, config.hotelName);
  try {
    auth.createUser(db, { email, name, password, role });
    console.log(`User ${email} (${role}) created.`);
  } catch (e) {
    console.error(e.message.includes('UNIQUE') ? 'This email already exists.' : e.message);
    process.exit(1);
  }
})();
