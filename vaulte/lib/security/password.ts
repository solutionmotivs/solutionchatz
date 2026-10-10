import bcrypt from "bcryptjs";

const COMMON = new Set([
  "password", "password1", "password123", "passw0rd", "qwerty123", "qwertyuiop", "1234567890", "0123456789", "letmein123",
  "welcome123", "iloveyou12", "admin12345", "administrator", "changeme123", "abc123456", "11111111111", "monkey1234", "dragon1234",
  "football123", "baseball123", "sunshine123", "princess123", "trustno1234", "vaulte12345", "vaultepassword",
]);

export interface PasswordContext {
  email?: string;
  name?: string;
}

/** NIST-style policy: length first, no composition rules, block trivial/common/personal values. */
export function validatePassword(pw: string, ctx: PasswordContext = {}): string | null {
  if (pw.length < 10) return "Password must be at least 10 characters";
  if (pw.length > 128) return "Password must be at most 128 characters";
  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) return "That password is too common";
  if (/^(.)\1+$/.test(pw)) return "Password cannot be a single repeated character";
  if (/^(0123456789|1234567890|abcdefghij|qwertyuiop)/i.test(pw)) return "Password is too easy to guess";
  if (ctx.email) {
    const local = ctx.email.split("@")[0].toLowerCase();
    if (local.length >= 4 && lower.includes(local)) return "Password must not contain your email name";
  }
  if (ctx.name) {
    for (const part of ctx.name.toLowerCase().split(/\s+/)) {
      if (part.length >= 4 && lower.includes(part)) return "Password must not contain your name";
    }
  }
  return null;
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);
/** Constant-ish time failure path for unknown users, to avoid revealing which emails exist. */
export const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEeO7Z7yFvOJt7xYbZ9QZQ5vZtqJ8E0rYhC";
