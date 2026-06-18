# DJ Lingo Coach API

Provider-neutral backend foundation for DJ Lingo Sprint 3B.4.1.

## Scope

This milestone includes:

- `GET /health`
- `POST /v1/coach/respond`
- request contract validation
- request ID echo
- typed API errors
- request body size checks
- Cloudflare Rate Limiting binding boundary
- mock structured coach response

This milestone intentionally does **not** include:

- OpenAI, Anthropic, Gemini or Workers AI provider SDKs
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

The coach endpoint returns a structured mock response that matches the mobile coach API contract.
