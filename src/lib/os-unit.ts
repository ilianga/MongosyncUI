import fs from "fs";
import path from "path";
import os from "os";

export const LAUNCHD_LABEL = "com.mongosyncui.app";

export function systemdUnit(opts: { execStart: string; workingDir: string }): string {
  return `[Unit]
Description=MongosyncUI
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${opts.workingDir}
ExecStart=${opts.execStart}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
}

export function launchdPlist(opts: { execArgs: string[]; workingDir: string; label: string }): string {
  const args = opts.execArgs.map((a) => `    <string>${a}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${opts.label}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key>
  <string>${opts.workingDir}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
`;
}

export function unitTargetPath(platform: NodeJS.Platform): string {
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
  }
  return path.join(os.homedir(), ".config", "systemd", "user", "mongosync-ui.service");
}

export function installBootService(): { path: string; followUp: string } {
  const target = unitTargetPath(process.platform);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const cwd = process.cwd();
  if (process.platform === "darwin") {
    const node = process.execPath;
    fs.writeFileSync(
      target,
      launchdPlist({ execArgs: [node, path.join(cwd, "node_modules/.bin/next"), "start"], workingDir: cwd, label: LAUNCHD_LABEL })
    );
    return { path: target, followUp: `launchctl load ${target}` };
  }
  const next = path.join(cwd, "node_modules/.bin/next");
  fs.writeFileSync(target, systemdUnit({ execStart: `${next} start`, workingDir: cwd }));
  return {
    path: target,
    followUp: "systemctl --user daemon-reload && systemctl --user enable --now mongosync-ui && loginctl enable-linger \"$USER\"",
  };
}

export function uninstallBootService(): { path: string; followUp: string } {
  const target = unitTargetPath(process.platform);
  fs.rmSync(target, { force: true });
  if (process.platform === "darwin") {
    return { path: target, followUp: `launchctl unload ${target} 2>/dev/null || true` };
  }
  return { path: target, followUp: "systemctl --user disable --now mongosync-ui 2>/dev/null || true" };
}

export function bootServiceStatus(): { installed: boolean; path: string } {
  const target = unitTargetPath(process.platform);
  return { installed: fs.existsSync(target), path: target };
}
