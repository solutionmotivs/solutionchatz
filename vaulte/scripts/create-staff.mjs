// Create (or promote) a staff account. Staff must enable two-factor authentication at first sign-in.
// Usage: DATABASE_URL=... node scripts/create-staff.mjs staff@yourcompany.com "Full Name" [password]
// If no password is given, a random one is generated and printed once.
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const [email, name, passwordArg] = process.argv.slice(2);
if (!email || !name) {
  console.error('Usage: node scripts/create-staff.mjs <email> "<name>" [password]');
  process.exit(1);
}
const db = new PrismaClient();
const password = passwordArg ?? randomBytes(15).toString("base64url");

let org = await db.organization.findUnique({ where: { slug: "vaulte-staff" } });
org ??= await db.organization.create({ data: { name: "Vaulte Staff", slug: "vaulte-staff", country: "IN", accountType: "BUSINESS", kybStatus: "APPROVED", planId: "ENTERPRISE" } });
const passwordHash = await bcrypt.hash(password, 12);
const existing = await db.user.findUnique({ where: { email: email.toLowerCase() } });
if (existing) {
  await db.user.update({ where: { id: existing.id }, data: { isStaff: true, role: "ADMIN", organizationId: org.id, passwordHash, emailVerifiedAt: existing.emailVerifiedAt ?? new Date(), status: "ACTIVE" } });
} else {
  await db.user.create({ data: { email: email.toLowerCase(), name, passwordHash, role: "ADMIN", isStaff: true, organizationId: org.id, emailVerifiedAt: new Date(), passwordChangedAt: new Date() } });
}
console.log(`Staff account ready: ${email.toLowerCase()}`);
if (!passwordArg) console.log(`Temporary password (shown once): ${password}`);
console.log("Sign in, then enable two-factor authentication under Dashboard > Profile > Security. Staff tools require it.");
await db.$disconnect();
