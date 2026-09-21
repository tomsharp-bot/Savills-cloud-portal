import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

const ROUNDS = 10;

export const MIN_PASSWORD_LENGTH = 10;

/** Unambiguous charset (no 0/O, 1/l/I) for admin-issued temps that people type. */
const TEMP_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Legacy mock rule: letters from the name + 2468. Kept for seeded demo accounts. */
export function tempPassword(name: string): string {
  const letters = (name || "User").replace(/[^a-zA-Z]/g, "") || "User";
  return `${letters}2468`;
}

/** Cryptographically random temporary password for admin create/reset. */
export function randomTempPassword(length = 12): string {
  const n = Math.max(length, MIN_PASSWORD_LENGTH);
  let out = "";
  for (let i = 0; i < n; i++) {
    out += TEMP_CHARS[randomInt(TEMP_CHARS.length)];
  }
  return out;
}

export async function issueTempPassword(): Promise<{ plain: string; hash: string }> {
  const plain = randomTempPassword();
  return { plain, hash: await hashPassword(plain) };
}

/** Server-side checks for self-service change password. Empty string = valid. */
export function newPasswordError(password: string, confirm: string): string {
  if (!password) return "Enter a new password.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirm) return "New password and confirmation do not match.";
  return "";
}
