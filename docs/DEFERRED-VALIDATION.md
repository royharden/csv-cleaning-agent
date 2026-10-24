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
| Structural scanner vs papaparse on malformed quotes | Since M2 the scanner's `walk` closes a quoted field only on a quote followed by the delimiter, CR, LF or end of text (papaparse's rule), so both should agree on record boundaries. Three malformed fixtures were added to `tests/fixtures/formatTorture.ts` (quote inside an unquoted field, text after a quote inside a quoted field, unclosed quote); their cell expectations assume papaparse 5.x InvalidQuotes / MissingQuotes behaviour (unclosed field = rest of the input after the opening quote). Known remaining difference: papaparse also accepts spaces between a closing quote and the delimiter/newline (`"x" ,y`); the scanner does not, so such a file reports `record_count_mismatch`. | `npx vitest run tests/core/csv.test.ts`; if a malformed expectation fails, record papaparse's actual output and decide whether to mirror it (including the spaces rule) in `walk`. |
| Double UTF-8 BOM | Input `EF BB BF EF BB BF ...`: `decode` strips the first BOM and keeps the second U+FEFF as content (`ignoreBOM: true`), but papaparse 5.x is expected (from its source, unverified) to apply `stripBom` to string input and drop a leading U+FEFF, so the first header cell loses it while the structural scan and `meta.bom` see one BOM. Re-export then writes one BOM and the second is gone (not byte-exact; the retained original blob still is). | Add a fixture `EF BB BF EF BB BF 61 2C 62 0A 31 2C 32 0A` to `tests/fixtures/formatTorture.ts`, run `npx vitest run tests/core/csv.test.ts`, record header[0] (`a` vs U+FEFF + `a`) and decide: keep (document) or strip the extra U+FEFF in `decode` with a warning. |
| windows-1252 decoding | Assumes `new TextDecoder('windows-1252')` is available (browsers; Node with full ICU, the default for official builds). | Format-torture test `windows-1252 0xE9 fallback` in Node and in a browser. |
| Parse/serialize performance at caps | Main-thread decode + scan + papaparse at 5,000,000 bytes / 20,000 x 60 assumed acceptable; canonical serialisation builds one string. | Time `parseBytes` + `hashTable` on a generated 20,000 x 60 file in Node and in a browser; Web Worker only if measured blocking (C §7 OQ1). |
| `check-syntax.mjs` limits | Uses experimental `node:module` `stripTypeScriptTypes` (strip mode): parse only, no type checking, no import or type resolution; `.tsx` is not parsed (listed as "inspection only"). Needs Node >= 22.13 / 23.2 (verified present: v24.18.0). | Superseded by `npm run typecheck` + `npm run lint` once installed. |
| Build | `vite build` not run; `index.html` -> `src/main.tsx` -> placeholder `src/App.tsx` (real UI is M4). | `npm run build` |
| Dev server port | No server started. Vite's default port is not reserved. | Claim a port through the agent-ports ledger (`scripts/ports.py claim`) before the first `npm run dev` / `npm run demo`, then set `server.port` in `vite.config.ts`. |
| Line-ending stability | `.gitattributes` marks `*.csv` and `fixtures/**` as `-text`; byte fixtures live in TypeScript literals so they are immune. | `git check-attr text -- fixtures/demo/orders-demo.csv` once fixtures exist (M4/M5). |

## M2: transformkit (eight ops, grammars, guards, validator, preview), profile, review samples/edit distance

| What | Why deferred | Exact command later |
|---|---|---|
| M2 unit tests | `tests/core/{ops,grammar,guards,validator,profile,static-check}.test.ts` written, never executed; expectations were derived by hand from the contract and source. | `npx vitest run tests/core`; record pass/fail/skip counts in STATUS; fix code or expectation per failure (never weaken a trap test). |
| Static dynamic-code check | `scripts/check-no-dynamic-code.ts` completed, not executed. Full-source scanner handles multiline calls, requires a complete literal RegExp argument, and rejects template interpolation / literal concatenation. Regression source is `tests/core/static-check.test.ts`. A read-only `rg` scan for prohibited direct patterns over `src/core/transformkit` found none. Comments are deliberately scanned; alias/computed calls are outside this bounded scanner's scope. | `npm run check:static` (expects 0 findings), then `npx vitest run tests/core/static-check.test.ts`. |
| zod API assumptions | Schemas assume zod 3.x (`z.object().strict()`, `superRefine`, `z.enum(readonly tuple)`, issue code `unrecognized_keys` with `keys`). | `npm run typecheck` + `npx vitest run tests/core/validator.test.ts`. |
| Locale behaviour of case maps | `toLocaleUpperCase('en-US')` / `toLocaleLowerCase('en-US')` assumed identical in Node (full ICU) and browsers; `p{Lu}` / `p{Ll}` regexes need Unicode property escapes. | ops/guards tests in Node and in a browser runner. |
| Latin-1 folding in rename_headers | `String.prototype.normalize('NFD')` assumed available and stable for U+00C0..U+00FF. | `npx vitest run tests/core/ops.test.ts` (snake_case cases). |
| Outbound size budget | 60,000-byte budget (`OUTBOUND_PROFILE_MAX_BYTES`) chosen to leave room for the M6 request envelope under 65,536; the envelope itself is not built yet. | M6: `tests/contracts/propose-plan.test.ts` asserts envelope bytes < 65,536 at the caps. |
| Performance at caps | Profile runs 12 date + 6 number grammar checks per cell; previews copy only changed rows; largest-edit ranking prunes by length bound but is exact Levenshtein (a pair of very long cells is quadratic). | Time `buildLocalProfile`, `previewChain` (8 steps) and `largestEdits` on a 20,000 x 60 table in Node and a browser; Web Worker only if measured blocking (C §7 OQ1). |
| Guard semantics | date_order also fires when a column proves only the OPPOSITE order or no cell parses; evidence is measured per column. null_shape_majority uses all non-empty cells, including selected tokens, per C §2.7. category_target combines distinct sources across groups with the same target. leading_zero_id checks the number part after sign/currency of grammar-valid cells. These branches have focused regression test source. | Review against seeded traps once the generator runs (M5); `npx vitest run tests/core/guards.test.ts`. |
| Strict outbound schema | `OutboundProfileSchema` closes every nested object, validates count/column/text bounds and the shared allowance. The builder validates the assembled profile; runtime zod behaviour and planner integration are unverified. Tests cover extra raw-data keys and an overlong value. | `npm run typecheck`; `npx vitest run tests/core/profile.test.ts`; reuse the exported schema for the later browser boundary. |

M2 successor construction receipt (0566_Codex_GPT-61Sol_Sub_S23-M2-Coder, 2026-10-24): inherited source was retained;
originals of replaced inherited files were saved outside the product repo under outer `agentops/backups/M2/` with
relative paths and `.bak` suffixes. Invisible NBSP/zero-width characters in op/profile test literals now use visible
Unicode escapes. No installs, tests, builds, application execution, network, servers or credentials were used.
All 45 current `.ts` files (including the two root Vite/Vitest configs) were checked with
`node --no-warnings scripts/check-syntax.mjs <all .ts paths>`: 0 syntax failures. This is a parse-only result;
type/import resolution and every runtime assertion above remain deferred.

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
