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

## M3 construction (0601 / 0603, 2026-10-24)

The journal, review/approval lifecycle, rejection rulings, plan import/export, rules and fixture planners,
verify CLI and fixture re-key CLI are source only. Their focused tests are written and have not run.
Only the approved erasable-TypeScript syntax parser and read-only source inspection were used.
The inherited copy of this document was backed up to outer `agentops/backups/M3/docs/DEFERRED-VALIDATION.md.bak` before editing.

| What | Why deferred | Later check |
|---|---|---|
| Journal replay, undo and invariant | Exact delta/op replay, LIFO inverse hashes, dropped-row lineage and random ragged-table properties are unexecuted test source. | `npx vitest run tests/core/journal.test.ts`; typecheck, then verify a saved real journal with input/output CSV. |
| Verify tamper classes | Canonical event/params digest checks, strict nested schemas, parse metadata, deletion/reorder, cell/header/drop deltas, undo tip and output rid alignment are source-inspected only. | Run journal tests, then `npm run verify -- journal.jsonl input.csv output.csv`; tamper each artifact independently. This checks consistency, not authenticity. |
| Review and human edit provenance | In-order decisions, actual approved-only validation, stale suffix approvals, guard reconfirmation and human-introduced category targets need runtime confirmation. | `npx vitest run tests/core/review.test.ts`; M4 browser journey with trim rejected after parse approval. |
| Rulings and plan import | Profile-bound rejection reasons, duplicate-header count/ordinal resolution and approvals never transferring are source only. | `npx vitest run tests/core/rulings.test.ts tests/core/planio.test.ts`; import a plan onto a different file in M4. |
| Rules and fixtures | High-cardinality rules require the table-bound planner; the profile-only adapter conservatively skips incomplete evidence. Rules/fixture test source is unexecuted. | `npx vitest run tests/core/rules.test.ts`; rules trap checks plus held-out evaluation after M5 generation. |
| Fixture re-keying | CLI is written, not run; dependencies and the M4 demo source CSV are still pending. Current fixtures are not invented or silently used as a fallback. | `npm run fixtures:rekey`; confirm source_csv/exclusions match the browser outbound-profile hash and that PENDING, duplicate keys and misses give actionable errors. |
| Browser/Node crypto and schemas | WebCrypto equivalence, zod record checks, full import/type resolution and performance have not been executed. | `npm run typecheck`, focused tests in Node, browser journal round trip at caps; retain all syntax-check limitations above. |

## M4 browser construction (0640 / 0642, 2026-10-24)

Browser source wires the existing M3 review/journal engines, local IndexedDB snapshots and the hand-authored
`fixtures/demo/orders-demo.csv`. The original bytes are kept as a Blob; sample loading is `?url` → `fetch` →
`ArrayBuffer`, never a text conversion. Inherited App/main/deferred-doc files were backed up under outer
`agentops/backups/M4/` before replacement. No dependency install, browser, database, fetch, app, build or test
was executed. The code paths below remain construction-only, runtime unverified.

| What | Why deferred | Later check |
|---|---|---|
| React journey and keyboard review | TSX receives source inspection only; focused StepCard/PlanReview/Apply-gate test source is unexecuted. | `npm run typecheck`; `npx vitest run tests/ui`; browser walkthrough with `j/k/a/r/e/c`, reason entry, explicit guard confirmation and validation acknowledgement. |
| IndexedDB atomicity and cross-tab concurrency | Head + 64 Ki-character journal chunks + old-generation removal share one transaction; rejected writes are intended to leave the prior head. The controller serializes intents and publishes only after save. Generation comparison refuses another tab's replacement. These paths are source-inspected only. | Browser: force quota/write failure during broad trim, confirm displayed/saved old state; reload; race two tabs and require stale writer to reload; verify no partial chunks or head become visible. |
| Persisted review and journal | Reload reconstructs review with M3 refresh and folds the full journal; apply/undo/reapply keep prior events. Hashes bind the review to its predecessor; this has not run. | Approve → Apply → undo-to-N → undo-all → reload → reapply, compare first/reapplied output hashes and verify exported journal includes all undo/reapply events. |
| Demo source and fixture seam | Forty hand-authored rows include non-snake headers, padded amounts and duplicates, aliases/case variants, NA, ambiguous dates, a formula and two instruction-like notes. CSV parsing is unexecuted; fixtures intentionally remain unavailable until keyed. | Confirm seven columns/40 rows/zero ragged records; exclude c6 notes; run `npm run fixtures:rekey` after M5 fixtures exist; reload and compare browser outbound hash. Pending fixtures must remain actionable errors. |
| Import/export artifacts | Original byte download, UTF-8 serialization, formula warning, approved-only plan manifest, imported rejection notes and rulings replay are source only. | Download original and compare bytes; verify cleaned CSV/journal; import plan on a second file and require fresh approvals; import rulings and confirm retained rejection reason. |
| Supabase and live setup | Nullable client construction is source only. Mock rules works without configuration; live controls are disabled for M4, with actual live gate/session activation owned by M6. | Check missing/invalid public configuration renders Mock mode; M6 wires authenticated live planners and owner cap attestation before activation. |

M4 static check: `node --no-warnings scripts/check-syntax.mjs src/app/controller.ts src/store/idb.ts
src/lib/supabase.ts src/App.tsx src/main.tsx tests/ui/App.test.tsx` parsed the three `.ts` files with zero
syntax failures. The `.tsx` files were explicitly reported inspection-only; import resolution, types,
component behavior, transaction behavior and every runtime assertion above remain unverified.

## M5 evaluation construction (0658, 2026-10-24)

The scorer, cumulative literal and operational-extension oracle, method registry, dev-selected matched subset, journal-backed evaluator, report writer and generated-limitations writer are source only. Focused scorer/oracle test source exists and has not run. Inherited DEFERRED-VALIDATION.md was backed up to outer `agentops/backups/M5-eval/docs/DEFERRED-VALIDATION.md.bak` before this append. A minimal static LIMITATIONS.md is an M5-to-M7 seam; M7 may finalize its static text while preserving the unique generated marker.

| What | Why deferred | Later check |
|---|---|---|
| Types and seams | Only approved erasable-TypeScript syntax parsing and read-only source inspection were performed; this cannot resolve imports, types or behavior. | `npm run typecheck`; focused scorer/oracle tests after dependency installation is separately authorized. |
| Gold scoring and oracles | Rid/gold lineage, four classes, missing/empty, duplicates, good-row drops, headers, literal versus extended criteria and rejected-predecessor behavior remain unexecuted test source. | Run `tests/scripts/scorer.test.ts` and `tests/scripts/oracle.test.ts`; inspect named LIMITATIONS output against hand cases. |
| Seeded corpus and matched reruns | No seed writer, MANIFEST, byte hashes, generation, table profile or eval was executed. Auto-generation on absent MANIFEST is source only; existing corrupt/incomplete corpus should fail. | Run seed reproducibility/roundtrip tests; execute eval; confirm every method is freshly invoked on each 200x6 input/profile chosen only from dev labels. |
| Journal checks inside eval | Invariant, every inverse predecessor hash, full-undo hash and repeat-output checks have not run. | Execute rules evaluation on both populations; require zero unexplained differences and every hash flag true. |
| Guard and preservation evidence | Reports name mapped guard traps but a missing proposal is not proof of guard coverage. Withhold/reject/format traps require dedicated checks. | Run all eight guard tests, four bad-model-plan tests, outbound/format tests and four rules preservation traps; inspect held-out named trap results. |
| Fixtures and live provenance | PENDING/missing llm fixtures are explicitly not yet measured. Jev/direct rows remain registered and not yet measured until M6; no paid/live call was attempted. | Rekey intentional fixtures, then M6 wires provider/ledger/threshold/group metrics. Verify synthetic-fixture rows never become measured-live. |
| Thresholds, claims and costs | No dev tuning/freeze, held-out accuracy, Jev gate, matched direct-baseline superiority, spend or latency is established. Unknown fixture billing/latency stays unknown. | Freeze dev decisions before held-out; run matched comparators on equal input hashes; report measured group precision/alias recall and provider ledger costs rather than infer them. |
| Report and limitations artifacts | No results files were generated. Generated LIMITATIONS content may change only below its unique marker; static content is kept exactly. | Execute evaluation after authorization; check every wrongly changed coordinate and missed trap name in Markdown/JSONL/LIMITATIONS and preservation of static prefix. |

M5 static check: `node --no-warnings scripts/check-syntax.mjs scripts/eval/scorer.ts scripts/eval/oracle.ts scripts/eval/subset.ts scripts/eval/methods.ts scripts/eval/run.ts scripts/eval/report.ts scripts/eval/limitations.ts tests/scripts/scorer.test.ts tests/scripts/oracle.test.ts` parsed nine TypeScript files with zero syntax failures. Runtime, import/type resolution and all assertions above remain unverified.
