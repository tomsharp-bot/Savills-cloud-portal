import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

const ROUNDS = 10;

export const MIN_PASSWORD_LENGTH = 10;

/**
 * Six-letter lowercase words for admin-issued temps (pronounceable).
 * Fixed length keeps `{word}.{word}.2468` consistent and easy to read aloud.
 */
const TEMP_WORDS = [
  "anchor",
  "banana",
  "beacon",
  "bridge",
  "bronze",
  "button",
  "cactus",
  "candle",
  "canvas",
  "castle",
  "celery",
  "chapel",
  "cherry",
  "cirrus",
  "citron",
  "clover",
  "cobalt",
  "copper",
  "cradle",
  "crater",
  "dancer",
  "dapper",
  "desert",
  "domain",
  "donkey",
  "dragon",
  "drawer",
  "driver",
  "echoes",
  "elbows",
  "engine",
  "falcon",
  "fennel",
  "ferris",
  "filter",
  "forest",
  "foster",
  "fridge",
  "galaxy",
  "garlic",
  "gentle",
  "ginger",
  "glider",
  "golden",
  "gravel",
  "guitar",
  "harbor",
  "helmet",
  "herald",
  "hockey",
  "hunter",
  "island",
  "jacket",
  "jasper",
  "jumper",
  "jungle",
  "kettle",
  "kitten",
  "ladder",
  "lizard",
  "magnet",
  "marble",
  "meadow",
  "meteor",
  "mirror",
  "monkey",
  "nebula",
  "nectar",
  "nickel",
  "nimble",
  "normal",
  "orange",
  "orchid",
  "oxygen",
  "palace",
  "parcel",
  "pepper",
  "pickle",
  "planet",
  "pocket",
  "ponder",
  "portal",
  "potato",
  "puzzle",
  "quartz",
  "rabbit",
  "radish",
  "ranger",
  "ribbon",
  "ripple",
  "rocket",
  "saddle",
  "salmon",
  "sandal",
  "saturn",
  "silver",
  "socket",
  "sphere",
  "spider",
  "spring",
  "square",
  "stable",
  "stream",
  "summer",
  "tablet",
  "temple",
  "timber",
  "tomato",
  "tunnel",
  "turtle",
  "valley",
  "velvet",
  "violet",
  "walnut",
  "willow",
  "window",
  "winter",
  "yellow",
  "zephyr",
  "zipper",
] as const;

if (TEMP_WORDS.some((w) => w.length !== 6)) {
  throw new Error("TEMP_WORDS must be exactly 6 letters each");
}

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

function pickTempWord(): string {
  return TEMP_WORDS[randomInt(TEMP_WORDS.length)];
}

/**
 * Admin-issued temporary password: two random 6-letter words + `.2468`.
 * Example: `orange.forest.2468`
 */
export function randomTempPassword(): string {
  let word1 = pickTempWord();
  let word2 = pickTempWord();
  // Prefer two different words when the list allows it.
  if (TEMP_WORDS.length > 1) {
    for (let i = 0; i < 8 && word2 === word1; i++) {
      word2 = pickTempWord();
    }
  }
  return `${word1}.${word2}.2468`;
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
