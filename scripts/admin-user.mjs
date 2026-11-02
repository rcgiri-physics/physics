#!/usr/bin/env node
// Create an admin account entry for the ADMIN_USERS secret.
//   node scripts/admin-user.mjs <username> "<Full name>" [admin|editor] [--totp]
// It asks for the password (not shown, not saved anywhere), and prints the JSON to put in ADMIN_USERS.
// With --totp it also creates a two-factor secret: add it to Google Authenticator / Aegis / 1Password.
import { hashPassword } from '../worker/auth.js';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';

const [username, name, roleArg] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const wantTotp = process.argv.includes('--totp');
if (!username || !/^[a-z0-9._-]{3,30}$/i.test(username)) {
  console.error('Usage: node scripts/admin-user.mjs <username> "<Full name>" [admin|editor] [--totp]');
  process.exit(1);
}
const role = roleArg === 'editor' ? 'editor' : 'admin';

function ask(question) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (!rl.muted) rl.output.write(s); };
    rl.question(question, answer => { rl.close(); process.stdout.write('\n'); resolve(answer); });
    rl.muted = true;
  });
}

const password = process.env.ADMIN_PASSWORD || await ask(`Password for ${username} (min 12 characters): `);
if (password.length < 12) { console.error('Use at least 12 characters.'); process.exit(1); }
const entry = { username, name: name || username, role, password: await hashPassword(password) };
if (wantTotp) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  entry.totp = [...randomBytes(20)].map(b => alphabet[b % 32]).join('');
  console.log(`\nTwo-factor secret: ${entry.totp}`);
  console.log(`Or scan: otpauth://totp/PhysicsDecoded:${encodeURIComponent(username)}?secret=${entry.totp}&issuer=PhysicsDecoded\n`);
}
console.log('Add this object to the ADMIN_USERS JSON array (npx wrangler secret put ADMIN_USERS):\n');
console.log(JSON.stringify(entry));
