// KYC/KYB case orchestration: collect, verify, risk-rate, review, and apply the decision.
import type { Prisma, VerificationCase } from "@prisma/client";
import { db } from "@/lib/db";
import { screenName } from "@/lib/sanctions/screen";
import { decryptString, encryptString, hmacHex, otpPepper } from "@/lib/security/crypto";
import { emitWebhookEvent } from "@/lib/webhooks/dispatch";
import { sendEmail } from "@/lib/email/sender";
import { verificationUpdateEmail } from "@/lib/email/templates";
import { activatePendingTransfers } from "@/lib/stablecoin/service";
import { getProvider, type CheckCode, type CheckResult } from "./providers";
import { type CaseKind, type Requirements, missingForSubmission, requirementsFor, validPurposes } from "./requirements";
import { approvalsNeeded, assessRisk, nextReviewDate, tierLimits, type Tier } from "./risk";
import { mask, normalise } from "./validators";

export class KycError extends Error {
  constructor(public code: string, message: string, public status = 400, public param?: string) { super(message); }
}

const EDITABLE = new Set(["DRAFT", "NEEDS_INFO"]);

export function assertEditable(c: Pick<VerificationCase, "status">) {
  if (!EDITABLE.has(c.status)) throw new KycError("CASE_LOCKED", "This verification is under review and cannot be edited", 409);
}

export type FullCase = Prisma.VerificationCaseGetPayload<{ include: { items: true; people: true; documents: true } }>;

export async function loadCase(id: string): Promise<FullCase | null> {
  return db.verificationCase.findUnique({ where: { id }, include: { items: true, people: true, documents: true } });
}

export function requirementsOfCase(c: Pick<VerificationCase, "kind" | "country" | "purposes">): Requirements {
  return requirementsFor(c.kind as CaseKind, c.country, c.purposes);
}

/** The customer-facing view: never includes encrypted values. */
export function presentCase(c: FullCase) {
  const req = requirementsOfCase(c);
  const missing = missingForSubmission(req, {
    profile: (c.profile ?? {}) as Record<string, unknown>,
    items: c.items, people: c.people, documents: c.documents,
  });
  return {
    id: c.id, kind: c.kind, subject_type: c.subjectType, entity_id: c.entityId, country: c.country, purposes: c.purposes,
    status: c.status, tier: c.tier, decision_note: c.decisionNote,
    limits: c.status === "APPROVED" ? tierLimits(c.kind as CaseKind, c.tier as Tier) : null,
    submitted_at: c.submittedAt, decided_at: c.decidedAt, next_review_at: c.nextReviewAt,
    profile: c.profile,
    items: c.items.map(i => ({ code: i.code, masked: i.valueMasked, status: i.status, provider: i.provider, details: i.result, verified_at: i.verifiedAt })),
    people: c.people.map(p => ({
      id: p.id, role: p.role, full_name: p.fullName, date_of_birth: p.dateOfBirth, nationality: p.nationality, country_of_residence: p.countryOfResidence,
      ownership_pct: p.ownershipPct, is_pep: p.isPep, pan_masked: p.panMasked, pan_status: p.panStatus, id_type: p.idType,
    })),
    documents: c.documents.map(d => ({ id: d.id, type: d.type, person_id: d.personId, filename: d.filename, size: d.size, status: d.status, reject_reason: d.rejectReason, uploaded_at: d.createdAt })),
    requirements: { profile: req.profile, items: req.items.map(({ validate: _v, ...r }) => r), documents: req.documents, people: req.people, ubo_threshold_pct: req.uboThresholdPct, notes: req.notes },
    missing,
  };
}

export async function createCase(opts: { organizationId: string; entityId?: string; purposes: string[]; actorId?: string }): Promise<FullCase> {
  const org = await db.organization.findUnique({ where: { id: opts.organizationId } });
  if (!org) throw new KycError("NOT_FOUND", "Organization not found", 404);
  let kind: CaseKind; let country: string; let entityId: string | undefined;
  if (opts.entityId) {
    const e = await db.entity.findFirst({ where: { id: opts.entityId, organizationId: org.id } });
    if (!e) throw new KycError("NOT_FOUND", "Entity not found", 404);
    kind = e.entityType === "INDIVIDUAL" ? "KYC" : "KYB"; country = e.country; entityId = e.id;
  } else {
    kind = org.accountType === "INDIVIDUAL" ? "KYC" : "KYB";
    country = org.country ?? "";
  }
  if (!/^[A-Z]{2}$/.test(country)) throw new KycError("COUNTRY_REQUIRED", "A country is required before verification can start", 400);
  const allowed = validPurposes(kind);
  const purposes = Array.from(new Set(opts.purposes));
  if (!purposes.length || purposes.some(p => !allowed.includes(p))) throw new KycError("INVALID_PURPOSE", `Choose one or more purposes from: ${allowed.join(", ")}`, 400, "purposes");

  // One open case per subject: continue the existing draft instead of starting another.
  const open = await db.verificationCase.findFirst({
    where: { organizationId: org.id, entityId: entityId ?? null, status: { in: ["DRAFT", "NEEDS_INFO", "SUBMITTED", "IN_REVIEW"] } },
    include: { items: true, people: true, documents: true },
  });
  if (open) return open;

  const created = await db.verificationCase.create({
    data: {
      kind, subjectType: entityId ? "ENTITY" : "ORGANIZATION", country, purposes, organizationId: org.id, entityId: entityId ?? null,
      profile: entityId ? { legal_name: (await db.entity.findUnique({ where: { id: entityId } }))?.legalName } : { legal_name: org.legalName ?? org.name },
    },
    include: { items: true, people: true, documents: true },
  });
  await audit(org.id, opts.actorId, "verification.created", created.id, { kind, country, purposes });
  return created;
}

export async function audit(organizationId: string, userId: string | undefined, action: string, resourceId: string, metadata: Record<string, unknown> = {}) {
  await db.auditLog.create({ data: { organizationId, userId: userId ?? null, action, resourceType: "VerificationCase", resourceId, metadata: metadata as Prisma.InputJsonValue } });
}

export async function setProfile(c: FullCase, patch: Record<string, unknown>) {
  assertEditable(c);
  const req = requirementsOfCase(c);
  const allowed = new Map(req.profile.map(f => [f.key, f]));
  const next: Record<string, unknown> = { ...((c.profile ?? {}) as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    const f = allowed.get(k);
    if (!f) throw new KycError("UNKNOWN_FIELD", `Unknown field "${k}"`, 400, k);
    if (v === null || v === "") { delete next[k]; continue; }
    if (f.type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1e12) throw new KycError("INVALID_VALUE", `${f.label} must be a positive number`, 400, k);
      next[k] = n;
    } else if (f.type === "date") {
      const d = new Date(String(v));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || isNaN(d.getTime()) || d.getTime() > Date.now()) throw new KycError("INVALID_VALUE", `${f.label} must be a past date (YYYY-MM-DD)`, 400, k);
      next[k] = String(v);
    } else if (f.type === "select" && f.options && !f.options.includes(String(v))) {
      throw new KycError("INVALID_VALUE", `${f.label} must be one of: ${f.options.join(", ")}`, 400, k);
    } else {
      const s = String(v).trim();
      if (s.length > 500) throw new KycError("INVALID_VALUE", `${f.label} is too long`, 400, k);
      next[k] = s;
    }
  }
  await db.verificationCase.update({ where: { id: c.id }, data: { profile: next as Prisma.InputJsonValue } });
}

function ddmmyyyy(iso?: string | null): string | undefined {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function subjectNameAndDob(c: FullCase): { name?: string; dob?: string } {
  const p = (c.profile ?? {}) as Record<string, any>;
  if (c.kind === "KYB") return { name: p.legal_name, dob: ddmmyyyy(p.incorporation_date) };
  const a = c.people.find(x => x.role === "APPLICANT");
  return { name: a?.fullName, dob: ddmmyyyy(a?.dateOfBirth) };
}

async function runCheck(code: CheckCode, value: string, c: FullCase, nameOverride?: { name?: string; dob?: string }): Promise<CheckResult | null> {
  const provider = getProvider();
  if (!provider || !provider.supports(code, c.country)) return null;
  const sub = nameOverride ?? subjectNameAndDob(c);
  return provider.verify({ code, value, country: c.country, name: sub.name, dateOfBirth: sub.dob, holder: c.kind === "KYB" ? "BUSINESS" : "INDIVIDUAL" });
}

/** Store an identifier (encrypted) and, where a provider supports it, check it right away. */
export async function setItem(c: FullCase, code: string, rawValue: string) {
  assertEditable(c);
  const spec = requirementsOfCase(c).items.find(i => i.code === code);
  if (!spec) throw new KycError("UNKNOWN_ITEM", `"${code}" is not requested for this verification`, 404);
  const value = code === "BANK_ACCOUNT" ? rawValue.split("|").map(s => normalise(s)).join("|") : spec.code === "EIN" ? rawValue.trim() : normalise(rawValue);
  const err = spec.validate(value);
  if (err) throw new KycError("INVALID_IDENTIFIER", err, 400, code);

  const result = spec.autoVerifiable ? await runCheck(code as CheckCode, value, c) : null;
  const status = !result ? "MANUAL" : result.status === "VERIFIED" ? "VERIFIED" : result.status === "FAILED" ? "FAILED" : "MANUAL";
  const hash = hmacHex(otpPepper(), `kyc:${code}:${value}`);
  const data = {
    valueEnc: encryptString(value), valueMasked: mask(value.replace("|", "")), valueHash: hash, status,
    provider: result?.provider ?? null, providerRef: result?.providerRef ?? null,
    result: (result ? { ...result.details, reason: result.reason } : { note: "Awaiting manual review" }) as Prisma.InputJsonValue,
    verifiedAt: status === "VERIFIED" ? new Date() : null,
  };
  await db.verificationItem.upsert({ where: { caseId_code: { caseId: c.id, code } }, create: { caseId: c.id, code, ...data }, update: data });
  await audit(c.organizationId, undefined, "verification.item_set", c.id, { code, status });
  return { code, status, reason: result?.reason };
}

export interface PersonInput {
  role: "APPLICANT" | "UBO" | "DIRECTOR" | "SIGNATORY";
  full_name: string; date_of_birth?: string; nationality?: string; country_of_residence?: string;
  ownership_pct?: number; is_pep?: boolean; pan?: string; id_type?: string;
}

export async function addPerson(c: FullCase, input: PersonInput) {
  assertEditable(c);
  const req = requirementsOfCase(c);
  if (!req.people.some(p => p.role === input.role)) throw new KycError("INVALID_ROLE", `${input.role} is not used in this verification`, 400, "role");
  if (c.people.length >= 25) throw new KycError("LIMIT", "A verification can list at most 25 people", 400);
  if (input.role === "APPLICANT" && c.people.some(p => p.role === "APPLICANT")) throw new KycError("DUPLICATE", "The applicant is already added; edit or remove them first", 409);
  if (input.role === "UBO" && (input.ownership_pct === undefined || input.ownership_pct <= 0 || input.ownership_pct > 100)) {
    throw new KycError("INVALID_VALUE", "Ownership must be between 0 and 100 percent", 400, "ownership_pct");
  }
  let panEnc: string | null = null, panMasked: string | null = null;
  if (input.pan) {
    const { validatePan } = await import("./validators");
    const pan = normalise(input.pan);
    const e = validatePan(pan, "INDIVIDUAL");
    if (e) throw new KycError("INVALID_IDENTIFIER", e, 400, "pan");
    panEnc = encryptString(pan); panMasked = mask(pan);
  }
  return db.verificationPerson.create({
    data: {
      caseId: c.id, role: input.role, fullName: input.full_name.trim(), dateOfBirth: input.date_of_birth ?? null,
      nationality: input.nationality?.toUpperCase() ?? null, countryOfResidence: input.country_of_residence?.toUpperCase() ?? null,
      ownershipPct: input.ownership_pct ?? null, isPep: !!input.is_pep, panEnc, panMasked, idType: input.id_type ?? null,
    },
  });
}

export async function removePerson(c: FullCase, personId: string) {
  assertEditable(c);
  const p = c.people.find(x => x.id === personId);
  if (!p) throw new KycError("NOT_FOUND", "Person not found", 404);
  await db.verificationPerson.delete({ where: { id: personId } });
}

/** Screen subject + people, verify person PANs, score risk, move the case into the review queue. */
export async function submitCase(c: FullCase, actorId?: string) {
  assertEditable(c);
  const req = requirementsOfCase(c);
  const missing = missingForSubmission(req, { profile: (c.profile ?? {}) as Record<string, unknown>, items: c.items, people: c.people, documents: c.documents });
  if (missing.length) throw new KycError("INCOMPLETE", `Still needed: ${missing.map(m => m.label).join("; ")}`, 422);
  const profile = (c.profile ?? {}) as Record<string, any>;

  // Person PAN checks (name + date of birth against the PAN record).
  for (const p of c.people) {
    if (!p.panEnc) continue;
    const r = await runCheck("PAN", decryptString(p.panEnc), c, { name: p.fullName, dob: ddmmyyyy(p.dateOfBirth) });
    await db.verificationPerson.update({ where: { id: p.id }, data: { panStatus: r?.status === "VERIFIED" ? "VERIFIED" : r?.status === "FAILED" ? "FAILED" : "MANUAL" } });
  }

  // Sanctions / PEP name screening of the subject and everyone listed.
  const subjects: { name: string; country: string; kind: "INDIVIDUAL" | "ENTITY"; dob?: string; type: "CASE_SUBJECT" | "CASE_PERSON"; id: string }[] = [];
  if (c.kind === "KYB" && profile.legal_name) subjects.push({ name: profile.legal_name, country: c.country, kind: "ENTITY", type: "CASE_SUBJECT", id: c.id });
  for (const p of c.people) subjects.push({ name: p.fullName, country: p.nationality ?? p.countryOfResidence ?? c.country, kind: "INDIVIDUAL", dob: p.dateOfBirth ?? undefined, type: "CASE_PERSON", id: p.id });
  let screening: "CLEAR" | "REVIEW" | "BLOCK" = "CLEAR";
  const hits: { name: string; match: string; lists: string[]; score: number; check_id?: string }[] = [];
  for (const n of subjects) {
    const r = await screenName({ name: n.name, country: n.country, kind: n.kind, dateOfBirth: n.dob }, { organizationId: c.organizationId, subjectType: n.type, subjectId: n.id });
    if (r.outcome === "BLOCK") screening = "BLOCK";
    else if (r.outcome === "REVIEW" && screening !== "BLOCK") screening = "REVIEW";
    if (r.outcome !== "CLEAR") hits.push({ name: n.name, match: r.outcome === "BLOCK" ? "CONFIRMED_MATCH" : "POTENTIAL_MATCH", lists: Array.from(new Set(r.matches.map(m => m.list))), score: r.topScore, check_id: r.checkId });
  }

  const fresh = (await loadCase(c.id))!;
  const risk = assessRisk({
    kind: c.kind as CaseKind, country: c.country, purposes: c.purposes, industry: profile.industry, expectedMonthlyUsd: profile.expected_monthly_usd,
    incorporationDate: profile.incorporation_date,
    people: fresh.people.map(p => ({ role: p.role, isPep: p.isPep, nationality: p.nationality, countryOfResidence: p.countryOfResidence, ownershipPct: p.ownershipPct })),
    items: fresh.items, screening,
  });

  // The same PAN/EIN already approved under a different organization is a duplicate-account signal.
  const dupes = await db.verificationItem.count({
    where: { valueHash: { in: fresh.items.filter(i => ["PAN", "EIN", "REG_NO", "CIN"].includes(i.code)).map(i => i.valueHash) }, case: { organizationId: { not: c.organizationId }, status: "APPROVED" } },
  });
  if (dupes) { risk.factors.push({ code: "DUPLICATE_IDENTIFIER", points: 20, detail: "An identifier is already approved under another account" }); risk.score = Math.min(100, risk.score + 20); }

  await db.verificationCase.update({
    where: { id: c.id },
    data: {
      status: "IN_REVIEW", submittedAt: new Date(), tier: risk.tier, riskScore: risk.score, riskFactors: risk.factors as unknown as Prisma.InputJsonValue,
      screening: { result: screening, hits, blocked: risk.blocked } as Prisma.InputJsonValue, approvals: [], decisionNote: null,
    },
  });
  if (c.subjectType === "ORGANIZATION") {
    await db.organization.update({ where: { id: c.organizationId }, data: { kybStatus: "IN_REVIEW", kybSubmittedAt: new Date(), onboardingStep: "KYB_SUBMIT" } });
  } else if (c.entityId) {
    await db.entity.update({ where: { id: c.entityId }, data: { verificationStatus: "IN_REVIEW" } });
  }
  await audit(c.organizationId, actorId, "verification.submitted", c.id, { tier: risk.tier, score: risk.score, screening });
  return { status: "IN_REVIEW" as const, tier: risk.tier, blocked: risk.blocked };
}

export type Decision = "APPROVE" | "REJECT" | "REQUEST_INFO";

/** Staff decision. EDD cases need two different approvers; blocked cases can only be rejected. */
export async function decideCase(c: FullCase, staff: { id: string; name: string }, decision: Decision, note?: string) {
  if (c.status !== "IN_REVIEW") throw new KycError("NOT_IN_REVIEW", "Only cases in review can be decided", 409);
  if (decision !== "APPROVE" && !note?.trim()) throw new KycError("NOTE_REQUIRED", "A note is required when rejecting or requesting information", 400, "note");
  const screening = (c.screening ?? {}) as { blocked?: boolean; result?: string };
  const orgOwner = await db.user.findFirst({ where: { organizationId: c.organizationId, role: "OWNER" }, select: { email: true, name: true } });
  const subjectName = ((c.profile ?? {}) as Record<string, any>).legal_name ?? c.people.find(p => p.role === "APPLICANT")?.fullName ?? "your account";

  if (decision === "APPROVE") {
    if (screening.blocked) throw new KycError("SCREENING_BLOCK", "This case matches a sanctions list or prohibited jurisdiction and cannot be approved", 409);
    if (c.items.some(i => i.status === "FAILED")) throw new KycError("ITEM_FAILED", "An identifier failed verification; request corrected information", 409);
    const open = c.documents.filter(d => d.status === "UPLOADED").length;
    if (open) throw new KycError("DOCUMENTS_UNREVIEWED", `${open} document(s) have not been accepted or rejected yet`, 409);
    const approvals = ((c.approvals ?? []) as { staffId: string; at: string }[]);
    if (approvals.some(a => a.staffId === staff.id)) throw new KycError("ALREADY_APPROVED", "You have already approved this case; a different reviewer must give the second approval", 409);
    const next = [...approvals, { staffId: staff.id, at: new Date().toISOString() }];
    if (next.length < approvalsNeeded(c.tier as Tier)) {
      await db.verificationCase.update({ where: { id: c.id }, data: { approvals: next, decisionNote: note ?? null } });
      await audit(c.organizationId, staff.id, "verification.first_approval", c.id, { note });
      return { status: "IN_REVIEW" as const, approvals: next.length, needed: approvalsNeeded(c.tier as Tier) };
    }
    await db.verificationCase.update({
      where: { id: c.id },
      data: { status: "APPROVED", decidedAt: new Date(), decidedById: staff.id, decisionNote: note ?? null, approvals: next, nextReviewAt: nextReviewDate(c.tier as Tier) },
    });
    await applyOutcome(c, "APPROVED");
  } else if (decision === "REJECT") {
    await db.verificationCase.update({ where: { id: c.id }, data: { status: "REJECTED", decidedAt: new Date(), decidedById: staff.id, decisionNote: note! } });
    await applyOutcome(c, "REJECTED");
  } else {
    await db.verificationCase.update({ where: { id: c.id }, data: { status: "NEEDS_INFO", decidedById: staff.id, decisionNote: note!, approvals: [] } });
    await applyOutcome(c, "NEEDS_INFO");
  }
  const status = decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "NEEDS_INFO";
  await audit(c.organizationId, staff.id, `verification.${status.toLowerCase()}`, c.id, { note, tier: c.tier });
  if (orgOwner) {
    await sendEmail({ to: orgOwner.email, organizationId: c.organizationId, template: verificationUpdateEmail({ name: orgOwner.name, subjectName, kind: c.kind as CaseKind, status, note, caseId: c.id }) }).catch(() => {});
  }
  await emitWebhookEvent({
    organizationId: c.organizationId, event: `${c.kind.toLowerCase()}.${status === "NEEDS_INFO" ? "needs_info" : status.toLowerCase()}`,
    data: { case_id: c.id, subject_type: c.subjectType, entity_id: c.entityId, status, tier: status === "APPROVED" ? c.tier : null },
  }).catch(() => {});
  return { status: status as "APPROVED" | "REJECTED" | "NEEDS_INFO" };
}

async function applyOutcome(c: FullCase, outcome: "APPROVED" | "REJECTED" | "NEEDS_INFO") {
  const profile = (c.profile ?? {}) as Record<string, any>;
  const status = outcome === "NEEDS_INFO" ? "NEEDS_MORE_INFO" : outcome;
  if (c.subjectType === "ORGANIZATION") {
    const lim = tierLimits(c.kind as CaseKind, c.tier as Tier);
    const regNo = c.items.find(i => i.code === "CIN" || i.code === "REG_NO" || i.code === "EIN");
    await db.organization.update({
      where: { id: c.organizationId },
      data: {
        kybStatus: status,
        ...(outcome === "APPROVED" ? {
          kybApprovedAt: new Date(), riskScore: c.riskScore, riskTier: c.tier === "EDD" ? "HIGH" : c.tier === "SDD" ? "LOW" : "MEDIUM",
          dailyLimitUsd: BigInt(lim.dailyUsd) * 100n, monthlyLimitUsd: BigInt(lim.monthlyUsd) * 100n,
          ...(c.kind === "KYB" ? { legalName: profile.legal_name, businessType: profile.business_type, registrationNumber: regNo ? decryptString(regNo.valueEnc) : undefined, incorporationDate: profile.incorporation_date ? new Date(profile.incorporation_date) : undefined } : {}),
        } : {}),
      },
    });
  } else if (c.entityId) {
    const pan = c.items.find(i => i.code === "PAN");
    await db.entity.update({
      where: { id: c.entityId },
      data: { verificationStatus: status, isVerified: outcome === "APPROVED", verificationRef: c.id, ...(outcome === "APPROVED" && pan && ["VERIFIED", "MANUAL"].includes(pan.status) ? { panVerified: true } : {}) },
    });
    if (outcome === "APPROVED") await activatePendingTransfers(c.entityId);
  }
}
