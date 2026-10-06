# ADR 002: SQLite (node:sqlite) Over better-sqlite3 / libsql

**Date**: 2026-10-06
**Status**: Accepted

## Context

Need embedded SQL database for:
- Local development (persistent file)
- Vercel deployment (ephemeral `/tmp`)
- Zero native dependencies (Vercel build environment)

Options:
- `better-sqlite3` — native C++ addon, requires `node-gyp`, Python, build tools
- `@libsql/client` — HTTP client for Turso, extra hop, not embedded
- `node:sqlite` (`DatabaseSync`) — built into Node 22.5+ / 26, zero deps, synchronous API

## Decision

Use **`node:sqlite` `DatabaseSync`** (Node 22.5+).

```typescript
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("./.data/veriflow.db");
db.exec("PRAGMA busy_timeout = 10000; PRAGMA journal_mode = WAL;");
```

## Consequences

| Positive | Negative |
|----------|----------|
| Zero native deps — works on Vercel build | Synchronous only (blocks event loop) |
| No `node-gyp` / Python / toolchain | Node < 22.5 unsupported |
| WAL mode + busy_timeout = concurrent reads | Not for high-write throughput |
| `DatabaseSync` API similar to `better-sqlite3` | No async `iterate()` for huge result sets |

## Verification

```bash
node -e "import { DatabaseSync } from 'node:sqlite'; console.log(new DatabaseSync(':memory:').prepare('select 1').get())"
# Node 22.5+: { '1': 1 }
```

## Migration Path

If write throughput exceeds ~100 writes/sec:
1. Add Prisma + Postgres (Neon)
2. Keep `node:sqlite` for local dev only
3. Use `DATABASE_URL` to switch

## Notes

- `PRAGMA busy_timeout = 10000` critical for concurrent SSE + API access
- Rows returned have `null` prototype — must spread (`{...row}`) before passing to Next.js Client Components
- `DatabaseSync` is stable in Node 26; `module.register()` deprecation warning is harmless