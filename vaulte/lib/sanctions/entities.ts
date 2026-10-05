// Screens a stored party (Entity) and keeps its screeningStatus in step. Used on creation, per transfer, and in the daily rescreen.
import { db } from "@/lib/db";
import { screenName, type Ctx } from "./screen";

export type PartyOutcome = "CLEAR" | "REVIEW" | "BLOCK";

export async function screenAndFlagEntity(
  e: { id: string; legalName: string; country: string; entityType: string; organizationId: string; screeningStatus?: string },
  subjectType: Ctx["subjectType"] = "ENTITY",
): Promise<PartyOutcome> {
  const r = await screenName(
    { name: e.legalName, country: e.country, kind: e.entityType === "INDIVIDUAL" ? "INDIVIDUAL" : "ENTITY" },
    { organizationId: e.organizationId, subjectType, subjectId: e.id },
  );
  const current = e.screeningStatus ?? (await db.entity.findUnique({ where: { id: e.id }, select: { screeningStatus: true } }))?.screeningStatus ?? "CLEAR";
  if (r.outcome === "BLOCK" && current !== "BLOCKED") {
    await db.entity.update({ where: { id: e.id }, data: { screeningStatus: "BLOCKED", isVerified: false } });
  } else if (r.outcome === "REVIEW" && current === "CLEAR") {
    await db.entity.update({ where: { id: e.id }, data: { screeningStatus: "REVIEW" } });
  }
  return r.outcome;
}
