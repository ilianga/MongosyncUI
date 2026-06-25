# Configuration

MongosyncUI is configured through a handful of environment variables and the in-app
**Settings** page. App settings are stored in SQLite, not in a config file.

## Environment variables

| Variable | Required? | Default | Description |
|---|---|---|---|
| `MSYNC_AUTH_SECRET` | **For any non-localhost use** | a dev fallback secret | Secret used to sign the session cookie. With the fallback, sessions are forgeable off-localhost. Generate with `openssl rand -hex 32`. |
| `MONGOSYNC_UI_DIR` | No | `~/.mongosync-ui` | Override the data directory. |

There is **no port env var** — set the HTTP port via the Next.js flag:

```bash
npm run dev -- -p 4000
npm run start -- -p 4000
```

Generate a strong secret:

```bash
export MSYNC_AUTH_SECRET="$(openssl rand -hex 32)"
```

## Settings page

Open **Settings** in the app. Everything here is stored in the `settings` table of
`data.db`.

### Security

Change the app **username** and **password** (you must enter the current password).
Defaults are `admin` / `admin`. The password is stored as a salted scrypt hash; the
session cookie is `msync_session` (httpOnly, 7-day lifetime).

### Mongosync binary (`mongosyncPath`)

Path to the `mongosync` executable, or a directory containing it. Blank = use `mongosync`
from `PATH`. **Test** reads the version. Verified automatically on save.

### Process & polling

| Setting | Key | Default | Notes |
|---|---|---|---|
| Base port | `basePort` | `27182` | Port for the first migration; later migrations auto-increment. |
| Poll interval | `pollInterval` | `5000` ms | Time between progress polls. |

### New migration defaults

These pre-fill the new migration form.

| Setting | Key | Default |
|---|---|---|
| Load level | `defaultLoadLevel` | `3` (1–4) |
| Verbosity | `defaultVerbosity` | `INFO` |
| Verification | `defaultVerification` | `true` |
| Disable telemetry | `defaultDisableTelemetry` | `false` |

### Supervision & fault tolerance

See [migrations.md](./migrations.md#supervision-and-fault-tolerance) for behavior.

| Setting | Key | Default |
|---|---|---|
| Supervision mode | `supervisionMode` | `supervised` (`legacy` to disable tmux/auto-restart) |
| Hung ticks | `hungTicks` | `6` |
| Backoff cap (s) | `backoffCapSec` | `60` |
| Crash-loop max | `crashLoopMax` | `5` |
| Crash-loop window (s) | `crashLoopWindowSec` | `300` |

### Boot service

Install a **launchd agent** (macOS) or **systemd `--user` unit** (Linux) so the app
starts at boot and reconciliation rebuilds sessions after a reboot. After installing, the
app shows a follow-up command to finish enabling the service:

- **macOS:** `launchctl load ~/Library/LaunchAgents/com.mongosyncui.app.plist`
- **Linux:**
  ```bash
  systemctl --user daemon-reload
  systemctl --user enable --now mongosync-ui
  loginctl enable-linger "$USER"     # keep the user service running after logout
  ```

## Data directory layout

All runtime data lives under the data directory (`~/.mongosync-ui` by default). It is
created on first use; delete it to reset the app.

```
~/.mongosync-ui/
  data.db                       # SQLite: migrations, connections, settings, metrics
  configs/<id>.yaml             # generated mongosync config per migration
  certs/<id>/{ca,certKey}.pem   # uploaded TLS certs per migration
  certs/_staging/<token>/...    # certs staged while editing a form
  logs/<id>/mongosync.log       # structured mongosync log
  logs/<id>/stdout.log          # wrapper stdout/stderr
  supervision/<id>/status.json  # wrapper status (attempt, lastExitCode, state)
  supervision/<id>/stop         # sentinel file; presence means "stop"
```

Connection strings and options are written to the YAML config (never CLI flags), so
passwords do not leak to process listings. The data directory holds credentials and
certificates — protect it and never commit it.

## Health endpoint

`GET /api/health` is a lightweight liveness/readiness probe (it does not require a
session). It always returns HTTP 200 with:

```json
{ "ok": true, "time": "<ISO8601>", "mongosyncDetected": true, "dbOk": true }
```

- `mongosyncDetected` — whether a `mongosyncPath` setting is configured.
- `dbOk` — whether the SQLite database is open and queryable.
