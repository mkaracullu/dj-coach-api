# DJ Coach API

Provider-neutral Cloudflare Workers backend for DJ Lingo’s text-based Coach capability.

## Current Milestone

**Sprint 3B.6 — Controlled OpenAI Production Activation**

Current stage:

**Real-User Activation Readiness**

OpenAI is selected as DJ Lingo’s initial production provider for the text-based Coach capability.

Selection does not mean activation.

Current runtime state:

* checked-in development provider mode: `mock`;
* deployed development provider mode: `mock`;
* deployed development Worker: `dj-coach-api`;
* deployed development environment value: `development`;
* checked-in production provider mode: `mock`;
* production Worker identity: `dj-coach-api-production`;
* production Worker deployment: not yet created;
* real-user OpenAI traffic: inactive;
* controlled OpenAI synthetic and real-iPhone verification: passed against the development Worker and rolled back;
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
7. Apply the short-window external-provider guard when an external provider is selected.
8. Atomically consume one global provider-call allowance.
9. Invoke the selected external provider exactly once.
10. Parse and structurally validate provider output.
11. Validate the backend Coach response contract and runtime semantic safety.
12. Use deterministic mock fallback when required, return the provider-neutral response and emit sanitized `coach_request_completed` telemetry.

The global allowance is consumed immediately before the external invocation
attempt. Product-scope, request-limiter and short-window provider-guard
rejections occur before global allowance consumption.

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

## Environment Boundaries

The top-level Wrangler configuration remains the existing development Worker:

```text
Worker: dj-coach-api
workers.dev endpoint: https://dj-coach-api.aidj-coach.workers.dev
ENVIRONMENT=development
COACH_PROVIDER=mock
```

The named `production` environment is a distinct Worker:

```text
Wrangler environment: production
Worker: dj-coach-api-production
workers.dev endpoint: https://dj-coach-api-production.aidj-coach.workers.dev
ENVIRONMENT=production
COACH_PROVIDER=mock
```

Wrangler names a named environment `<top-level-name>-<environment-name>`.
All production operations must therefore include `--env production`.
Development operations should include `--env=""` to target the top-level
development Worker explicitly.

Cloudflare keeps the two Workers' versions, deployments, variables, secrets and
rate-limit bindings separate. The production environment does not inherit the
top-level `vars` or rate-limit bindings; both are declared explicitly in
`wrangler.jsonc`.

`ENVIRONMENT` is currently informational. Source code accepts the binding but
does not branch on it. Isolation is provided by the distinct Worker,
environment-specific configuration, secrets and limiter namespaces.

No custom route or domain is configured. The separate `workers.dev` endpoint is
the accepted initial production endpoint.

## Rate-Limit Bindings

Each Worker uses two independent Cloudflare Rate Limiting bindings.

### Request-level limiter

```text
COACH_RATE_LIMITER
```

Development configuration:

```text
namespace: 1001
limit: 10
period: 60 seconds
```

Production configuration:

```text
namespace: 2001
limit: 10
period: 60 seconds
```

### External-provider guard

```text
COACH_PROVIDER_RATE_LIMITER
```

Development configuration:

```text
namespace: 1002
limit: 5
period: 60 seconds
```

Production configuration:

```text
namespace: 2002
limit: 5
period: 60 seconds
```

Cloudflare rate-limit namespace IDs are account-wide positive integer
identifiers. Reusing an ID across Workers shares counters. The production IDs
must therefore be confirmed as unused in the target account before the first
production upload.

The external-provider guard is mandatory for OpenAI and Anthropic runtime calls.

If the provider guard binding is:

* missing;
* throwing;
* malformed;
* rejecting the request;

the provider must not be invoked.

Mock mode remains usable without an external-provider call.

The provider limiter is a short-window cost and abuse guard. It is not a global daily budget counter.

## Global Provider-Call Cap

`COACH_PROVIDER_USAGE_CAP` is a SQLite-backed Durable Object binding. Each
Worker environment routes all external-provider attempts to one deterministic
object named `environment-wide-provider-calls`.

The application layer depends on an infrastructure-neutral
`ProviderUsageCapPort`. That contract contains only the UTC period key,
configured call limit and allowed/blocked allowance result. It has no
Cloudflare, Durable Object, SQLite, Wrangler or provider-specific dependency.

The current infrastructure adapter implements that port with a Cloudflare
Durable Object and SQLite storage. Another infrastructure could implement the
same port later without changing the Coach request flow. DynamoDB is one
possible future adapter example, not an accepted migration plan; this repository
contains no AWS implementation or configuration.

The cap guarantees:

* one atomic allowance decision across the Worker environment;
* deterministic enforcement under concurrent requests;
* one consumed allowance immediately before each external-provider attempt;
* failed, timed-out or fallback-producing provider attempts remain consumed;
* no consumption for mock responses, scope rejection, request-rate rejection or
  short-window provider-guard rejection;
* fail-closed behavior when the binding, configured limit or returned result is
  missing, malformed or unavailable.

The cap is shared across OpenAI, Anthropic and any experiment-selected external
provider. It counts provider attempts, not requests and not successful
responses. There are no automatic provider retries or cross-provider fallback.

Configuration:

```text
COACH_PROVIDER_DAILY_CALL_LIMIT=<POSITIVE_DAILY_CALL_LIMIT>
```

There is deliberately no checked-in default. External-provider modes fail
closed unless the value is an explicit positive safe integer and the Durable
Object binding is available. Mock mode does not require the value or consume
the cap.

Reset semantics:

* period: UTC calendar day;
* period key: `YYYY-MM-DD`;
* boundary: `00:00:00 UTC`;
* the current row is updated in a synchronous SQLite transaction;
* obsolete day rows are deleted during the next consumption attempt;
* concurrent attempts for the same environment are serialized by the Durable
  Object and transaction;
* changing the configured limit changes the ceiling applied to the existing
  current-day count; it does not reset usage.

Development and production use distinct Durable Object namespaces because
`dj-coach-api` and `dj-coach-api-production` are separate Worker environments
with separately declared bindings and migrations.

The development migration is also currently unapplied. A future development
deployment containing this class must use a direct mock deployment once before
version-only uploads can resume. This repository change does not alter the
currently deployed development Worker.

The Durable Object stores only the UTC period key and consumed call count. It
does not store user, profile, lesson, request, response, Session 7, IP, prompt,
provider-output, token or billing data. A future infrastructure cutover may
start a fresh operational daily counter or transfer only the active UTC day's
count; there is no current user or product data to migrate from this store.

This is a call-count ceiling. It is not a money-denominated budget, token budget,
provider billing ledger or substitute for an OpenAI project budget.

## Provider Usage Telemetry

The existing `coach_request_completed` structured event may now include these
allowlisted fields:

```text
providerUsageCapOutcome: allowed | blocked | unavailable
providerUsageCapLimit
providerUsageCapRemaining
providerLatencyMs
providerInputTokens
providerOutputTokens
providerTotalTokens
```

Provider latency covers the external-provider operation rather than total route
latency. Token fields are emitted only when provider metadata contains finite,
non-negative safe integers. A missing or invalid usage object produces no token
fields. Anthropic total tokens are safely derived from valid input and output
counts; OpenAI total tokens are accepted when valid and not lower than their
sum.

Telemetry never includes prompts, provider output, response bodies, request
bodies, learner context, API keys, authorization headers, raw exceptions,
unrestricted provider metadata or raw cohort identifiers.

No runtime pricing metadata has been accepted into the repository. Estimated
cost is therefore not emitted. Token telemetry may differ from final provider
billing and must not be treated as an invoice or a spend limit.

There is no public cap-inspection or mutation endpoint. During an operational
observation window, inspect only structured Worker logs:

```bash
npx wrangler tail --env production --format json
```

Use `providerUsageCapOutcome`, `providerUsageCapLimit` and
`providerUsageCapRemaining`; do not inspect or expose learner payloads. The
remaining value is an accurate post-consumption snapshot for that serialized
decision, but a later request may consume another allowance before the log is
read.

The OpenAI account or project must retain a separately verified provider-side
budget or usage control. That external control cannot be established or
verified from this repository.

## Current Development Deployment

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

The active version is the guarded development rollback target for Sprint 3B.6.

This development deployment, its bindings and guarded mock rollback version
must not be changed by production operations.

## Checked-In Production Baseline

The production environment exists only in repository configuration until a
Cloudflare deployment creates it.

Checked-in production configuration:

```text
Wrangler environment: production
Worker: dj-coach-api-production
workers_dev: true
ENVIRONMENT=production
COACH_PROVIDER=mock
COACH_RATE_LIMITER namespace: 2001, 10/60s
COACH_PROVIDER_RATE_LIMITER namespace: 2002, 5/60s
COACH_PROVIDER_USAGE_CAP class: ProviderUsageCap
Durable Object migration: provider-usage-cap-v1
```

The production configuration contains no:

* provider API key;
* OpenAI model or token variable;
* Anthropic variable or secret;
* provider-experiment variable or assignment secret;
* custom route;
* cross-provider fallback configuration.

`COACH_PROVIDER_DAILY_CALL_LIMIT` is also absent from the checked-in mock
baseline. It must be selected as an explicit operational rollout decision on a
future external-provider version.

Production must first be deployed in mock mode. The first accepted
production mock version ID becomes the authoritative production rollback
target. It must be recorded as `<PRODUCTION_MOCK_VERSION_ID>` in the operational
record before any later OpenAI-configured production version is deployed.

## Read-Only Runtime Preflight

Before any production operation, re-run read-only checks to detect configuration drift.

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
npx wrangler deployments list --env="" --json
npx wrangler deployments status --env="" --json
npx wrangler versions list --env="" --json
npx wrangler versions view 9729512a-d5d6-4f3a-aaa3-cc93678d1e9d --env="" --json
```

Secret names only:

```bash
npx wrangler secret list --env="" --format json
npx wrangler versions secret list --env="" --latest-version
```

Production configuration validation without upload or deployment:

```bash
npx wrangler deploy \
  --env production \
  --dry-run \
  --outdir /tmp/dj-coach-api-production-dry-run
```

After the production Worker has been created through the mock baseline
deployment, inspect only the production target with:

```bash
npx wrangler deployments list --env production --json
npx wrangler deployments status --env production --json
npx wrangler versions list --env production --json
npx wrangler versions view <PRODUCTION_VERSION_ID> --env production --json
npx wrangler secret list --env production --format json
npx wrangler versions secret list --env production --latest-version
```

The `--env production` flag is mandatory. These commands target
`dj-coach-api-production`; use `--env=""` to target `dj-coach-api` explicitly.

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

Read-only validation, version upload, deployment, mock-baseline creation and
rollback are ordinary operational actions and do not require separate
paid-provider approval. Paid provider requests, live provider evaluations and
real-user provider traffic require explicit approval. Uploading or deploying
configuration does not itself authorize a provider call.

### Current environment decisions

* preserve the existing `dj-coach-api` development Worker and guarded mock version;
* use the named `production` environment for the distinct `dj-coach-api-production` Worker;
* deploy production in mock mode before any provider secret or OpenAI-configured version;
* use production limiter namespaces `2001` and `2002`, separate from development `1001` and `1002`;
* pin `OPENAI_MODEL` to `gpt-5.4-mini-2026-03-17`;
* use `OPENAI_MAX_OUTPUT_TOKENS=400`;
* use staged Cloudflare version operations after the initial Durable Object migration;
* use `wrangler versions secret put`, not immediate `wrangler secret put`;
* do not use `--keep-vars`;
* keep provider experiment variables absent;
* keep mobile cohort transport disabled;
* keep Anthropic disabled;
* keep cross-provider fallback disabled;
* keep development version `9729512a-d5d6-4f3a-aaa3-cc93678d1e9d` as the development-only guarded mock rollback target;
* record the first accepted production mock version as the separate production rollback target;
* synthetic smoke success must not authorize real-user traffic.

## Production Mock Baseline and Durable Object Migration

Creating the production environment configuration does not create a remote
Worker or Durable Object namespace.

Cloudflare does not allow a version-only upload to introduce a new Durable
Object migration. The first production operation must therefore be
a direct mock deployment that creates `dj-coach-api-production`, applies
`provider-usage-cap-v1` and creates its isolated SQLite-backed Durable Object
namespace:

```bash
npx wrangler deploy \
  --env production \
  --message "<PRODUCTION_MOCK_VERSION_MESSAGE>" \
  --tag "<PRODUCTION_MOCK_TAG>"
```

This remote operation creates the Worker and initial Durable Object migration,
so its account target and irreversible migration intent must be reviewed first.
It does not require paid-provider authorization, remains mock-only and does not
make an OpenAI call or authorize provider, mobile or real-user traffic.

Capture the deployed version ID and inspect it:

```bash
npx wrangler versions view \
  <PRODUCTION_MOCK_VERSION_ID> \
  --env production \
  --json
```

The version must show:

```text
ENVIRONMENT=production
COACH_PROVIDER=mock
COACH_RATE_LIMITER namespace=2001, limit=10, period=60
COACH_PROVIDER_RATE_LIMITER namespace=2002, limit=5, period=60
COACH_PROVIDER_USAGE_CAP class=ProviderUsageCap
Durable Object migration=provider-usage-cap-v1
```

It must contain no provider or experiment secret and no OpenAI, Anthropic or
experiment variable. `COACH_PROVIDER_DAILY_CALL_LIMIT` remains absent in mock
mode.

After deployment, record `<PRODUCTION_MOCK_VERSION_ID>` as the authoritative
production rollback target and confirm:

```bash
npx wrangler deployments status --env production --json
npx wrangler versions view <PRODUCTION_MOCK_VERSION_ID> --env production --json
```

The production mock deployment does not authorize OpenAI, provider calls,
mobile traffic or real-user traffic.

After this migration has been applied, subsequent configuration changes may use
the staged `wrangler versions upload` and `wrangler versions deploy` flow.

## Production Staged Secret Preparation

Only after the production mock baseline is accepted may the production OpenAI
secret be prepared:

```bash
npx wrangler versions secret put OPENAI_API_KEY \
  --env production \
  --message "<SECRET_VERSION_MESSAGE>" \
  --tag "<SECRET_VERSION_TAG>"
```

The secret value is entered interactively.

The value must never appear:

* in the command;
* in shell history;
* in source;
* in documentation;
* in chat;
* in logs.

After the operation:

* capture the generated version ID;
* inspect the generated version through a read-only Wrangler command;
* confirm only the secret name, not its value;
* confirm no traffic was moved;
* confirm the active production deployment remains
  `<PRODUCTION_MOCK_VERSION_ID>`.

Secret presence alone does not activate OpenAI while the active provider mode remains `mock`.
It does not authorize OpenAI or a provider call.

## Future Production OpenAI Version Upload

The planned command shape for a future OpenAI-configured production version is:

```bash
npx wrangler versions upload \
  --env production \
  --var ENVIRONMENT:production \
  --var COACH_PROVIDER:openai \
  --var COACH_PROVIDER_DAILY_CALL_LIMIT:<DAILY_CALL_LIMIT> \
  --var OPENAI_MODEL:gpt-5.4-mini-2026-03-17 \
  --var OPENAI_MAX_OUTPUT_TOKENS:400 \
  --message "<VERSION_MESSAGE>" \
  --tag "<VERSION_TAG>"
```

`--keep-vars` must not be added.

Reason:

* required plain variables are provided explicitly;
* rate-limit bindings remain defined by `wrangler.jsonc`;
* the Durable Object binding and applied migration remain defined by `wrangler.jsonc`;
* dormant experiment variables remain absent;
* Anthropic variables remain absent;
* unexpected dashboard-managed variables are not preserved.

After upload:

* record the new version ID;
* inspect its non-secret variables;
* verify both rate-limit bindings;
* verify `COACH_PROVIDER_USAGE_CAP` and the positive daily limit;
* verify the OpenAI secret binding is present by name;
* verify Anthropic and experiment configuration remain absent;
* verify no traffic moved to the new version.

If the final staged version does not contain the expected secret and bindings, stop. Do not deploy it.

## Future Production Version Deployment

Deployment is a separate operational step from secret preparation and version upload.

Planned command shape:

```bash
npx wrangler versions deploy <NEW_VERSION_ID>@100% \
  --env production \
  --message "<DEPLOYMENT_MESSAGE>" \
  --yes
```

Before deployment, the local deployment checklist must confirm:

* provider;
* exact model;
* locally verified version ID;
* exact Worker/account target;
* output-token ceiling;
* active bindings;
* success conditions;
* stop conditions;
* rollback target;
* whether any real-user traffic is included.

A deployment does not itself authorize a paid provider request.

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

## Production Rollback-to-Mock

Primary production rollback target:

```text
<PRODUCTION_MOCK_VERSION_ID>
```

The production target is recorded only after the first production
mock deployment. Do not use the development rollback version for production.

Planned production rollback command:

```bash
npx wrangler rollback \
  <PRODUCTION_MOCK_VERSION_ID> \
  --env production \
  --message "<ROLLBACK_REASON>" \
  --yes
```

Rollback may be executed immediately when a stop condition is reached or when returning the environment to its accepted mock baseline. It does not require a separate approval.

Expected rollback result:

* 100% traffic returns to the guarded mock version;
* `COACH_PROVIDER=mock`;
* `ENVIRONMENT=production`;
* both rate-limit bindings restored;
* external provider invocation disabled;
* no experiment variables active.

After rollback, verify through read-only commands:

* active deployment;
* active version;
* provider mode;
* bindings;
* no external provider attempt.

Secondary production fallback:

```bash
npx wrangler deploy --env production
```

This directly deploys the current checked-in production mock configuration as a
new version. It is not the preferred staged path and should be used only when
the recorded production mock version is unavailable or unsuitable.

The recorded production mock version is the preferred deterministic production
rollback target. The development target
`9729512a-d5d6-4f3a-aaa3-cc93678d1e9d` remains unchanged and applies only to
`dj-coach-api`.

## Real-iPhone Verification

Real-iPhone remote Coach verification was completed in Sprint 3B.6 Stage 4.

The accepted verification evidence covers:

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

* explicit operational ownership;
* an accepted positive production daily call ceiling;
* provider-side project budget controls verified outside this repository;
* retained/queryable monitoring and alert thresholds for cap, failure, latency
  and token telemetry;
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
