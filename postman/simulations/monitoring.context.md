# Issue Atlas → Monitoraggio

Local mock derived from `docs/monitoring-api.openapi.json` and the companion Python API in Monitoraggio. No owning Postman workspace or published mock is linked; the repository owns this synthetic fixture. Nothing is published or deployed.

## Purpose

Exercise the real Node HTTP client, encrypted settings and persistent outbox against success, revoked keys, HTML 503, rate limits, an HTML login page and redirects. The mock is `postman/mocks/monitoring/monitoring.js`; it is not the Python service under test.

## Execution

Start `postman simulation run postman/simulations/monitoring.sim.yaml --port 4902 --output ndjson --no-history`, capture its log outside Git, and take the member address from `listening`. Run `MONITORING_SIMULATION_URL=http://127.0.0.1:4902/monitoring node --import tsx --test tests/monitoring.test.ts`. The `request` events must include authenticated GET `/api/v1/integration` and POST `/api/v1/estimate-inbox`; fixture inspection requests use `/__test/received/…`. Stop the simulation with Ctrl+C or `pkill -INT -f 'simulation run .*monitoring.sim.yaml'`.

## Assumptions

- The simulation accepts synthetic keys only; error variants use the integration ID as documented by the fixture. No real credentials are needed. (observed 2026-10-25)
- The mock validates only the exercised shape. Full payload validation, durable idempotence, monotonic revisions, revocation, rate limits, month selection and transactional promotion are checked against the Python implementation by its unittest suite. `scripts/test-monitoring-e2e.py` additionally runs the real TS client against a real Uvicorn process and an isolated SQLite DB. Local runs do not establish production TLS, proxy routing or macOS Keychain behavior. (observed 2026-10-25)

## Observations

<!-- begin:observations -->

2026-10-25: the monitoring member served both verification and ingestion traffic. Eleven client checks passed, including persisted retry after each failure, coalescing unchanged analyses, withdrawal, disabled delivery, changed destination and an update arriving during delivery. The separate local Python/TypeScript E2E passed staging and manual November promotion without accessing the real database.
<!-- end:observations -->

## What didn't work

- 2026-10-25: the Mac sandbox rejected both the simulation bind (`listen EPERM`) and Node connections to localhost. Running these test processes with the requested permission resolved the environment restriction.
