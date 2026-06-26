import { getEventsForMigration } from "@/lib/db";
import { handle, jsonOk } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

// kind → human label. Inlined here (rather than importing @/lib/notifications) so this
// route never pulls in that module's server-only dependencies.
const KIND_LABELS: Record<string, string> = {
  REACHED_CAN_COMMIT: "Ready to commit",
  COMMITTED: "Cutover committed",
  CRASH_LOOPING: "Crash looping",
  LAG_SPIKE: "Lag spike",
  LOW_OPLOG: "Low oplog window",
  STATE_CHANGE: "State change",
};

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const events = getEventsForMigration(id).map((e) => ({
    id: e.id,
    kind: e.kind,
    label: KIND_LABELS[e.kind] ?? e.kind,
    message: e.message,
    createdAt: e.createdAt,
  }));
  return jsonOk({ events });
});
