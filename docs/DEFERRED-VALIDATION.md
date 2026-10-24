# Deferred validation

This repository was written in **Dirty Mode** (construction only). Nothing has been installed, built, run,
tested, served or deployed, and no network or paid call has been made. The only checks run so far are static:
`node --no-warnings scripts/check-syntax.mjs` (erasable-TypeScript parse check) and `node --check` on `.mjs`.
Every item below is **unverified** until its command has been run and the result recorded in STATUS.

Started in M1; later milestones append their rows; completed in M7.

## M1: scaffold, constants, table, CSV I/O, canonical hash

| What | Why deferred | Exact command later |
|---|---|---|
| Dependency versions and lockfile | Versions in `package.json` are pinned-caret values chosen from memory: **versions unverified, no lockfile**. No `package-lock.json` exists. | `npm install` (first authorized install; commit the generated `package-lock.json`), then `npm ci` thereafter. Fix any version that does not resolve or conflicts (Vite 7 / `@vitejs/plugin-react` 5 / Vitest 3 / TypeScript 5.9 / ESLint 9). |
| Type checking | No `tsc` run. `typecheck` uses `tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json` instead of C §2.12's `tsc -b`, to avoid project-reference `composite` requirements with `noEmit`. `erasableSyntaxOnly` needs TypeScript >= 5.8. | `npm run typecheck` |
| Lint | ESLint not run; `eslint.config.js` uses `tseslint.config(...)` and explicit `react-hooks` rules (API shape unverified for the installed versions). | `npm run lint` |
| Unit tests | `tests/core/csv.test.ts` and `tests/core/canonical.test.ts` written, never executed. | `npm test` (= `vitest run`), or `npx vitest run tests/core/csv.test.ts tests/core/canonical.test.ts`; record pass/fail/skip counts in STATUS. |
| Golden vector hashes | SHA-256 cannot be computed without running code, so every `expected_sha256` in `tests/fixtures/goldenVectors.ts` is `PENDING-first-run` and its hash assertion is skipped. Canonical **byte sequences** are hand-derived and asserted. | `npx vitest run tests/core/canonical.test.ts`; copy the logged `[golden table]` / `[golden json]` digests into `goldenVectors.ts`; re-run and confirm 0 skipped. |
| Browser/Node hash equality | The same golden vectors must give the same digests in Node and in a real browser (WebCrypto in both). Not run anywhere. | After re-keying: run `tests/core/canonical.test.ts` in a browser runner (e.g. Vitest browser mode, which needs `@vitest/browser` + a provider such as Playwright, not yet dependencies; or a dev page that prints `hashTable` for each vector) and compare with the Node digests. |
| papaparse behaviour assumptions | `parse.ts` assumes `Papa.parse(string, {step})` runs synchronously, emits a final `[""]` row for text ending in a line break (hence the final terminator is stripped first), honours explicit `newline`/`delimiter`, and keeps embedded line breaks in quoted fields. | Covered by the format-torture tests: `npx vitest run tests/core/csv.test.ts`. |
| Structural scanner vs papaparse on malformed quotes | The quote-aware scanner (delimiter detection, terminator counts, caps) and papaparse may disagree on malformed quoting; parse then reports `record_count_mismatch`. No malformed-quote fixture exists yet. | Add malformed-quote fixtures (quote inside an unquoted field, text after a closing quote, unclosed quote) and run `npx vitest run tests/core/csv.test.ts`. |
| windows-1252 decoding | Assumes `new TextDecoder('windows-1252')` is available (browsers; Node with full ICU, the default for official builds). | Format-torture test `windows-1252 0xE9 fallback` in Node and in a browser. |
| Parse/serialize performance at caps | Main-thread decode + scan + papaparse at 5,000,000 bytes / 20,000 x 60 assumed acceptable; canonical serialisation builds one string. | Time `parseBytes` + `hashTable` on a generated 20,000 x 60 file in Node and in a browser; Web Worker only if measured blocking (C §7 OQ1). |
| `check-syntax.mjs` limits | Uses experimental `node:module` `stripTypeScriptTypes` (strip mode): parse only, no type checking, no import or type resolution; `.tsx` is not parsed (listed as "inspection only"). Needs Node >= 22.13 / 23.2 (verified present: v24.18.0). | Superseded by `npm run typecheck` + `npm run lint` once installed. |
| Build | `vite build` not run; `index.html` -> `src/main.tsx` -> placeholder `src/App.tsx` (real UI is M4). | `npm run build` |
| Dev server port | No server started. Vite's default port is not reserved. | Claim a port through the agent-ports ledger (`scripts/ports.py claim`) before the first `npm run dev` / `npm run demo`, then set `server.port` in `vite.config.ts`. |
| Line-ending stability | `.gitattributes` marks `*.csv` and `fixtures/**` as `-text`; byte fixtures live in TypeScript literals so they are immune. | `git check-attr text -- fixtures/demo/orders-demo.csv` once fixtures exist (M4/M5). |

## Carried from C §6 (owned by later milestones)

| What | Why deferred | Exact command later |
|---|---|---|
| `npm run eval` (offline) | Not run; results absent. | Freeze MANIFEST/thresholds on dev; `npm run eval`; commit `results/` + `docs/LIMITATIONS.md`. |
| Generator determinism | MANIFEST hashes written at first run. | `npm run seed` twice; MANIFEST identical; record freeze date. |
| Live `llm`, `jev`, `llm_direct` | No calls; fixtures synthetic. | Owner keys in `.env.local`; dev threshold freeze; held-out once under the 5 USD reservation ledger; replace fixtures with recorded. |
| Jev robustness | Default-disclosure coverage likely low; bridges/siblings untested. | Order-shuffle, injection, bridge-merge, sibling ablation with real calls. |
| Edge functions | Not Deno-checked, not deployed. | `deno check supabase/functions/*/index.ts`; deploy; 401 / 413 / `missing_secret` / both round trips. |
| Anonymous auth, CORS, live gate / spend | Not configured. | Enable anonymous sign-in; set CORS origins; owner configures a hard cap before `VITE_LIVE_ENABLED=1`. |
| IDB journal | Chunked atomic writes and quota failure path assumed. | Browser test: 20k x 60 broad trim; forced quota failure keeps previous head; reload recovery. |
| Parser/export blob | Original-blob download byte-equality untested. | Browser test: download original equals dropped bytes. |
| Bolt import | Root build assumed. | Import inner repo; `npm ci && npm run build`; inspect-only handoff first. |
| Raha script | Not run. | Optional manual run to gitignored `data/external/`. |
