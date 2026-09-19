import bcrypt from "bcryptjs";

const ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Mock rule: letters from the name + 2468 */
export function tempPassword(name: string): string {
  const letters = (name || "User").replace(/[^a-zA-Z]/g, "") || "User";
  return `${letters}2468`;
}
