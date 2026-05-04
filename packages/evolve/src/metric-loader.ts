import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  DEFAULT_METRIC_WEIGHTS,
  type CompositeMetricSpec,
  type MetricWeights,
  validateWeights,
} from "./judge.js";

interface RawMetricFile {
  weights?: Partial<MetricWeights>;
  testsCommand?: string;
  coverageCommand?: string;
  benchmarkCommand?: string;
  lintCommand?: string;
  llmJudgeRubricPath?: string;
  timeoutSeconds?: number;
}

const REQUIRED_FIELDS: ReadonlyArray<keyof RawMetricFile> = [
  "testsCommand",
  "coverageCommand",
];

export async function loadMetricSpec(metricFilePath: string): Promise<CompositeMetricSpec> {
  const absPath = resolve(metricFilePath);
  let raw: string;
  try {
    raw = await readFile(absPath, "utf8");
  } catch (err) {
    throw new Error(`Cannot read metric spec at ${absPath}`, { cause: err });
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new Error(`Invalid YAML in metric spec: ${absPath}`, { cause: err });
  }

  if (!isPlainObject(parsed)) {
    throw new Error(`Metric spec must be a YAML mapping at top level: ${absPath}`);
  }

  const data = parsed as RawMetricFile;

  for (const field of REQUIRED_FIELDS) {
    if (typeof data[field] !== "string" || (data[field] as string).trim() === "") {
      throw new Error(
        `Metric spec is missing required field '${field}' (string) in ${absPath}`,
      );
    }
  }

  const weights: MetricWeights = {
    testsPassing: data.weights?.testsPassing ?? DEFAULT_METRIC_WEIGHTS.testsPassing,
    coverageDelta: data.weights?.coverageDelta ?? DEFAULT_METRIC_WEIGHTS.coverageDelta,
    benchmarkScore: data.weights?.benchmarkScore ?? DEFAULT_METRIC_WEIGHTS.benchmarkScore,
    lintScore: data.weights?.lintScore ?? DEFAULT_METRIC_WEIGHTS.lintScore,
    llmJudgeRubric: data.weights?.llmJudgeRubric ?? DEFAULT_METRIC_WEIGHTS.llmJudgeRubric,
  };
  validateWeights(weights);

  if (weights.benchmarkScore > 0 && !data.benchmarkCommand) {
    throw new Error(
      `Metric spec assigns weight to 'benchmarkScore' but no 'benchmarkCommand' is defined.`,
    );
  }
  if (weights.lintScore > 0 && !data.lintCommand) {
    throw new Error(
      `Metric spec assigns weight to 'lintScore' but no 'lintCommand' is defined.`,
    );
  }
  if (weights.llmJudgeRubric > 0 && !data.llmJudgeRubricPath) {
    throw new Error(
      `Metric spec assigns weight to 'llmJudgeRubric' but no 'llmJudgeRubricPath' is defined.`,
    );
  }

  return {
    weights,
    testsCommand: data.testsCommand!,
    coverageCommand: data.coverageCommand!,
    benchmarkCommand: data.benchmarkCommand,
    lintCommand: data.lintCommand,
    llmJudgeRubricPath: data.llmJudgeRubricPath,
    timeoutSeconds: data.timeoutSeconds ?? 300,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
