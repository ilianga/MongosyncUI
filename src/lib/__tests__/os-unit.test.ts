import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { systemdUnit, launchdPlist, unitTargetPath, LAUNCHD_LABEL } from "@/lib/os-unit";
import fs from "fs";
import path2 from "path";
import os2 from "os";

describe("os-unit generation", () => {
  it("systemd unit restarts on failure and starts at boot", () => {
    const u = systemdUnit({ execStart: "/usr/bin/npm run start", workingDir: "/srv/app" });
    expect(u).toContain("ExecStart=/usr/bin/npm run start");
    expect(u).toContain("WorkingDirectory=/srv/app");
    expect(u).toContain("Restart=on-failure");
    expect(u).toContain("WantedBy=default.target");
  });

  it("launchd plist runs at load and keeps alive", () => {
    const p = launchdPlist({ execArgs: ["/usr/bin/npm", "run", "start"], workingDir: "/srv/app", label: LAUNCHD_LABEL });
    expect(p).toContain("<key>RunAtLoad</key>");
    expect(p).toContain("<true/>");
    expect(p).toContain("<key>KeepAlive</key>");
    expect(p).toContain(LAUNCHD_LABEL);
    expect(p).toContain("<string>/usr/bin/npm</string>");
  });

  it("targets the right install path per platform", () => {
    expect(unitTargetPath("linux")).toContain(".config/systemd/user/mongosync-ui.service");
    expect(unitTargetPath("darwin")).toContain("Library/LaunchAgents/com.mongosyncui.app.plist");
  });
});

describe("boot service install", () => {
  let home: string, prevHome: string | undefined;
  beforeEach(() => {
    home = fs.mkdtempSync(path2.join(os2.tmpdir(), "home-"));
    prevHome = process.env.HOME; process.env.HOME = home;
    vi.resetModules();
  });
  afterEach(() => { process.env.HOME = prevHome; fs.rmSync(home, { recursive: true, force: true }); });

  it("install writes a unit file and status reports installed", async () => {
    const { installBootService, bootServiceStatus, uninstallBootService } = await import("@/lib/os-unit");
    expect(bootServiceStatus().installed).toBe(false);
    const { path: p } = installBootService();
    expect(fs.existsSync(p)).toBe(true);
    expect(bootServiceStatus().installed).toBe(true);
    uninstallBootService();
    expect(bootServiceStatus().installed).toBe(false);
  });
});
