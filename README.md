# DJ Coach API

Provider-neutral backend foundation for DJ Lingo, including the Sprint
3B.4.2B OpenAI reference adapter.

## Scope

This milestone includes:

- `GET /health`
- `POST /v1/coach/respond`
- request contract validation
- request ID echo
- typed API errors
- request body size checks
- Cloudflare Rate Limiting binding boundary
- mock structured coach response by default
- opt-in OpenAI reference adapter for local evaluation

This milestone intentionally does **not** include:

- model API keys
- conversation history
- database persistence
- audio, video or controller scene actions
- mobile UI switch to remote coach

## Setup

```bash
npm install -D wrangler typescript vitest @cloudflare/workers-types
npm run typecheck
npm test
npm run dev
```

## Endpoints

```text
GET /health
POST /v1/coach/respond
```

The coach endpoint returns the deterministic structured mock response unless
the backend is explicitly configured for OpenAI. The mobile CoachPanel remains
disconnected from this remote provider path in this milestone.

## OpenAI reference evaluation

OpenAI is a reference adapter for provider comparison, not the selected
production provider. No SDK dependency is used; the Worker calls the Responses
API with `fetch`.

Keep Worker runtime secrets in `.dev.vars` and live-evaluation secrets in the
shell environment. Never commit the key:

```dotenv
OPENAI_API_KEY=replace-with-a-local-secret
```

Default tests never make provider calls and require no provider configuration:

```bash
npm run typecheck
npm test -- --configLoader runner
```

Live evaluation requires all opt-in values below. Keep the fixture limit small
for the initial budget:

```bash
COACH_LIVE_EVALUATION=true \
OPENAI_API_KEY="$OPENAI_API_KEY" \
OPENAI_MODEL="your-reference-model" \
COACH_EVAL_FIXTURE_LIMIT=3 \
npm run eval:openai -- --configLoader runner
```

To rerun specific fixtures, provide their comma-separated IDs:

```bash
COACH_LIVE_EVALUATION=true \
OPENAI_API_KEY="$OPENAI_API_KEY" \
OPENAI_MODEL="your-reference-model" \
COACH_EVAL_FIXTURE_IDS="goal-short-practice-mix,unsupported-room-audio-camera,injection-fake-audio-analysis" \
npm run eval:openai -- --configLoader runner
```

`COACH_EVAL_FIXTURE_IDS` takes precedence over
`COACH_EVAL_FIXTURE_LIMIT`. Unknown or empty fixture ID selections fail before
provider calls.

Optional cost estimates can be enabled with
`OPENAI_INPUT_COST_PER_MILLION_USD` and
`OPENAI_OUTPUT_COST_PER_MILLION_USD`. Verify current model pricing before
setting them. Evaluation reports are printed to stdout and do not include raw
provider output.

Invalid-output reports include only safe diagnostic categories such as HTTP
status, parse/extraction/validation stage, public field names, validation
failure code, limit flags, and deterministic-fallback usage. They never include
raw provider output, prompts, request bodies, keys, or provider metadata.

For local language QA, set
`COACH_LIVE_EVALUATION_PRINT_SAFE_TEXT=true` to include only the validated
public `message`, `nextActionLabel`, `responseType`, and `fallbackReasonId` in
the report. It remains disabled by default and never prints prompts, request
context, API keys, or raw provider responses.

Runtime provider configuration uses:

- `COACH_PROVIDER=mock` (default) or `COACH_PROVIDER=openai`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_MAX_OUTPUT_TOKENS` (optional, constrained to 100–800)

OpenAI runtime mode activates only when the provider, key, and model are all
present. Provider failures and invalid structured output use the deterministic
fallback, and the public Coach API contract remains unchanged.
