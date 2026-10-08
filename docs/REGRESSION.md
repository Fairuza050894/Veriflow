# Regression checks

## SQLite

```sh
DATABASE_URL= VERIFLOW_DB_PATH=./.data/regression.db GIT_PROVIDER=mock EMAIL_PROVIDER=mock VERIFLOW_STEP_DELAY_MS=1 npm run dev -- --port 3100
TEST_E2E=1 TEST_BASE_URL=http://localhost:3100 npm test
```

## PostgreSQL (new, disposable database)

The PostgreSQL schema now matches the SQL contract: snake_case columns, ISO-8601 text timestamps, integer flags. Existing databases created from the old camelCase Prisma schema require a reviewed data migration; do not apply `db push --accept-data-loss` to them.

```sh
export DATABASE_URL=postgresql://user@localhost:5432/veriflow_regression
npx prisma db push
NEXT_BUILD_DIR=.next-postgres GIT_PROVIDER=mock EMAIL_PROVIDER=mock VERIFLOW_STEP_DELAY_MS=1 PUBLIC_BASE_URL=http://localhost:3101 npm run dev -- --port 3101
TEST_E2E=1 TEST_BASE_URL=http://localhost:3101 TEST_DATABASE_URL="$DATABASE_URL" npm test
```

Regression coverage: rollback, nested/concurrent transactions, concurrent idempotency retries, fresh manual runs, API history, approval resume, token bypass, invalid/revoked/expired report links, persisted email link, input rejection before project creation.

Report URLs contain bearer tokens and are retained in operational run/email records for durable delivery. Public report access verifies the hash, expiration and revocation; run IDs are not credentials. Internal diagrams are excluded.

`npm audit` overrides pin patched PostCSS and KaTeX while keeping Next.js 15. Revisit overrides when upstream dependencies include those releases.

ponytail: PostgreSQL writes and pipeline advances are serialized with an advisory transaction lock; SQLite uses an in-process queue. PostgreSQL transactions have a 30-second ceiling. Move long-running/external execution outside transactions with per-run leases before scaling beyond the mock pipeline; external email delivery cannot be rolled back by the DB.
