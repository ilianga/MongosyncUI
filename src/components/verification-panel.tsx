"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { VerificationSide } from "@/lib/process-manager";

function Side({ title, side }: { title: string; side?: VerificationSide }) {
  if (!side) return null;

  const scanned = side.scannedCollectionCount ?? 0;
  const totalCols = side.totalCollectionCount ?? 0;
  const colPct = totalCols > 0 ? (scanned / totalCols) * 100 : 0;

  const hashed = side.hashedDocumentCount ?? 0;
  const estimated = side.estimatedDocumentCount ?? 0;
  const docPct = estimated > 0 ? (hashed / estimated) * 100 : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Collections scanned</p>
            <p className="font-mono text-xs text-muted-foreground">
              {scanned} / {totalCols}
            </p>
          </div>
          <Progress value={colPct} className="h-1.5" />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Docs hashed</p>
            <p className="font-mono text-xs text-muted-foreground">
              {hashed.toLocaleString()} / {estimated.toLocaleString()}
            </p>
          </div>
          <Progress value={docPct} className="h-1.5" />
        </div>

        <div className="flex gap-4 pt-1">
          <div>
            <p className="text-xs text-muted-foreground">Phase</p>
            <p className="font-mono text-xs">{side.phase ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Lag</p>
            <p className="font-mono text-xs">
              {side.lagTimeSeconds != null ? `${side.lagTimeSeconds}s` : "—"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Treat a verifier side as terminal/"completed" once it advertises a completed-ish phase.
function isSideComplete(side?: VerificationSide): boolean {
  const phase = (side?.phase ?? "").toLowerCase();
  return phase.includes("complete") || phase.includes("finished") || phase.includes("done");
}

// Headline trust line shown above the per-side detail: a loud green confirmation when both
// sides have hashed everything and matched, a progress line while running, otherwise nothing.
function VerificationHeadline({
  source,
  destination,
}: {
  source?: VerificationSide;
  destination?: VerificationSide;
}) {
  const sides = [source, destination].filter((s): s is VerificationSide => !!s);
  if (sides.length === 0) return null;

  const totalHashed = sides.reduce((n, s) => n + (s.hashedDocumentCount ?? 0), 0);
  const totalEstimated = sides.reduce((n, s) => n + (s.estimatedDocumentCount ?? 0), 0);
  const scanned = sides.reduce((n, s) => n + (s.scannedCollectionCount ?? 0), 0);
  const totalCols = sides.reduce((n, s) => n + (s.totalCollectionCount ?? 0), 0);

  const allComplete = sides.every(isSideComplete);
  const allHashed = sides.every(
    (s) => (s.hashedDocumentCount ?? 0) >= (s.estimatedDocumentCount ?? 0) && (s.hashedDocumentCount ?? 0) > 0,
  );

  if (allComplete && allHashed) {
    return (
      <div className="rounded-md border border-primary/40 bg-primary/10 px-4 py-3">
        <p className="text-sm font-semibold text-primary">
          ✅ Data verified — {totalHashed.toLocaleString()} documents hashed and matched
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border/60 px-4 py-3">
      <p className="text-sm font-medium">
        Verifying… {scanned} / {totalCols} collections, {totalHashed.toLocaleString()} /{" "}
        {totalEstimated.toLocaleString()} documents hashed
      </p>
    </div>
  );
}

export function VerificationPanel({
  verification,
}: {
  verification?: { source?: VerificationSide; destination?: VerificationSide };
}) {
  if (!verification || (!verification.source && !verification.destination)) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
        Embedded Verification
      </h3>
      <VerificationHeadline source={verification.source} destination={verification.destination} />
      <div className="grid gap-4 md:grid-cols-2">
        <Side title="Source" side={verification.source} />
        <Side title="Destination" side={verification.destination} />
      </div>
    </div>
  );
}
