# Connections and authentication

MongosyncUI builds each cluster connection with a structured, Compass-style form. You
fill in scheme, hosts, auth, and TLS, and the app assembles a valid MongoDB connection
string. You can also paste a raw connection string instead.

The same builder is used in two places:

- The **new migration** form (source and destination).
- The **Connections** page, for saving reusable, colour-tagged connections.

## The connection builder

### Scheme and hosts

- **Scheme** — `mongodb` (default) or `mongodb+srv`.
- **Host(s)** — comma-separated `host:port` entries (for example
  `node1:27017, node2:27017, node3:27017`). At least one host is required unless you
  paste a raw connection string.

### Paste a connection string (advanced)

Open **Advanced: paste a connection string** and enter a full URI such as
`mongodb://user:pass@host:27017/?authSource=admin`. When this field is set it
**overrides all structured fields** — the app passes it through verbatim.

Use the structured fields whenever possible: they percent-encode credentials correctly
and keep passwords out of process listings (the migration runs from a YAML config file,
never CLI flags).

## Authentication methods

Choose the **Authentication method**. Each method collects different fields and maps to
a specific MongoDB auth mechanism.

| Method | UI fields | Mechanism / authSource |
|---|---|---|
| **None** | — | no auth |
| **Username / Password** | username, password, mechanism, authSource | `DEFAULT` / `SCRAM-SHA-1` / `SCRAM-SHA-256`; authSource you set (usually `admin`) |
| **X.509** | username (optional — taken from the cert if blank) | `MONGODB-X509`, `$external` |
| **Kerberos** | username (principal, e.g. `user@REALM`), service name (e.g. `mongodb`) | `GSSAPI`, `$external`, `SERVICE_NAME` property |
| **LDAP** | username, password | `PLAIN`, `$external` |
| **AWS IAM** | access key ID (username), secret key (password), session token (optional) | `MONGODB-AWS`, `$external`, `AWS_SESSION_TOKEN` property |
| **OIDC** | username (optional) | `MONGODB-OIDC` |

### Username / Password (SCRAM)

The most common case. Pick the SCRAM variant:

- **DEFAULT** — let the server negotiate (recommended).
- **SCRAM-SHA-256** — modern default for MongoDB 4.0+.
- **SCRAM-SHA-1** — legacy.

Set **authSource** to the database that holds the user (usually `admin`).

### X.509

Requires TLS with a client certificate. Enable TLS, upload the **Client Certificate
Key**, and (if it is encrypted) supply its password. Leave the username blank to derive
the user identity from the certificate subject.

### Kerberos / LDAP / AWS IAM

- **Kerberos** uses the `GSSAPI` mechanism. Enter the principal as the username and the
  Kerberos service name (commonly `mongodb`).
- **LDAP** uses the `PLAIN` mechanism over `$external`. Make sure TLS is enabled —
  `PLAIN` sends the password.
- **AWS IAM** uses `MONGODB-AWS`. Put the access key ID in the username field and the
  secret key in the password field; add a session token if you use temporary
  credentials.

### OIDC

OIDC uses `MONGODB-OIDC`. The builder shows a warning: interactive OIDC generally cannot
complete for an unattended `mongosync` process, because there is no human to perform the
device/browser login. Prefer a machine/workload identity flow if your provider supports
one.

## TLS / SSL

Open the **TLS / SSL** section and toggle **Enable TLS/SSL**. Then:

- **CA Certificate (.pem)** — upload your CA bundle for **self-signed** or private-CA
  deployments. The file is uploaded to the app and the resulting path is added to the
  connection as `tlsCAFile`.
- **Client Certificate Key (.pem)** — upload the combined client cert + key, used for
  **X.509** auth. Added as `tlsCertificateKeyFile`.
- **Client cert key password** — if the key is encrypted.
- **Allow invalid hostnames** — skip hostname verification.
- **Allow invalid certificates** — skip certificate validation entirely. This is
  **insecure** (man-in-the-middle risk) and is flagged in red. Prefer uploading the CA
  certificate instead.

### Where certificates are stored

Uploaded PEM files are staged under the data directory while you build the form, then
moved to a per-migration directory when the migration is created:

```
~/.mongosync-ui/certs/_staging/<token>/{ca,certKey}.pem   # while editing the form
~/.mongosync-ui/certs/<migrationId>/{ca,certKey}.pem        # after the migration is created
```

The connection string stored for the migration references the final per-migration paths.
Protect the data directory — it holds these PEMs and your stored credentials. See
[configuration.md](./configuration.md).

## Testing a connection

Click **Test** in the builder. The app builds the connection string and probes the
cluster (TCP reachability plus a `mongosh` handshake). It reports:

- **Reachable** with the detected MongoDB version and whether the node is a replica set.
- A **warning** (for example, a standalone node that is not a replica set).
- An **error** (for example, the host cannot be reached or auth failed).

For a full pre-start validation across both clusters, use the
[preflight check](./preflight.md) on the migration form instead.

## Saved connections

The **Connections** page lets you store reusable connections so you do not re-enter
credentials for every migration.

- Each saved connection has a **name**, a **colour tag** (one of: Green, Teal, Blue,
  Slate, Purple, Amber, Red, Pink — Green by default), and the full connection config.
- **Create / edit / delete** from the Connections page. Deleting a saved connection
  does not affect migrations that already used it — the migration keeps its own copy.
- In the migration form, use **Save as connection** to store the connection you just
  built, or pick an existing saved connection to pre-fill the builder.

Saved connections live in the `connections` table of `data.db` (the connection config is
stored as JSON, including any password — protect the data directory accordingly).
