# Privacy and data flow

Source contract, 2026-10-24; runtime and deployed behavior are unverified. No privacy certification, provider retention guarantee or anonymization claim is made.

## Browser-local data

The original CSV/TSV is decoded, parsed, profiled, transformed and journaled in the browser. Source stores the retained original Blob, original/current table, parse metadata, review/approvals, exclusions, journal and rejection rulings in IndexedDB. Journal chunks and head update together in one transaction; quota/reload/concurrent-tab behavior needs browser validation. Browser storage is local persistence, not encryption or secure erasure. Someone with access to this browser profile can potentially read it. Replacing a session is not an erasure guarantee.

Rules and synthetic fixtures use local data without model requests. Sample loading fetches a bundled app asset as bytes. Ordinary page hosting, asset requests, explicitly connecting a live session and provider calls may generate network metadata; “local-first” describes table processing, not a promise that the website never communicates.

## Only bounded profile disclosure in live planning

`src/core/profile/outbound.ts` builds a separate profile **after exclusions**. Each included column has immutable `id`, a screened display label (at most 40 characters), aggregate counts, shapes, date/numeric evidence, whitespace/leading-zero/formula/null-token counts, and one shared list of at most eight unique strings, each at most 40 characters. Samples/top values/category candidates share this allowance, selected by frequency then deterministic order; allowances may shrink to zero to fit the 60,000-byte profile budget. Full-string instruction screening occurs before clipping. Withheld cell values are absent; withheld headers use `[withheld]`. Long disclosed prefixes are marked truncated, and exact membership rules exclude clipped-only prefixes from Jev pairs. Two originals can legitimately share a clipped prefix.

Excluded columns have no column object, labels, values or per-column statistics in the outbound profile. The two whole-record duplicate counts are numeric aggregates over all columns. Exclusion does not stop local whole-row deduplication from reading that column. Outbound preview displays the actual profile; provider prompts also include fixed instructions/schema/vocabulary. Live category requests add pairs and up to six siblings drawn solely from those same exact disclosed values. Raw files, row arrays, journal and rulings are not sent by browser planners.

This is data minimization, **not de-identification**. Names, identifiers or sensitive text that survives screening can appear among the eight values/labels. Counts and shapes can also reveal information. Static withholding patterns have false positives and false negatives and do not prove protection against prompt injection. Do not infer that an allowed profile is non-sensitive. Rationale is untrusted text rendered through React escaping.

## Recipients and credentials

Live browser traffic goes to the configured Supabase/Bolt function host. `propose-plan` forwards a profile prompt to Anthropic or the owner's OpenAI-compatible HTTPS provider; `judge-categories` forwards disclosed category pairs to TypeSafe. The current TypeSafe wire API/model and all provider policies, availability, prices and dates must be rechecked at activation. No provider calls or current policy verification occurred here. Provider retention, logging, jurisdiction and account settings are owner decisions, not enforced by this source.

Anonymous Supabase user sign-in identifies a user session; it does not mean zero identifiers or zero service logs. The functions require a user JWT plus handler identity validation; CORS is not authentication. Platform/Auth/provider infrastructure can observe network metadata and billed requests. No application database, table storage or bucket is supplied for user CSV data. Provider adapters are written without explicit request/response logging, but platform logs and provider behavior remain unverified.

Only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_DEMO_MODE` and `VITE_LIVE_ENABLED` are public browser configuration. Provider keys stay in server settings or the Node evaluator's ignored `.env.local`, never a `VITE_` variable. Names and consumers are authoritative in [BOLT-HANDOFF](../BOLT-HANDOFF.md); no secret values belong in source, chat or exported receipts.

## Synthetic evaluation exception

The separate Node CLI `llm_direct` can send synthetic generated cell arrays to the generative provider, capped to the matched first 200 rows and six columns. It is not imported by the browser and does not accept a user's uploaded CSV. Normal Node llm/Jev evaluation uses bounded synthetic profiles. The explicit Jev robustness harness deliberately submits a synthetic instruction-like test pair through a dedicated test API; the normal browser path withholds that string. It needs explicit `--live` or separately gated live-test opt-in and owner prices/keys. Nothing has been executed.

## Export and control

The original download preserves exact input bytes. `cleaned.csv` may contain formula-like cells: warnings do not neutralize them. `journal.jsonl` contains old/new values, dropped full rows, headers and category maps; `rulings.jsonl` may include reasons and profile-derived identifiers; `plan.json` includes parameters, category values and original-header references. Hashes are consistency tools, not privacy protection or signatures. Exported artifacts should be handled with the same care as the CSV.

There is no in-app cloud deletion, secure wipe, account-management or multi-user synchronization flow. Browser/site-data controls can remove local storage subject to browser behavior, but cannot retract previous downloads or provider disclosures. Optional external benchmarks remain separate, opt-in and ignored; no external data has been downloaded, and Raha terms remain undecided.
