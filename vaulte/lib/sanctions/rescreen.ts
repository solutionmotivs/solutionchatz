// Daily re-screening of existing customers and their related people against the latest lists.
import { db } from "@/lib/db";
import { screenAndFlagEntity } from "./entities";
import { screenName } from "./screen";

export async function rescreenAll(): Promise<{ entities: number; people: number; newAlerts: number }> {
  let entities = 0, people = 0, newAlerts = 0;
  const before = await db.screeningCheck.count({ where: { status: "OPEN" } });

  for (let cursor: string | undefined; ;) {
    const batch = await db.entity.findMany({ where: { verificationStatus: { not: "REJECTED" }, screeningStatus: { not: "BLOCKED" } }, orderBy: { id: "asc" }, take: 500, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    if (!batch.length) break;
    for (const e of batch) { await screenAndFlagEntity(e, "RESCREEN"); entities++; }
    cursor = batch[batch.length - 1].id;
  }

  for (let cursor: string | undefined; ;) {
    const batch = await db.verificationPerson.findMany({
      where: { case: { status: "APPROVED" } }, include: { case: { select: { organizationId: true, entityId: true, id: true } } },
      orderBy: { id: "asc" }, take: 500, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!batch.length) break;
    for (const p of batch) {
      const r = await screenName(
        { name: p.fullName, country: p.nationality ?? p.countryOfResidence ?? undefined, kind: "INDIVIDUAL", dateOfBirth: p.dateOfBirth ?? undefined },
        { organizationId: p.case.organizationId, subjectType: "RESCREEN", subjectId: p.id },
      );
      people++;
      if (r.outcome !== "CLEAR" && p.case.entityId) {
        await db.entity.updateMany({ where: { id: p.case.entityId, screeningStatus: "CLEAR" }, data: { screeningStatus: r.outcome === "BLOCK" ? "BLOCKED" : "REVIEW" } });
      }
    }
    cursor = batch[batch.length - 1].id;
  }
  newAlerts = Math.max(0, (await db.screeningCheck.count({ where: { status: "OPEN" } })) - before);
  return { entities, people, newAlerts };
}
