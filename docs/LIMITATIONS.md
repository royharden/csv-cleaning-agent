# Known design limitations

The CSV is re-serialized on export. Original quoting and arbitrary mixed record terminators are not preserved: record terminators outside quoted fields normalize to the detected majority terminator. Embedded cell newlines remain cell content. Byte-exact recovery is available through the retained original blob.

The fixed operation vocabulary cannot repair arbitrary prose, cross-column swaps or ambiguous semantics. Model profiles disclose at most eight screened values per included column, which limits category coverage. Synthetic fixtures are not evidence of live model quality. No dependency installation, generated corpus, evaluation, build, provider call or test has run during Dirty Mode construction.

## Format, semantics and review

Mixed-terminator normalization narrows the preservation requirement; uniform record terminators are preserved. windows-1252 input exports as UTF-8 with notice. Ragged missing positions differ from empty strings. Limits are 5,000,000 bytes, 20,000 data records, 60 columns. Formula-like content is warned about, never neutralized.

Dates need a declared numeric whitelist format, not month names/per-cell guessing; two-digit pivot is 69. Number grammar excludes percentages/exponents/hex. Length-changing case mappings remain unparsed. Rules can miss aliases or falsely merge category keys. Whole-row dedup reads excluded columns locally. Bounded samples cannot show every edit; guards can be confirmed incorrectly. Only LIFO undo is built. No manual cell editing, Excel import, multi-file matching, scheduling, cloud sync or manual column reassignment UI exists.

## Privacy, authenticity and local storage

Screening and the shared eight-value disclosure cap are not anonymization or proof against prompt injection. Live profiles disclose observed text/counts to function/provider infrastructure; user CSVs remain local. Journals retain old/new values and dropped rows. There is no encryption, secure wipe or provider-retention guarantee. Hash chains and verify establish consistency, not authenticity/signatures: rewriting every artifact/hash can produce another consistent history. Read PRIVACY.md.

IndexedDB atomic head/chunks, quota failure/reload/two-tab conflicts and exact edit-distance/main-thread performance at 20k×60 need browser checks. Worker offload is not built; add only for measured need. Browser/Node digest equality and exact undo remain unvalidated.

## Live providers and evidence

Jev is optional and experimental. Only the shared eight screened, untruncated values form pairs/siblings; full-vocabulary alias recall can be disclosure-limited below rules. Eligible recall is only a diagnostic. Wider disclosure is not built; inclusion requires held-out fewer wrong groups than both rules/llm at equal or better full-vocabulary alias recall. Thresholds are unfrozen; synthetic thresholds do not establish a live default. Union-find bridges are reported, not repaired. Current TypeSafe endpoint/model/question/Noul/usage/prices are unverified.

Public live attestation/browser in-memory records are not global spend enforcement. No durable server meter or rate-limit store exists; anonymous sign-in abuse may spend up to the owner's external hard cap. Node's 5 USD serial per-invocation reservations need accurate dated owner prices/bounds, stop on unknown usage, and do not reconcile budgets across fresh runs. Auth/CORS, provider formats, body/pair/output/time limits and Deno deployment are pending. No automatic paid retry exists.

Synthetic gold-assisted benchmarks/oracles cannot establish general real-data accuracy. Literal oracle intentionally lacks the extra mangle/good-row-drop veto of oracle+ops. Node-only synthetic direct comparator is matched 200×6 and may exceed its 4,096-token response cap; failed/missing comparisons are not success. Generation/hashes/dev freeze, accuracy, cost and Jev inclusion are unmeasured. `goldenflow` is excluded pending license/install verification. Raha terms/inclusion are undecided; no external data is committed.

Source/tests exist but installs, lockfile, typecheck/lint/tests, golden digest completion, generation/rekeying, build/browser/eval/provider/deploy/publication are pending. Experimental Node stripping parses `.ts` only; `.tsx` gets inspection only. Lexical path/export checks do not establish types/runtime resolution. DEFERRED-VALIDATION.md holds activation order and remaining decisions. The evaluator keeps all static text above this single marker and rewrites only below it.

<!-- generated-by-eval:below -->

Evaluation has not yet run. There are no measured results.
