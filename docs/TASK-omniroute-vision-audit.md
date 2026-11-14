# Task: audit and fix DSH model capability metadata for a vision-model QA pass

You are working on a live machine. Do not guess — read the files and run the commands.

## The situation

DeepSeek Harness (DSH) is installed at `/home/anubhavanand/.local/lib/node_modules/@deepseek-ai/dsh/` (version `0.2.1-rc.5`). It talks to a local OpenAI-compatible gateway called **OmniRoute** (`omniroute v16.4.2`, pid varies) listening on `http://127.0.0.1:20128/v1`. DSH's provider block is `/home/anubhavanand/.dsh/profiles/web/cordis.patch.yml` (535 lines, 37 models, provider id `omni-route`).

OmniRoute's own logs are at `/home/anubhavanand/.omniroute/logs/application/app.log` (newline-delimited JSON). Notes on the setup are at `/home/anubhavanand/omniroute-openwork-dsh-notes.md`.

## What is actually broken

An agent running on DSH needs to send a PNG to a vision model and get a verdict back. It cannot. Every subagent call on a VL model fails with **no closing message**. The cause is now known and it is **not** DSH config:

From `app.log`, verbatim:
```
Model-only lockout for openrouter:nvidia/nemotron-3.5-super-vl:free — 429 rate_limited 24s (failureCount=4, connection stays active)
openrouter | all 1 active accounts cooling down for model nvidia/nemotron-3.5-super-vl:free (reset after 24s) | lastErrorCode=429.0, lastError=Model nvidia/nemotron-3.5-super-vl:free rate_limit
[openrouter/nvidia/nemotron-3.5-super-vl:free] all credentials cooling down (reset after 24s)
COOLDOWN_RETRY openrouter/nvidia/nemotron-3.5-super-vl:free cooldown elapsed — restarting request (retry 3/3)
```
Counts in the log: 114 COOLDOWN_RETRY, 89 AUTH (level 40), 35 CHAT (level 40), 20 RETRY, 8 STREAM (level 40), 3 EMERGENCY_FALLBACK.

The free OpenRouter VL tier is rate-limited upstream. Every `:free` model shares that problem.

## What you must establish

1. **Which OmniRoute models can actually accept an image today, empirically.** Do not trust either the `input:` block in `cordis.patch.yml` or the model name. "omni" in a name is not evidence of vision: `kc/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` has no `input:` block and, when called with an image, replied `NO_IMAGE_INPUT`.

   Method: for each candidate, POST a minimal chat completion to `http://127.0.0.1:20128/v1/chat/completions` with a real `image_url` data URL (a 4x4 PNG is enough), `max_tokens: 16`, and the prompt "What colour is this image? One word." Record for each: model id, HTTP status, upstream status if the body carries one, latency, and the reply text or error body. Find the API key: it is in `~/.dsh/.credentials.yaml` and/or `~/.omniroute/.env`, referenced by `apiKeyEnv: OMNI_ROUTE_API_KEY`.

   Also list the full model catalogue from the gateway: `GET /v1/models`. Report how many models it advertises, and how many declare image input, so we can see how incomplete the hand-written 37-model list in `cordis.patch.yml` is.

2. **Whether DSH's own metadata is honest.** In the checkout, the capability field is `inputModalities` (`ModelModality[]`, values `"text" | "image"`), defined in `node_modules/@deepseek-ai/dsh-llm/lib/typert.host.js` and consumed at `node_modules/@deepseek-ai/dsh-llm/lib/index.js:2337` (`if (modelInfo.inputModalities !== void 0 && !modelInfo.inputModalities.includes("image") && projectedMessages.some((message) => contentHasImage(message.content))) projectedMessages = projectImagesForTextModel(projectedMessages)`).

   Establish: how does the `llm-pi-ai` adapter turn the YAML `input:` list into `inputModalities`? Where does an *absent* `input:` land — `undefined` (unknown, image allowed through) or `[]` (explicitly no image)? This matters because DSH treats an explicit omission as negative capability and silently rewrites images to text placeholders, which is a silent failure mode, not an error.

3. **Whether a better route exists than the free VL tier.** The user pays for nothing here but has multiple OmniRoute accounts/providers configured (kilocode OAuth, openrouter, groq, mistral, ds-web DeepSeek). Determine which of those can serve an image request without a 429, and what the cost/authorization situation is. Report options; do not make purchases or enter credentials anywhere new.

## Deliverable

A single markdown report, `docs/OMNIROUTE-VISION-AUDIT.md` in `/home/anubhavanand/Documents/Git-Ocean/` (that repo is the consumer of this capability), containing:

- A table of every model you probed: id, HTTP status, whether it genuinely saw the image, latency, error body if any.
- The DSH capability-metadata trace with exact file paths and line numbers, and the answer to the absent-`input:` question.
- A recommendation: which model id an agent should put in a subagent call to get a vision verdict today, and what to change in `cordis.patch.yml` (concrete diff, do not apply it) so the picker shows the truth.
- If any part could not be established, say so explicitly rather than inferring.

Constraints: read-only on `/home/anubhavanand/.dsh/` except for writing that one report. Do not restart OmniRoute. Do not modify the DSH installation. Do not spend money. Report exact commands and their real output for anything you claim.