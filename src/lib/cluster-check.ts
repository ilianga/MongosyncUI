import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ClusterCheck {
  reachable: boolean;
  version?: string;
  error?: string;
}

export function parseMongoUri(uri: string): { hosts: string[] } {
  const withoutScheme = uri.replace(/^mongodb(\+srv)?:\/\//, "");
  const afterAuth = withoutScheme.includes("@")
    ? withoutScheme.slice(withoutScheme.indexOf("@") + 1)
    : withoutScheme;
  const hostPart = afterAuth.split("/")[0].split("?")[0];
  const hosts = hostPart.split(",").map((h) => {
    const trimmed = h.trim();
    return trimmed.includes(":") ? trimmed : `${trimmed}:27017`;
  });
  return { hosts };
}

function tcpProbe(host: string, port: number, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

export async function checkCluster(uri: string): Promise<ClusterCheck> {
  let hosts: string[];
  try {
    hosts = parseMongoUri(uri).hosts;
  } catch {
    return { reachable: false, error: "Could not parse URI" };
  }
  const [host, portStr] = hosts[0].split(":");
  const reachable = await tcpProbe(host, Number(portStr));
  if (!reachable) return { reachable: false, error: `Cannot reach ${hosts[0]}` };

  // Best-effort version read via mongosh if present; failure is non-fatal.
  try {
    const { stdout } = await execFileAsync(
      "mongosh",
      [uri, "--quiet", "--eval", "db.version()"],
      { timeout: 8000 }
    );
    return { reachable: true, version: stdout.trim() };
  } catch {
    return { reachable: true };
  }
}
