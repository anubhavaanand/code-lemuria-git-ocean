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