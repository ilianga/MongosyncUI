import { startPoller } from "./poller";

let initialized = false;

export function initApp(): void {
  if (initialized) return;
  initialized = true;
  startPoller();
}
