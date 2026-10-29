# Seeded fixture population

Generated CSVs, labels and `MANIFEST.json` are absent during Dirty Mode construction. Run `npm run seed` after runtime activation. The command imports no remote data and writes 24 deterministic synthetic datasets: customers, orders and inventory, each with dev seeds 1–4 and held-out seeds 101–104. Each dirty file contains 300–1,000 rows including two appended duplicates. The hand-authored `fixtures/demo/orders-demo.csv` is separate and never scored.

Expected layout:

```text
MANIFEST.json
dev/{dirty,clean,labels}/{customers,orders,inventory}-{1,2,3,4}.{csv,json}
heldout/{dirty,clean,labels}/{customers,orders,inventory}-{101,102,103,104}.{csv,json}
```

Dirty and clean directories contain CSVs; labels directories contain JSON. The manifest records generator version, seeds, row counts, column counts, byte sizes, per-artifact SHA-256, file format, row lineage and the owner-supplied freeze date. `npm run seed -- --freeze-date YYYY-MM-DD` records that date; without it the date is null. Freeze development thresholds separately before evaluating held-out data. Repeating generation with the same version and freeze-date argument must produce identical bytes; this remains unexecuted.

Rows align by immutable `rid`, never output position. Clean tables omit appended duplicate rows. Each manifest `row_map` entry maps a dirty rid to a clean rid and states whether it is a duplicate; labels additionally record `retained_rid`. Every injected cell difference has a `fixable_by` label with its operation or `out_of_scope`. Trap metadata also identifies clean values that must survive, unsafe strings to withhold, and collision proposals to reject. Category labels retain case, punctuation, typo and alias strata. Label and clean files are evaluation-only and never planner input.

File formats rotate across BOM + CRLF, semicolon-delimited UTF-8, semicolon + CRLF windows-1252 and ordinary UTF-8 LF. Embedded newlines and quotes are literal cells. The loader checks recorded byte hashes and restores rid lineage after CSV parsing. `bad-model-plan` refers to the four raw adversarial steps in `fixtures/plans/demo.llm.json`; they are validated as proposals and never used as transform code.

Both demo plan records carry `source: synthetic-fixture` and `profile_hash: PENDING`. Run `npm run fixtures:rekey` after installing dependencies; PENDING never matches a replay lookup. The Jev demo threshold is synthetic replay data only. `fixtures/jev-thresholds.json` remains `not yet frozen` until a measured dev calibration.
