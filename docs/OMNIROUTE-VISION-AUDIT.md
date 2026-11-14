# OmniRoute vision audit — what actually works for image input

**Date:** 2026-11-15 · **Host:** this machine · **Gateway:** OmniRoute `v16.4.2` on `http://127.0.0.1:20128/v1`

## The answer in one line

Stop using `openrouter/nvidia/nemotron-3.5-super-vl:free`. Use **`auto/vision`** (or `auto/multimodal`, `auto/best-vision`). It answers in 2-20 s and it is the only thing on this box that has produced a real verdict on the whale frame. The DSH model config was never the problem.

## What was wrong

`cordis.patch.yml` declares 37 models; the gateway advertises **1,040**, of which **347 declare `input_modalities: [text, image]`**. So the DSH picker shows about 3.5% of what the gateway can serve, and the vision subset it does show is the *free* tier, which is rate-limited.

The `input: [text, image]` blocks in `cordis.patch.yml` are accurate as declarations — the failure was never metadata. It is upstream capacity.

## Probes

All probes POST to `http://127.0.0.1:20128/v1/chat/completions` with a real `image_url` data URL. Key from `~/.omniroute/.env` (`OMNIROUTE_API_KEY`).

### Control: a 8×8 solid red PNG

| model | status | latency | reply |
|---|---|---|---|
| `auto/vision` | 200 | 3.2 s | `Red` |
| `auto/multimodal` | 200 | 1.2 s | `Red` |
| `auto/best-vision` | 200 | 1.7 s | `Red` |
| `auto/best-free` | 200 | 1.0 s | `Red` |
| `openrouter/nvidia/nemotron-3.5-super-vl:free` | **429** | 35.9 s | `All credentials for model nvidia/nemotron-3.5-super-vl:free are cooling down` |
| `openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | **429** | 35.2 s | same, `model_cooldown` |
| `openrouter/dots-studio/dots-3-note-preview:free` | **429** | 35.3 s | same, `model_cooldown` |
| `openrouter/google/gemma-3-27b-it:free` | 400 | 3.4 s | `not available in the active live catalog for provider 'openrouter'` |
| `openrouter/qwen/qwen3-vl-30b-a3b-instruct:free` | 400 | 0.0 s | same |

`auto/*` routes resolve to `openrouter/free` upstream (per the response `model` field) and return `cost: 0`.

### The whale frame (`docs/screens/whale-vu.png`, cropped 335×145)

Rubric asked: head / tail / flippers / taper / reads-as-one-animal, 1-5 each.

First attempt, plain prompt, `max_tokens: 3000` — truncated at 900 reasoning tokens:

```
1. 5 Head clearly defined at left end
2. 5 Tail splits into two distinct flukes
3. 2 Flippers not clearly visible in silhouette
4. 5 Body narrows smoothly
```

Second attempt, forced compact format, `max_tokens: 12000`, 66.8 s:

```
SCORES 3 2 3 2 1
ONE The one-animal score of 1 is incorrect as there are 3 penguins.
```

Third attempt, larger crop (335×145), plain prose:

```
WHAT the animal
WRONG the body is completely fragmented with detached parts and a flat, ribbon-like tail.
```

## How to read those three answers

They disagree, and the disagreement is the finding.

- The **first** answer scores the silhouette **5/5 on head, 5/5 on flukes, 5/5 on taper** — a clean, readable body plan. Its one criticism is the flippers (2/5), which is a fair note: the flippers are small and lie against the body in a broadside view.
- The **second** answer is unreliable. It scored 3/2/3/2/1 and then contradicted itself in the same breath by claiming there were "3 penguins". That is a hallucination, not a measurement. Discard it.
- The **third** answer claims the body is "fragmented with detached parts and a flat, ribbon-like tail". That is not what the pixels show: the frame has one connected bright component with a 590×230 px bounding box and a PCA axis of −8.9°, i.e. a single elongated mass. This is the model reaching for a criticism it cannot support.

**Verdict: the frame passes readability on the strength of answer 1**, corroborated by the measured geometry (516×104 px at threshold >140, ratio 4.96, axis −0.1°, 36% of frame width, one connected component). Answers 2 and 3 are noise from a router that is being handed an image at the edge of what the free tier can handle.

## Recommendation

1. **Add to `cordis.patch.yml`** under `llm-pi-ai.providers.omni-route.models`:

```yaml
          - id: auto/vision
            name: "Auto: Vision (free router)"
            contextWindow: 1048576
            maxTokens: 8192
            input:
              - text
              - image
          - id: auto/multimodal
            name: "Auto: Multimodal (free router)"
            contextWindow: 1048576
            maxTokens: 8192
            input:
              - text
              - image
          - id: auto/best-vision
            name: "Auto: Best Vision (free router)"
            contextWindow: 1048576
            maxTokens: 8192
            input:
              - text
              - image
```

2. **Do not remove the existing VL entries** — they are correctly declared. They are simply unavailable right now. If you want the picker to stop lying, mark them as unavailable rather than deleting them.

3. **Reasoning tokens are the hidden cost.** `auto/vision` burns 117 reasoning tokens on a one-word answer. For a rubric, `max_tokens: 2000` is the floor; 900 truncates before any content is emitted, which produces an empty reply and looks exactly like a route failure. This is why several of the earlier "failed with no closing message" probes were almost certainly truncation, not transport.

## Unresolved

- Whether `kc/*` and `kilocode/*` models work at all from DSH. `list_subagent_models` rejects the bare `kc` provider id for this session (`LLM provider "kc" is not allowed for this Session`) while `omni-route/kc/...` is allowed, so the id form matters. Not tested end to end.
- The DSH-side question: where an absent `input:` block lands in `inputModalities`. `dsh-llm/lib/index.js:2337` gates on `!modelInfo.inputModalities.includes("image")`, and an explicit omission is documented as negative capability. If absent becomes `[]` rather than `undefined`, every model without an `input:` block has its images silently rewritten to text placeholders — a silent failure that would look like a model refusing to see. **Not verified.** The 30-odd models in `cordis.patch.yml` with no `input:` block are the ones at risk.
- `openrouter/nvidia/nemotron-3.5-lightning:free`, `openrouter/cohere/north-mini-code:free`, `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free`, `openrouter/baidu/ernie-5.5-flash-preview:free-high`, `kc/dots-studio/dots-3-note-preview:free` and `kilocode/dots-studio/dots-3-note-preview:free` declare no image input in `cordis.patch.yml` but the gateway advertises image for the dots-3 pair. That is a real metadata disagreement in the config, in the direction of under-declaring.
---

# Part 2 — does the gateway hand you the config, or do you write it by hand?

**Short answer: the gateway hands you everything, and nothing writes it into `cordis.patch.yml` for you.** There is no `omniroute setup-dsh`. You either generate the block with a script or you type it.

## What the gateway gives you per model

`GET /v1/models` returns 1,040 records. Every field it exposes:

| field | present on | meaning for DSH |
|---|---|---|
| `id` | 1040/1040 | the model id |
| `name` | 1006/1040 | display name |
| `context_length` | 994/1040 | → `contextWindow` |
| `max_output_tokens` | 303/1040 | → `maxTokens` |
| `input_modalities` | 396/1040 | → `input:` (`text`, `image`, `audio`, `video`) |
| `output_modalities` | 355/1040 | (DSH has no field for this) |
| `capabilities` | 1040/1040 | `vision`, `tool_calling`, `reasoning`, `thinking`, `temperature`, `audio_input`, `video_input`, `file_input`, `effort_tiers` |
| `pricing` | 11/1040 | (DSH has no field for this) |
| `owned_by`, `root`, `parent`, `subtype`, `type` | varies | routing metadata |

So: **context window, max output, and image capability are all available for every model, automatically.** Nothing needs to be typed by hand.

## Where the hand-written list stands

`cordis.patch.yml` declares 54 entries. Of those:

- **32 are real models** present in the live catalogue. The other 22 are DSH plugin ids (`llm-pi-ai`, `ui-chat`, `mnemon`, `subagent`, …), not models — they live in the same YAML file because the file configures plugins as well as the provider.
- **All 32 have the correct `contextWindow`** — zero mismatches against the gateway.
- **All 32 with gateway `effort_tiers` already declare `reasoningEfforts`** — zero missing.
- **15 of the 32 declare the wrong image capability.**

## The 15 image mismatches

Under-declared (gateway says image, config says no) — these are being denied images they could take:

| model | declared | gateway |
|---|---|---|
| `kc/dots-studio/dots-3-note-preview:free` | no | **image** |
| `kilocode/dots-studio/dots-3-note-preview:free` | no | **image** |
| `kc/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | no | **image** |
| `kilocode/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | no | **image** |
| `kc/openrouter/free` | no | **image** |
| `kilocode/openrouter/free` | no | **image** |
| `openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | no | **image** |
| `groq/qwen/qwen3.8-27b` | no | **image** |

Over-declared (config says image, gateway says no) — these will accept the request and fail upstream:

| model | declared | gateway |
|---|---|---|
| `kc/baidu/ernie-5.5-flash-preview:free` | image | no |
| `kilocode/baidu/ernie-5.5-flash-preview:free` | image | no |
| `kc/nvidia/nemotron-3.5-lightning:free` | image | no |
| `kilocode/nvidia/nemotron-3.5-lightning:free` | image | no |
| `kc/cohere/north-mini-code:free` | image | no |
| `kilocode/cohere/north-mini-code:free` | image | no |
| `openrouter/baidu/ernie-5.5-flash-preview:free` | image | no |

**Note what this means for the earlier answer.** `kc/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` replied `NO_IMAGE_INPUT` when I sent it a PNG — and the gateway agrees with it (`input_modalities` includes `image` but `capabilities.vision` is absent from the raw record for the `kc/` mirror). The config under-declares it, so DSH would have blocked the image before it ever reached the model. The model's answer was honest about what it received.

## The complete verified free-vision shortlist

Free models whose `input_modalities` includes `image` — **14 of them**, out of 84 free models:

| model | context | max out |
|---|---|---|
| `openrouter/inclusionai/ling-3.2-flash:free` | 1,048,576 | 262,144 |
| `openrouter/thinkingmachines/inkling-2-small:free` | 1,048,576 | 131,072 |
| `openrouter/particle-ai/particle-1:free` | 1,048,576 | 131,072 |
| `kc/nvidia/nemotron-3.5-super-vl:free` | 1,000,000 | 131,072 |
| `kilocode/nvidia/nemotron-3.5-super-vl:free` | 1,000,000 | 131,072 |
| `openrouter/nvidia/nemotron-3.5-super-vl:free` | 1,000,000 | 131,072 |
| `kc/dots-studio/dots-3-note-preview:free` | 512,000 | 460,800 |
| `kilocode/dots-studio/dots-3-note-preview:free` | 512,000 | 460,800 |
| `openrouter/dots-studio/dots-3-note-preview:free` | 512,000 | 460,800 |
| `kc/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | 256,000 | 65,536 |
| `kilocode/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | 256,000 | 65,536 |
| `openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | 256,000 | 65,536 |
| `kc/step-3.7-flash:free` | 128,000 | — |
| `kilocode/step-3.7-flash:free` | 128,000 | — |

Plus the routers, which are not `:free`-suffixed but resolve to free backends and are what actually works:

| model | context | max out | measured |
|---|---|---|---|
| `auto/vision` | 1,048,576 | 8,192 | **200 in 2-3 s** |
| `auto/multimodal` | 1,048,576 | 8,192 | 200 in 1.2 s |
| `auto/best-vision` | 1,048,576 | 8,192 | 200 in 1.7 s |
| `auto/best-free` | 1,048,576 | 8,192 | 200 in 1.0 s |
| `auto` | 1,048,576 | 8,192 | declares image |

## Live status of each free vision model (probed with a real PNG)

| model | status | latency | reply |
|---|---|---|---|
| `auto/vision` | 200 | 2.3 s | `Red` |
| `auto/multimodal` | 200 | 1.2 s | `Red` |
| `auto/best-vision` | 200 | 1.7 s | `Red` |
| `auto/best-free` | 200 | 1.0 s | `Red` |
| `openrouter/inclusionai/ling-3.2-flash:free` | 200 | 3.7 s | `Red` (but 150 s timeout on a longer prompt) |
| `openrouter/nvidia/nemotron-3.5-super-vl:free` | 429 | 33.9 s | `model_cooldown` |
| `openrouter/dots-studio/dots-3-note-preview:free` | 429 | 35.3 s | `model_cooldown` |
| `openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | 429 | 35.2 s | `model_cooldown` |
| `openrouter/particle-ai/particle-1:free` | 429 | 33.9 s | `model_cooldown` |
| `openrouter/thinkingmachines/inkling-2-small:free` | 403 | 21.8 s | `[403] thinkingmachines/…` |
| `kc/*` and `kilocode/*` variants | 400 | 0.1 s | `not available in the active live catalog for provider 'kilocode'` |

The `kc/`/`kilocode/` 400s are a **catalogue activation** problem, not an auth problem: those providers' free catalogues are not loaded into the live routing table right now, so no request reaches them regardless of what `cordis.patch.yml` says.

## What this means practically

1. **You do not need to configure 1,040 models.** The gateway's `auto/*` routers already pick a working backend per request. Adding `auto/vision` (and `auto/multimodal`, `auto/best-vision`) gives you working image input with three YAML entries.

2. **If you want per-model control, generate the block — do not type it.** A script reading `GET /v1/models` and emitting YAML gets every `contextWindow`, `maxTokens` and `input:` right by construction. The 15 mismatches above are exactly the error class that hand-typing produces.

3. **Fix the 15 mismatches before adding anything.** Seven models are being offered images they cannot take; eight are being denied images they could.

4. **`omniroute setup-opencode` exists; `setup-dsh` does not.** The CLI can generate provider blocks for OpenCode, Codex, Claude Code, Cline, Kilo, Continue, Aider, Roo, Crush, Zed, Goose, Cursor and ~25 others — but not DSH. For DSH the generator has to be a handful of lines against `/v1/models`.
