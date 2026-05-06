import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PRICING,
  FALLBACK_PRICING,
  __resetPricingCache,
  estimateRunCost,
  estimateTokens,
  loadPricing,
} from "../src/cost.js";

describe("estimateTokens", () => {
  it("returns 0 for empty input", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("uses ceil(chars/4) heuristic", () => {
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(100))).toBe(25);
  });
});

describe("estimateRunCost", () => {
  it("computes cost for a known model", () => {
    const cost = estimateRunCost({
      prompt: "a".repeat(4000),
      response: "b".repeat(4000),
      model: "composer-2",
      pricing: DEFAULT_PRICING,
    });
    expect(cost.inputTokens).toBe(1000);
    expect(cost.outputTokens).toBe(1000);
    expect(cost.inputUsd).toBeCloseTo(0.003, 6);
    expect(cost.outputUsd).toBeCloseTo(0.015, 6);
    expect(cost.totalUsd).toBeCloseTo(0.018, 6);
    expect(cost.modelKnown).toBe(true);
  });

  it("flags unknown models and falls back", () => {
    const cost = estimateRunCost({
      prompt: "a".repeat(400),
      response: "b".repeat(400),
      model: "made-up-model",
      pricing: DEFAULT_PRICING,
    });
    expect(cost.modelKnown).toBe(false);
    const expectedInput = (100 / 1_000_000) * FALLBACK_PRICING.inputPerMTokens;
    const expectedOutput = (100 / 1_000_000) * FALLBACK_PRICING.outputPerMTokens;
    expect(cost.inputUsd).toBeCloseTo(expectedInput, 6);
    expect(cost.outputUsd).toBeCloseTo(expectedOutput, 6);
  });

  it("zero-length prompt + response yields zero cost", () => {
    const cost = estimateRunCost({
      prompt: "",
      response: "",
      model: "composer-2",
      pricing: DEFAULT_PRICING,
    });
    expect(cost.totalUsd).toBe(0);
  });

  it("uses provided pricing override when supplied", () => {
    const customPricing = {
      "composer-2": { inputPerMTokens: 1.0, outputPerMTokens: 1.0 },
    };
    const cost = estimateRunCost({
      prompt: "a".repeat(4000),
      response: "b".repeat(4000),
      model: "composer-2",
      pricing: customPricing,
    });
    expect(cost.totalUsd).toBeCloseTo(0.002, 6);
  });
});

describe("loadPricing", () => {
  beforeEach(() => {
    __resetPricingCache();
    delete process.env.BOILERX_PRICING;
  });
  afterEach(() => {
    __resetPricingCache();
    delete process.env.BOILERX_PRICING;
  });

  it("returns DEFAULT_PRICING when BOILERX_PRICING is unset", () => {
    const p = loadPricing();
    expect(p["composer-2"]).toEqual(DEFAULT_PRICING["composer-2"]);
  });

  it("merges valid BOILERX_PRICING JSON over defaults", () => {
    process.env.BOILERX_PRICING = JSON.stringify({
      "composer-2": { inputPerMTokens: 99, outputPerMTokens: 100 },
      "new-model": { inputPerMTokens: 1, outputPerMTokens: 2 },
    });
    const p = loadPricing();
    expect(p["composer-2"]).toEqual({ inputPerMTokens: 99, outputPerMTokens: 100 });
    expect(p["new-model"]).toEqual({ inputPerMTokens: 1, outputPerMTokens: 2 });
    expect(p["claude-sonnet-4-6"]).toEqual(DEFAULT_PRICING["claude-sonnet-4-6"]);
  });

  it("ignores invalid JSON silently and uses defaults", () => {
    process.env.BOILERX_PRICING = "this is not json";
    const p = loadPricing();
    expect(p["composer-2"]).toEqual(DEFAULT_PRICING["composer-2"]);
  });

  it("ignores entries with missing or non-numeric fields", () => {
    process.env.BOILERX_PRICING = JSON.stringify({
      "composer-2": { inputPerMTokens: "free" },
      "valid-model": { inputPerMTokens: 5, outputPerMTokens: 10 },
    });
    const p = loadPricing();
    expect(p["composer-2"]).toEqual(DEFAULT_PRICING["composer-2"]);
    expect(p["valid-model"]).toEqual({ inputPerMTokens: 5, outputPerMTokens: 10 });
  });

  it("caches the result across calls", () => {
    process.env.BOILERX_PRICING = JSON.stringify({
      "x": { inputPerMTokens: 1, outputPerMTokens: 1 },
    });
    const a = loadPricing();
    process.env.BOILERX_PRICING = JSON.stringify({
      "x": { inputPerMTokens: 999, outputPerMTokens: 999 },
    });
    const b = loadPricing();
    expect(b).toBe(a);
    expect(b["x"]).toEqual({ inputPerMTokens: 1, outputPerMTokens: 1 });
  });
});
