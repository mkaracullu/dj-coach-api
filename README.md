# DJ Coach API

Provider-neutral Cloudflare Workers backend for DJ Lingo’s text-based Coach capability.

## Current Milestone

**Sprint 3B.6 — Controlled OpenAI Production Activation**

Current stage:

**Planning and Runtime Readiness**

OpenAI is selected as DJ Lingo’s initial production provider for the text-based Coach capability.

Selection does not mean activation.

Current runtime state:

* checked-in provider mode: `mock`;
* deployed provider mode: `mock`;
* deployed Worker: `dj-coach-api`;
* deployed environment value: `development`;
* real-user OpenAI traffic: inactive;
* OpenAI production smoke: not yet authorized;
* Anthropic production traffic: inactive;
* provider experiment routing: dormant;
* mobile provider-experiment cohort transport: disabled;
* cross-provider fallback: not approved.

Selected OpenAI model:

```text
gpt-5.4-mini-2026-03-17
```

The selected model must be explicitly pinned through runtime configuration during an authorized activation. It is not hard-coded into the provider-neutral source boundary.

## Product Scope

The remote Coach API currently supports:

* suggested questions only;
* Session 2 — Tap the Pulse;
* Session 7 — Mini Attempt + Result;
* structured text responses;
* deterministic local/mock fallback;
* request-ID validation;
* backend product-scope validation;
* runtime semantic safety;
* sanitized operational telemetry.

The remote Coach API does not currently support:

* unrestricted free text;
* persistent conversation history;
* voice, TTS or STT;
* recording or upload review;
* microphone or camera analysis;
* real audio analysis;
* controller inspection;
* navigation commands;
* lesson completion;
* progress mutation;
* controller coordinates;
* scene or animation commands.

The mobile app contains no OpenAI or Anthropic API keys and never calls a model provider directly.

## Endpoints

```text
GET /health
POST /v1/coach/respond
```

Canonical request ID header:

```text
X-DJ-Request-Id
```

The successful public response remains provider-neutral.

Provider identity, usage, cost, prompts, raw provider responses and diagnostics are not returned to mobile.

## Request Processing Boundary

The accepted runtime order is:

1. Read and size-check the request body.
2. Parse JSON.
3. Perform structural request validation.
4. Enforce product scope.
5. Apply the request-level limiter.
6. Resolve provider mode or experiment assignment.
7. Apply the external-provider guard when an external provider is selected.
8. Invoke the selected `CoachService`.
9. Parse and structurally validate provider output.
10. Validate the backend Coach response contract.
11. Validate request-ID equality.
12. Apply runtime semantic safety.
13. Use deterministic mock fallback on provider or safety failure.
14. Return the validated provider-neutral response.
15. Emit sanitized `coach_request_completed` telemetry.

Product-scope rejection occurs before experiment assignment, external-provider guardrails or provider invocation.

## Runtime Safety

Runtime semantic safety rejects obvious claims or instructions involving:

* lesson or progress mutation;
* app navigation or retry execution;
* audio playback or recording control;
* microphone or camera use;
* physical controller inspection or control;
* fake audio analysis;
* hidden instruction exposure;
* prompt-injection compliance;
* piracy or copyright-bypass guidance.

Safe capability denials remain valid, for example:

* “I can’t inspect your controller.”
* “I can’t listen to your room audio here.”
* “I can’t complete the lesson for you.”
* “I can’t press Play for you.”

Runtime safety is intentionally narrow and does not replace provider evaluation or broader product policy.

## Provider Architecture

The backend currently contains:

* deterministic mock Coach service;
* OpenAI reference/selected-provider adapter;
* Anthropic disabled reference adapter;
* provider-neutral Coach service and response boundaries;
* provider experiment routing infrastructure;
* deterministic fallback;
* shared response validation;
* runtime semantic safety;
* normalized provider metadata for internal evaluation.

Current production selection:

* text-based Coach primary provider: OpenAI;
* Anthropic Haiku 4.5: disabled reference adapter;
* OpenAI–Anthropic A/B experiment: inactive;
* cross-provider fallback: inactive.

Provider failures must not silently cross over from OpenAI to Anthropic or from Anthropic to OpenAI.

## Local Setup

Install dependencies:

```bash
npm install
```

Run local validation:

```bash
npm run typecheck
npm test -- --configLoader runner
git diff --check
```

Run the Worker locally:

```bash
npm run dev
```

Default tests do not make provider calls.

The OpenAI and Anthropic live suites remain opt-in and are skipped during standard validation.

## Runtime Configuration

### Shared runtime configuration

```text
ENVIRONMENT
COACH_PROVIDER
```

Supported provider modes include:

```text
mock
openai
anthropic
experiment
```

The checked-in and deployed default remains:

```text
COACH_PROVIDER=mock
```

Unknown, missing or incomplete external-provider configuration resolves safely without activating an external provider.

### OpenAI runtime configuration

```text
OPENAI_API_KEY
OPENAI_MODEL
OPENAI_MAX_OUTPUT_TOKENS
```

OpenAI runtime mode requires:

* `COACH_PROVIDER=openai`;
* a non-empty `OPENAI_API_KEY`;
* a non-empty `OPENAI_MODEL`;
* a successful external-provider guard result.

`OPENAI_MAX_OUTPUT_TOKENS` is optional in the generic runtime boundary and is constrained to the accepted range.

For the first controlled Sprint 3B.6 deployment and synthetic smoke, the accepted planned values are:

```text
OPENAI_MODEL=gpt-5.4-mini-2026-03-17
OPENAI_MAX_OUTPUT_TOKENS=400
```

These planned values do not authorize deployment or provider calls by themselves.

### Anthropic runtime configuration

```text
ANTHROPIC_API_KEY
ANTHROPIC_MODEL
ANTHROPIC_MAX_OUTPUT_TOKENS
```

Anthropic remains disabled for initial production activation.

### Provider experiment configuration

```text
COACH_EXPERIMENT_ENABLED
COACH_EXPERIMENT_ID
COACH_EXPERIMENT_VERSION
COACH_EXPERIMENT_ASSIGNMENT_SECRET
COACH_EXPERIMENT_OPENAI_BPS
```

Provider experiment configuration must remain absent or disabled during normal OpenAI activation.

The internal cohort header is:

```text
X-DJ-Experiment-Cohort
```

The raw cohort value must never be:

* included in prompts;
* sent to providers;
* added to public responses;
* recorded in telemetry;
* used for authentication, billing, entitlements or rate limiting.

## Rate-Limit Bindings

The Worker uses two independent Cloudflare Rate Limiting bindings.

### Request-level limiter

```text
COACH_RATE_LIMITER
```

Current deployed configuration:

```text
namespace: 1001
limit: 10
period: 60 seconds
```

### External-provider guard

```text
COACH_PROVIDER_RATE_LIMITER
```

Current deployed configuration:

```text
namespace: 1002
limit: 5
period: 60 seconds
```

The external-provider guard is mandatory for OpenAI and Anthropic runtime calls.

If the provider guard binding is:

* missing;
* throwing;
* malformed;
* rejecting the request;

the provider must not be invoked.

Mock mode remains usable without an external-provider call.

The provider limiter is a short-window cost and abuse guard. It is not a global daily budget counter.

## Current Deployed State

Worker:

```text
dj-coach-api
```

Named Wrangler environment:

```text
none
```

Active non-secret configuration:

```text
ENVIRONMENT=development
COACH_PROVIDER=mock
```

Active deployment:

```text
deployment ID:
d80559c0-290c-40fe-83fd-61c6ca5a6960
```

Active guarded mock version:

```text
9729512a-d5d6-4f3a-aaa3-cc93678d1e9d
```

Traffic:

```text
100%
```

Current deployed secrets:

```text
OPENAI_API_KEY: absent
ANTHROPIC_API_KEY: absent
COACH_EXPERIMENT_ASSIGNMENT_SECRET: absent
```

The active version is the primary known rollback target for Sprint 3B.6.

## Read-Only Runtime Preflight

Before any authorized deployment, re-run read-only checks to detect configuration drift.

Repository state:

```bash
git branch --show-current
git rev-parse HEAD
git status --short
```

Wrangler identity and target:

```bash
npx wrangler --version
npx wrangler whoami --json
```

Active deployments and versions:

```bash
npx wrangler deployments list --json
npx wrangler deployments status --json
npx wrangler versions list --json
npx wrangler versions view 9729512a-d5d6-4f3a-aaa3-cc93678d1e9d --json
```

Secret names only:

```bash
npx wrangler secret list --format json
npx wrangler versions secret list
```

Never print:

* secret values;
* shell environment dumps;
* `.dev.vars`;
* authorization headers;
* API tokens.

## Sprint 3B.6 Activation Principles

Sprint 3B.6 uses a staged version flow.

Direct immediate deployment is not the preferred path.

The stages are:

1. Planning and Runtime Readiness
2. Authorized OpenAI Deployment and Synthetic Smoke
3. Rollback-to-Mock Verification
4. Real-iPhone Remote Coach Verification
5. Real-User Activation Readiness

Completion of one stage does not authorize the next stage.

### Locked planning decisions

* use the existing `dj-coach-api` Worker for the bounded synthetic smoke;
* retain `ENVIRONMENT=development` for the controlled internal smoke;
* defer development/staging/production separation until real-user activation readiness;
* pin `OPENAI_MODEL` to `gpt-5.4-mini-2026-03-17`;
* use `OPENAI_MAX_OUTPUT_TOKENS=400`;
* use staged Cloudflare version operations;
* use `wrangler versions secret put`, not immediate `wrangler secret put`;
* do not use `--keep-vars`;
* keep provider experiment variables absent;
* keep mobile cohort transport disabled;
* keep Anthropic disabled;
* keep cross-provider fallback disabled;
* use version `9729512a-d5d6-4f3a-aaa3-cc93678d1e9d` as the primary guarded mock rollback target;
* synthetic smoke success must not authorize real-user traffic.

## Staged Secret Preparation

The approved command shape for a future staged secret operation is:

```bash
npx wrangler versions secret put OPENAI_API_KEY \
  --name dj-coach-api \
  --message "<AUTHORIZED_SECRET_VERSION_MESSAGE>" \
  --tag "<AUTHORIZED_TAG>"
```

The secret value is entered interactively.

The value must never appear:

* in the command;
* in shell history;
* in source;
* in documentation;
* in chat;
* in logs.

This command must not be executed without explicit authorization.

After the operation:

* capture the generated version ID;
* inspect the generated version through a read-only Wrangler command;
* confirm only the secret name, not its value;
* confirm no traffic was moved;
* confirm the active deployment remains the guarded mock version.

Secret presence alone does not activate OpenAI while the active provider mode remains `mock`.

## Staged OpenAI Version Upload

The planned command shape for a future OpenAI-configured version upload is:

```bash
npx wrangler versions upload \
  --name dj-coach-api \
  --var ENVIRONMENT:development \
  --var COACH_PROVIDER:openai \
  --var OPENAI_MODEL:gpt-5.4-mini-2026-03-17 \
  --var OPENAI_MAX_OUTPUT_TOKENS:400 \
  --message "<AUTHORIZED_VERSION_MESSAGE>" \
  --tag "<AUTHORIZED_TAG>"
```

This command must not be executed without explicit authorization.

`--keep-vars` must not be added.

Reason:

* required plain variables are provided explicitly;
* rate-limit bindings remain defined by `wrangler.jsonc`;
* dormant experiment variables remain absent;
* Anthropic variables remain absent;
* unexpected dashboard-managed variables are not preserved.

After upload:

* record the new version ID;
* inspect its non-secret variables;
* verify both rate-limit bindings;
* verify the OpenAI secret binding is present by name;
* verify Anthropic and experiment configuration remain absent;
* verify no traffic moved to the new version.

If the final staged version does not contain the expected secret and bindings, stop. Do not deploy it.

## Authorized Version Deployment

Deployment is a separate authorization from secret preparation and version upload.

Planned command shape:

```bash
npx wrangler versions deploy <NEW_VERSION_ID>@100% \
  --name dj-coach-api \
  --message "<AUTHORIZED_DEPLOYMENT_MESSAGE>" \
  --yes
```

Before deployment, authorization must specify:

* provider;
* exact model;
* exact version ID;
* exact Worker/account target;
* output-token ceiling;
* request count;
* retry count;
* maximum spend;
* allowed synthetic request or fixture IDs;
* success conditions;
* stop conditions;
* rollback action;
* whether internal tester traffic is included;
* whether real-user traffic is included.

Deployment authorization does not automatically authorize a provider call.

## Synthetic Smoke Boundary

A synthetic smoke request is a paid live OpenAI call.

It requires separate explicit authorization.

The authorization must define:

```text
provider
exact model
request count
automatic retry count
maximum output tokens
maximum spend
traffic type
allowed request or fixture IDs
success conditions
stop conditions
rollback action
real-user traffic included: yes/no
```

Initial synthetic smoke must use:

* non-user test traffic;
* the exact selected model;
* bounded request count;
* zero or explicitly approved retries;
* approved safe suggested-question IDs;
* Session 2 and/or Session 7 only;
* no free text;
* no experiment cohort;
* no mobile real-user traffic;
* no Anthropic call;
* no cross-provider fallback.

Stop immediately on:

* unexpected request count;
* unexpected retry;
* provider guard failure;
* rate-limit failure;
* timeout;
* network or provider HTTP failure;
* malformed provider output;
* request-ID mismatch;
* semantic-safety fallback;
* deterministic fallback;
* provider identity leakage;
* unexpected public fields;
* spend ceiling reached;
* any real-user request.

A successful synthetic smoke does not authorize real-user traffic.

## Rollback-to-Mock

Primary rollback target:

```text
9729512a-d5d6-4f3a-aaa3-cc93678d1e9d
```

Planned rollback command:

```bash
npx wrangler rollback \
  9729512a-d5d6-4f3a-aaa3-cc93678d1e9d \
  --name dj-coach-api \
  --message "<ROLLBACK_REASON>" \
  --yes
```

This command must not be executed without explicit authorization unless an already-authorized emergency rollback condition has been reached.

Expected rollback result:

* 100% traffic returns to the guarded mock version;
* `COACH_PROVIDER=mock`;
* `ENVIRONMENT=development`;
* both rate-limit bindings restored;
* external provider invocation disabled;
* no experiment variables active.

After rollback, verify through read-only commands:

* active deployment;
* active version;
* provider mode;
* bindings;
* no external provider attempt.

Secondary fallback:

```bash
npm run deploy
```

This redeploys the current checked-in mock configuration as a new version.

The recorded guarded mock version is the preferred deterministic rollback target.

## Real-iPhone Verification

Real-iPhone remote Coach verification is a later Sprint 3B.6 stage.

It must confirm:

* Session 2 suggested questions;
* Session 7 suggested questions;
* request-ID transport;
* valid remote response;
* deterministic local fallback;
* duplicate-request protection;
* stale-response protection;
* provider identity remains hidden;
* mobile contains no provider key;
* mobile cohort transport remains disabled;
* unsupported sessions remain local;
* free text remains disabled.

A real-iPhone test against an OpenAI-enabled backend requires explicit authorization because it may generate paid provider traffic.

Android real-device QA must not be claimed because no Android device is currently available.

## Requirements Before Real-User Activation

Synthetic smoke and internal tester success are not sufficient for real-user activation.

Before real-user OpenAI traffic, DJ Lingo must define or implement:

* trusted environment or daily provider-budget control;
* explicit operational ownership;
* accepted development/staging/production separation;
* more precise sanitized provider failure telemetry;
* effective-provider versus deterministic-fallback outcome telemetry;
* runtime provider latency visibility;
* runtime usage and cost visibility;
* deterministic request-limiter failure policy;
* focused Session 2 and Session 7 screen-level remote integration tests;
* accepted mobile production build/configuration delivery;
* real-iPhone verification;
* rollout thresholds;
* stop thresholds;
* rollback ownership;
* explicit real-user activation authorization.

## Live Provider Evaluation

The repository includes opt-in evaluation commands:

```bash
npm run eval:openai -- --configLoader runner
npm run eval:anthropic -- --configLoader runner
```

These commands may generate paid provider calls.

They must never run during standard validation or without explicit provider-call authorization.

Standard validation remains:

```bash
npm run typecheck
npm test -- --configLoader runner
git diff --check
```

## Operational Prohibitions

Do not:

* commit provider keys;
* put keys in mobile configuration;
* call providers directly from mobile;
* activate OpenAI through an undocumented dashboard change;
* use `--keep-vars` during the controlled staged upload;
* activate provider experiment routing;
* enable mobile cohort transport;
* enable Anthropic;
* enable cross-provider fallback;
* expand remote Coach beyond Sessions 2 and 7 suggested questions;
* enable free text;
* treat a successful synthetic smoke as real-user authorization;
* claim Android QA passed;
* bypass source review before commit or deployment.

## File-Aware Review Workflow

After any implementation change:

1. Extract actual changed paths.
2. Verify `git status --short`.
3. Verify `git diff --stat`.
4. Inspect the relevant diff when needed.
5. Upload exact changed and relevant source files for review.
6. Review real file contents.
7. Separate blockers, risks and optional improvements.
8. Run validation only after source-level review is clean.
9. Commit and push only after review and validation acceptance.

Codex summaries alone are not implementation acceptance evidence.
