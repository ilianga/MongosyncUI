import { getSetting } from "./db";
import type { SupervisionConfig } from "./types";

function num(key: string, fallback: number): number {
  const raw = getSetting(key);
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getSupervisionConfig(): SupervisionConfig {
  return {
    mode: getSetting("supervisionMode") === "legacy" ? "legacy" : "supervised",
    backoffCapSec: num("backoffCapSec", 60),
    crashLoopMax: num("crashLoopMax", 5),
    crashLoopWindowSec: num("crashLoopWindowSec", 300),
    hungTicks: num("hungTicks", 6),
  };
}
