#!/usr/bin/env node
// Usage: node scripts/supervisor-cli.mjs <install|uninstall|status>
import { installBootService, uninstallBootService, bootServiceStatus } from "../src/lib/os-unit.ts";

const cmd = process.argv[2];
if (cmd === "install") {
  const { path, followUp } = installBootService();
  console.log(`Wrote boot service: ${path}\nNow run:\n  ${followUp}`);
} else if (cmd === "uninstall") {
  const { path, followUp } = uninstallBootService();
  console.log(`Removed boot service: ${path}\nCleanup:\n  ${followUp}`);
} else if (cmd === "status") {
  console.log(JSON.stringify(bootServiceStatus(), null, 2));
} else {
  console.error("Usage: supervisor-cli <install|uninstall|status>");
  process.exit(1);
}
