# Bolt handoff: CSV Cleaning Agent

## Target and readiness

- App/import root: the **inner** `csv-cleaning-agent/` Git repository, not the outer shell containing `PLAN.md`, `STATUS.md` and agent notes. Import identity/branch must be pinned to the future reviewed local revision; no remote exists, nothing has been pushed, and GitHub remote creation/import is a separate owner decision.
- Status: implemented source and authored tests, **Dirty Mode construction — runtime unverified**, 2026-10-24. No dependencies installed, lockfile, generated corpus, result artifacts, build/test/eval execution, provider calls, deployed resources or publication receipts.
- Database path: **none**. Full CSV, journal, reviews and rulings are per-browser local artifacts. No application tables, SQL migrations, RLS policies, RPCs, extensions, buckets, Realtime, jobs or workers are required; `supabase/migrations/` is intentionally absent. Do not invent `usage_counters` or other tables.
- Future function host: Bolt Cloud/Supabase-powered project, subject to actual Auth/edge compatibility checks. No target project/connection or deployed baseline is verified. Preserve any intended existing project; read-only inspection precedes setup.
- Auth: anonymous **user** sign-in. Functions: exactly two, below. Publication: prepare only. **Next Bolt action: inspect and prepare only**, with no provisioning, deployment or publishing.

## Build and configuration inventory

| Item | Source / future command | Status |
|---|---|---|
| Runtime | Node `>=22.13`, `package.json`; React 18 + TypeScript + Vite | Version compatibility unverified |
| First install | `npm install`, review resolved versions and commit `package-lock.json`; then later `npm ci` | No lockfile exists; declared versions are ranges, not verified pins |
| Checks | `npm run typecheck`, `npm run lint`, `npm test` | All pending |
| Build/output | `npm run build` = typecheck then Vite; `dist/` | Pending |
| Local UI | `npm run demo` = `vite --mode demo`; `npm run dev` / `npm run preview` | Pending; future host-port use must follow project port policy |
| Public client | `src/lib/supabase.ts` | Null for missing/invalid public config; useful Mock mode |
| Demo flag | `VITE_DEMO_MODE=1` in `.env.demo` | Public mode metadata; not a network/auth security gate |
| Frontend connection | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Public URL/key only; no user Auth implied by key |
| Live attestation | `VITE_LIVE_ENABLED=0` by default | Set `1` only after hard-cap proof and live preparation; no global enforcement |

The complete first activation order is in [DEFERRED-VALIDATION](docs/DEFERRED-VALIDATION.md#first-activation-order). Fixture profile hashes remain `PENDING`, golden hashes `PENDING-first-run`; generated data/results are absent. Rekeying fixtures preserves `synthetic-fixture` provenance and never turns them into recorded provider output.

## Functions and authentication

| Function/source | Caller + auth | Contract/resources | Deployment source |
|---|---|---|---|
| `propose-plan`; `supabase/functions/propose-plan/index.ts` | Browser anonymous user JWT; gateway `verify_jwt=true` and in-handler `auth.getUser(token)` | Folder-local strict `{profile}` request (version is inside profile); bounded profile → generative provider → raw plan string and usage metadata; no CSV table storage | Own `contract.ts`, `prompt.ts`, `provider.ts`, `deno.json`; `supabase/config.toml` |
| `judge-categories`; `supabase/functions/judge-categories/index.ts` | Same user JWT and handler check | Folder-local strict `{profile, pairs}` request; pairs must reference exact disclosed candidates; TypeSafe `jev-1.13.0`; ≤300 pairs, ≤6 siblings | Own `contract.ts`, `prompt.ts`, `provider.ts`, `deno.json`; `supabase/config.toml` |

Read each contract for exact nested shapes. Common success is `{ok:true, raw, usage, raw_usage, model, provider, request_id, latency_ms}`; judge adds bound pair `scores`. Failures use `{ok:false,error:{code,message,action}}`. Missing secrets produce `missing_secret` naming the variable only. An anon project key alone is not a user JWT.

Each function imports only within its own folder, apart from mapped dependencies. Only `index.ts` uses Deno globals. Both local import maps pin `zod` to `npm:zod@3.25.76` and Supabase JS to `npm:@supabase/supabase-js@2.57.0`; compare those pins to the future npm lockfile (current package base versions match, resolved ranges unknown). Check each function independently with `deno check supabase/functions/propose-plan/index.ts` and `deno check supabase/functions/judge-categories/index.ts`; frontend build is not Deno deployment validation.

Handlers accept POST/OPTIONS, configure exact-origin CORS from `ALLOWED_ORIGINS`, reject browser origins outside it, and allow authorization/apikey/content-type/x-client-info headers. Wildcard entries are filtered out. CORS is not authentication. Confirm preview/final origins and gateway preflight behavior in the intended host. Bodies are capped at 65,536 UTF-8 bytes before JSON parse; calls have a 30-second timeout, no automatic paid retries, and generative output cap 4,096 tokens. Clients cannot supply model IDs, provider base URLs or instructions. Deployment, rejection status codes, CORS and timeout behavior are all pending.

## Server and Node configuration names, by consumer

Never enter values into chat/source. Platform-injected configuration is distinct from owner-supplied provider settings.

| Name | Consumer | Requirement / source |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Both edge `index.ts` files, for in-handler `getUser` | Platform project configuration; verify injection, never copy another project |
| `ALLOWED_ORIGINS` | Both edge `index.ts` files | Owner-set comma-separated exact browser origins; no wildcard |
| `PLANNER_MODEL` | `propose-plan/index.ts` → provider config; Node `scripts/eval/ledger.ts` | Owner's exact generative model ID; no invented default |
| `ANTHROPIC_API_KEY` | Same propose-plan edge path and Node eval | Required if Anthropic selected; takes precedence when both provider keys exist |
| `OPENAI_COMPAT_API_KEY`, `OPENAI_COMPAT_BASE_URL` | Same propose-plan edge path and Node eval | Alternative pair for compatible provider; owner HTTPS API root without embedded credentials/query/fragment |
| `TYPESAFE_API_KEY` | `judge-categories/index.ts`; Node eval and explicit robustness harness | TypeSafe account key; live request/prices/model support require current documentation recheck |
| `EVAL_PRICE_TABLE` | **Node only**, `scripts/eval/ledger.ts` | Path to dated owner-verified price JSON; not read by edge or browser |
| `LIVE_JEV_TESTS` | **Node test opt-in only**, `tests/contracts/jev-robustness.test.ts` | Explicit `1` plus prices/key for paid gated test; keys alone do not opt in |

Node live eval reads ignored `.env.local` plain `NAME=value` lines, then environment overrides. Edge does not read that file. No server key may have a `VITE_` prefix. No service-role key is required. `.env.example` documents provider names, not secret values; the inventory above includes additional platform/Node-only consumers.

## Spend and external prerequisites

The browser live gate requires public flag `1`, a configured client and obtained anonymous user session. It does **not** enforce a hard spend ceiling. Browser call records are in-memory, with unknown billing/prices, and do not form a durable/global meter. There is no atomic shared counter or server rate-limit store. Scripted anonymous sign-ins can incur spend up to the provider/project cap. Before enabling live, the owner must configure and demonstrate a genuinely hard external cap; an alert-only budget is insufficient. If no hard cap is available, live stays disabled pending a separately authorized durable atomic-meter design.

Node live eval is a different boundary: serial calls, durable local reservation receipts before paid calls, settlement afterward, 5 USD maximum per invocation, owner-dated provider/model prices and worst-case token bounds. Missing price entries stop; unknown usage, potentially billable failures or exceeded reservations block further paid calls in that invocation. Inspect unresolved reservations after crashes before another run; fresh invocations do not enforce a shared global budget. See [EVAL](docs/EVAL.md) for price schema. Provider keys and the public flag never imply authorization for paid evaluation.

Recheck current official Bolt/Auth/gateway/import capabilities, Deno/npm compatibility, Anthropic/OpenAI-compatible formats, TypeSafe endpoint/question/Noul/usage/limits, pinned Jev model and actual prices before activation. No network verification occurred during construction. No webhooks, OAuth callback/recovery routes, email confirmation flow, uploads, buckets, Realtime subscriptions or background schedules are implemented/required. Anonymous session setup is explicit **Connect live session**, with no email/password accounts. Owner must configure host URL/origins and confirm anonymous sign-in in the actual project.

## Pending acceptance receipts

| Check | Expected evidence | Outcome |
|---|---|---|
| Import/install/check/build | Correct inner root; reviewed lockfile; type/lint/test/build output and `dist/` | Pending |
| Keyless demo | Rekeyed synthetic fixtures; full README review/stale/rulings/undo/export journey | Pending |
| Local durability | Atomic head/chunks, quota failure preserves old state, reload and two-tab conflict checks | Pending |
| Artifact consistency | Golden browser/Node agreement; zero unexplained differences; exact undo; verify + tamper rejection | Pending |
| Edge checks | Both Deno checks/import maps and authored contract tests | Pending |
| Auth/CORS | User JWT accepted, missing/anon-key-only/expired rejected, exact origins and OPTIONS work | Pending |
| Bounds/secrets/provider | Oversize 413, malformed/extra keys rejected, missing-secret actionable, one bounded round trip per provider, no auto retry | Pending |
| External hard cap | Owner evidence of enforced provider/project limit before browser flag/live batch | Pending |
| Eval quality/cost | Dev freeze, equal matched inputs, ledger receipts, held-out full-vocabulary Jev gate, generated results/limitations | Pending |
| Database/storage/uploads/jobs | Not required by design; no application resources to provision | Not applicable |
| Hosting/publication | Separate authorization and final URL checks if requested later | Not authorized; unexecuted |

## One prompt for a future authorized import: inspect and prepare only

> Read BOLT-HANDOFF.md and inspect this imported **inner csv-cleaning-agent repository** at the owner-pinned branch/revision. This is source-only Dirty Mode construction with no lockfile or runtime/deployment receipts. Compare actual source to its inventory: **no application database**, no migrations/tables/RLS/buckets/Realtime/jobs; anonymous user Auth and exactly `propose-plan` and `judge-categories` functions are the intended backend. Use read-only target/history/configuration inspection when available; preserve any intended existing connection/data. Report concrete source/import/runtime/Auth/function/provider gaps, owner hard-cap evidence needed, unresolved version/API/pricing checks and external blockers. Prepare a reviewable setup/validation plan with exact paths, env names by consumer and pending acceptance checks. Keep `VITE_LIVE_ENABLED=0`. Do not create/change cloud resources, apply migrations, deploy functions, enter secrets, call paid providers, enable schedules or publish. Do not push/create remotes or treat this prompt as provisioning authorization. Do not describe proposed resources or unexecuted checks as complete; preserve the product design and identify any required code change concretely for review.
