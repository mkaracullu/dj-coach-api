# Backend Agent Rules — DJ Lingo Coach API

This file applies to the `dj-coach-api` repository.

## Required source review

Before changing the backend:

1. inspect the exact source, tests, `README.md`, Wrangler configuration and nearest applicable project documents;
2. do not invent paths, bindings, environment variables, provider contracts or Cloudflare behavior;
3. preserve the provider-neutral public API and product scope;
4. use the smallest justified change;
5. do not commit or push unless explicitly instructed.

A report or Codex summary is not acceptance. Real source review and validation are required.

## Active operational sources

For Sprint 3B.6 production work, use:

- backend `README.md` for repository/runtime instructions;
- project `docs/CURRENT_CONTEXT.md`;
- project `docs/SPRINT_STATE.md`;
- project `docs/DECISION_LOG.md`;
- project `docs/SPRINT_3B6_PRODUCTION_ACTIVATION_RUNBOOK.md`.

Latest accepted and tested repository behavior overrides stale documentation. Report conflicts.

## Product scope and provider boundaries

- Public Coach remains provider-neutral.
- Mobile contains no provider keys and never calls OpenAI or Anthropic directly.
- Remote scope remains suggested questions in Sessions 2 and 7 only.
- Free text remains disabled.
- OpenAI is the selected initial text-Coach provider.
- Exact selected model: `gpt-5.4-mini-2026-03-17`.
- Controlled output ceiling: `400` tokens unless a newer accepted decision changes it.
- Anthropic remains a disabled reference adapter.
- Provider experiment routing and mobile cohort transport remain dormant.
- No cross-provider fallback is approved.
- `mock` remains the safe checked-in/deployed baseline until a controlled activation step.

Do not expand product scope, enable a provider, activate experiments, add retries or change fallback policy without explicit acceptance.

## Guardrail and storage boundaries

Preserve the accepted request order:

1. request read/size check and parsing;
2. structural validation;
3. product-scope validation;
4. request-level limiter;
5. provider resolution or dormant experiment assignment;
6. short-window external-provider guard;
7. global provider-call allowance;
8. one external-provider attempt;
9. response validation and semantic safety;
10. deterministic fallback/public response;
11. sanitized telemetry.

Production request-limiter behavior is mandatory and fail-closed. A valid limiter denial returns 429; missing production binding or a throwing/malformed binding returns 503 and must stop all later provider stages.

The global provider-call cap:

- uses a provider-neutral application port;
- currently uses a Cloudflare Durable Object + SQLite adapter;
- stores only UTC period key and consumed call count;
- must not store user, profile, lesson, request, response, IP, prompt, token or billing data;
- counts provider attempts, including failed/timed-out/fallback-producing attempts;
- is not a money-denominated budget or provider billing ledger.

Cloudflare-specific code must remain behind the infrastructure adapter boundary. DynamoDB is only a possible future adapter, not an accepted migration.

## Secrets, telemetry and paid calls

Never expose or commit:

- provider key values;
- authorization headers;
- `.dev.vars` contents;
- raw prompts or provider output;
- learner payloads;
- raw cohort identifiers;
- raw exceptions or unrestricted provider metadata.

Paid provider calls, live-provider evaluation and real-user provider traffic require explicit user approval. Standard tests must keep live suites skipped.

Upload, deployment or rollback does not itself authorize a provider call. Follow the active runbook and verify the exact account, Worker, environment, version and rollback target before remote operations.

## Review-bundle workflow

For broad backend changes, prepare one consolidated text bundle containing:

- base commit and current HEAD;
- branch and repository root;
- status;
- all changed and untracked paths;
- diff stat and complete relevant diffs;
- full current runtime/config/documentation contents;
- SHA-256 hashes.

In zsh scripts, use `file_path`, not `path`, as a loop variable.

## Validation

Run at minimum:

```text
npm run typecheck
npm test -- --configLoader runner
git diff --check
```

Run development and production Wrangler dry-runs when configuration, bindings, Durable Objects or deployment behavior changes.

Do not run opt-in live-provider suites without explicit approval.

Always report:

- actual changed paths;
- validation and dry-run results;
- provider calls made: yes/no;
- remote operations made: yes/no;
- remaining operational acceptance;
- `git status --short`;
- confirmation that nothing was committed or pushed unless instructed.
