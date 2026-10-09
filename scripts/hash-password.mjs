#!/usr/bin/env node
// Usage: node scripts/hash-password.mjs "your password"
// Prints a scrypt hash for USERS_JSON passwordHash fields.
import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-password.mjs "password"');
  process.exit(1);
}
const salt = randomBytes(16).toString("hex");
console.log(`scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`);
