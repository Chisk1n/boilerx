/**
 * Cost estimation for LLM-backed agents.
 *
 * IMPORTANT: This is an *estimate*, not an authoritative bill.
 *
 * The Cursor SDK does not surface USD cost or token counts on its run results
 * (verified against `RunResult` in @cursor/sdk dist types). Until it does, we
 * approximate cost from:
 *   1. token-counted prompt (input)
 *   2. token-counted response.result (output)
 *   3. per-million-token pricing per model
 *
 * Errors of ±30% are normal — different tokenizers count slightly differently,
 * thinking/tool-call tokens we don't see still get billed, and provider
 * pricing changes faster than this map. Use the orchestrator's
 * `--max-cost-usd` flag with a margin, and reconcile with the Cursor
 * dashboard for ground truth.
 *
 * Override `MODEL_PRICING` at runtime via `BOILERX_PRICING` env var (JSON):
 *
 *   BOILERX_PRICING='{"composer-2":{"inputPerMTokens":3,"outputPerMTokens":15}}'
 */

export interface ModelPricing {
  /** USD per 1,000,000 input (prompt) tokens. */
  readonly inputPerMTokens: number;
  /** USD per 1,000,000 output (completion) tokens. */
  readonly outputPerMTokens: number;
}

/**
 * Defaults are best-effort approximations as of 2026-05. They are *not*
 * official Cursor pricing — the SDK doesn't expose authoritative numbers and
 * Cursor's dashboard is the source of truth. Tune via `BOILERX_PRICING` if
 * you have the actual numbers for your account/plan.
 */
export const DEFAULT_PRICING: Readonly<Record<string, ModelPricing>> = {
  "composer-2": { inputPerMTokens: 3.0, outputPerMTokens: 15.0 },
  "composer-1.5": { inputPerMTokens: 2.0, outputPerMTokens: 10.0 },
  "claude-sonnet-4-6": { inputPerMTokens: 3.0, outputPerMTokens: 15.0 },
  "claude-sonnet-4-5": { inputPerMTokens: 3.0, outputPerMTokens: 15.0 },
  "claude-opus-4-7": { inputPerMTokens: 15.0, outputPerMTokens: 75.0 },
  "gpt-5.5-medium": { inputPerMTokens: 5.0, outputPerMTokens: 20.0 },
  "gpt-5.3-codex": { inputPerMTokens: 5.0, outputPerMTokens: 20.0 },
  "gpt-5.3-codex-high-fast": { inputPerMTokens: 5.0, outputPerMTokens: 20.0 },
  "gemini-3.1-pro": { inputPerMTokens: 1.25, outputPerMTokens: 10.0 },
} as const;

/**
 * Fallback used when the requested model is not in the pricing map. Set high
 * enough on output that an unknown-model run conservatively reports more
 * cost rather than less — protects the user's budget cap.
 */
export const FALLBACK_PRICING: ModelPricing = {
  inputPerMTokens: 5.0,
  outputPerMTokens: 20.0,
};

export interface CostEstimate {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly inputUsd: number;
  readonly outputUsd: number;
  readonly totalUsd: number;
  readonly model: string;
  readonly modelKnown: boolean;
}

/**
 * Estimate the number of tokens in a string.
 *
 * Uses the OpenAI rule of thumb: ~1 token per 4 characters of English text.
 * For non-English / heavily-symbolic text the real count can be 1.3-2x
 * higher; we accept this drift because it makes our estimate biased toward
 * "report more cost than reality", which is the right side of the budget cap
 * to err on.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export interface EstimateRunCostInput {
  readonly prompt: string;
  readonly response: string;
  readonly model: string;
  readonly pricing?: Readonly<Record<string, ModelPricing>>;
}

export function estimateRunCost(input: EstimateRunCostInput): CostEstimate {
  const pricing = input.pricing ?? loadPricing();
  const modelPricing = pricing[input.model];
  const effective = modelPricing ?? FALLBACK_PRICING;

  const inputTokens = estimateTokens(input.prompt);
  const outputTokens = estimateTokens(input.response);
  const inputUsd = (inputTokens / 1_000_000) * effective.inputPerMTokens;
  const outputUsd = (outputTokens / 1_000_000) * effective.outputPerMTokens;
  const totalUsd = round6(inputUsd + outputUsd);

  return {
    inputTokens,
    outputTokens,
    inputUsd: round6(inputUsd),
    outputUsd: round6(outputUsd),
    totalUsd,
    model: input.model,
    modelKnown: modelPricing !== undefined,
  };
}

/**
 * Reads pricing overrides from `BOILERX_PRICING` (JSON) and merges over
 * `DEFAULT_PRICING`. Bad JSON is ignored (with a one-time stderr warning).
 * Bad shapes per-entry are silently dropped.
 */
let cachedLoadedPricing: Readonly<Record<string, ModelPricing>> | null = null;
let warnedAboutBadEnv = false;

export function loadPricing(): Readonly<Record<string, ModelPricing>> {
  if (cachedLoadedPricing) return cachedLoadedPricing;
  const merged: Record<string, ModelPricing> = { ...DEFAULT_PRICING };
  const raw = process.env.BOILERX_PRICING;
  if (raw && raw.trim() !== "") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [model, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (
            value &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            typeof (value as ModelPricing).inputPerMTokens === "number" &&
            typeof (value as ModelPricing).outputPerMTokens === "number"
          ) {
            merged[model] = {
              inputPerMTokens: (value as ModelPricing).inputPerMTokens,
              outputPerMTokens: (value as ModelPricing).outputPerMTokens,
            };
          }
        }
      }
    } catch (err) {
      if (!warnedAboutBadEnv) {
        warnedAboutBadEnv = true;
        const detail = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[boilerx] BOILERX_PRICING is invalid JSON, using defaults: ${detail}\n`);
      }
    }
  }
  cachedLoadedPricing = merged;
  return cachedLoadedPricing;
}

/** For tests only: clears the cached pricing map. */
export function __resetPricingCache(): void {
  cachedLoadedPricing = null;
  warnedAboutBadEnv = false;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
