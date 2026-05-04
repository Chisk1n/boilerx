import type { Hypothesis } from "@boilerx/shared";
import type { Architect, ArchitectContext } from "./architect.js";

export interface StubArchitectOptions {
  readonly hypotheses: ReadonlyArray<Omit<Hypothesis, "id">>;
}

/**
 * Deterministic Architect for tests and demos. Returns hypotheses from a
 * fixed pool, cycling if asked for more than the pool length, with stable
 * IDs so the same context produces the same hypothesis sequence.
 *
 * Real LLM-backed Architects will implement the same interface in a later
 * PR, but the contract and mocking story is the same.
 */
export class StubArchitect implements Architect {
  private readonly pool: ReadonlyArray<Omit<Hypothesis, "id">>;
  private callCount = 0;

  constructor(opts: StubArchitectOptions) {
    if (opts.hypotheses.length === 0) {
      throw new Error("StubArchitect requires at least one hypothesis in its pool.");
    }
    this.pool = opts.hypotheses;
  }

  async proposeHypotheses(_ctx: ArchitectContext, n: number): Promise<readonly Hypothesis[]> {
    if (n < 1) throw new Error(`StubArchitect.proposeHypotheses requires n >= 1, got ${n}.`);
    const callIndex = this.callCount++;
    const out: Hypothesis[] = [];
    for (let i = 0; i < n; i++) {
      const tpl = this.pool[(callIndex + i) % this.pool.length]!;
      out.push({ id: `h-${callIndex}-${i}`, ...tpl });
    }
    return out;
  }
}
