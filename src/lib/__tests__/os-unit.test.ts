import { describe, it, expect } from "vitest";
import { systemdUnit, launchdPlist, unitTargetPath, LAUNCHD_LABEL } from "@/lib/os-unit";

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
