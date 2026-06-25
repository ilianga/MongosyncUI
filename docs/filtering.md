# Namespace filtering

By default mongosync copies every user database and collection. To copy only a subset,
use the **Namespace filtering** section of the new migration form to build
**include** and **exclude** lists.

These map directly to mongosync's `includeNamespaces` and `excludeNamespaces` start
options, which are namespace-level only (no document filters).

## Building a filter

Each row in an include or exclude list has four inputs:

| Field | Description |
|---|---|
| **database** | Exact database name. |
| **database regex** | Regex pattern matching database names (used when **database** is blank). |
| **collections** | Comma-separated list of collection names. |
| **collections regex** | Regex pattern matching collection names. |

Rules the form applies:

- A row must specify **either** a database **or** a database regex; rows with neither are
  dropped. If both are filled, the exact **database** wins.
- **Collections** are split on commas and trimmed.
- A row with only a database (no collections) matches the whole database.

### Examples

- **Include one database:** add an include row with database `analytics`.
- **Include specific collections:** include row, database `app`, collections
  `users, orders, sessions`.
- **Include by pattern:** include row, database regex `^tenant_`, collections regex
  `^events_`.
- **Exclude a collection from an otherwise-full copy:** add an exclude row with database
  `app`, collections `audit_log`.

## Constraints

These come from mongosync and are enforced or surfaced by the app:

- **Namespace filtering is incompatible with reversible sync.** If you enable filters,
  you cannot enable **reversible** (and vice versa).
- You **cannot change filters after the sync starts.** Decide up front.
- You **cannot filter system namespaces.**
- For `mapReduce` / `$out`, you must filter at the **whole-database** level.
- Views and certain rename operations have additional limitations — see the
  [mongosync filtering docs](https://www.mongodb.com/docs/mongosync/current/reference/collection-level-filtering/).

## How filters affect monitoring

The source data size the app computes for the stable copy-progress bar respects your
exclude list — it sums only in-scope collections (skipping `admin`, `config`, `local`,
views, and `system.*`). So the progress bar reflects the data actually being copied.
