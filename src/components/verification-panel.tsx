"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { VerificationSide } from "@/lib/process-manager";

function Side({ title, side }: { title: string; side?: VerificationSide }) {
  if (!side) return null;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-1 text-xs text-muted-foreground">
        <div>Phase: {side.phase ?? "—"}</div>
        <div>Collections: {side.scannedCollectionCount ?? 0} / {side.totalCollectionCount ?? 0}</div>
        <div>Docs hashed: {(side.hashedDocumentCount ?? 0).toLocaleString()} / {(side.estimatedDocumentCount ?? 0).toLocaleString()}</div>
        <div>Lag: {side.lagTimeSeconds != null ? `${side.lagTimeSeconds}s` : "—"}</div>
      </CardContent>
    </Card>
  );
}

export function VerificationPanel({
  verification,
}: {
  verification?: { source?: VerificationSide; destination?: VerificationSide };
}) {
  if (!verification || (!verification.source && !verification.destination)) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Embedded Verification</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <Side title="Source" side={verification.source} />
        <Side title="Destination" side={verification.destination} />
      </div>
    </div>
  );
}
