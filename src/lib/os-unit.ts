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
