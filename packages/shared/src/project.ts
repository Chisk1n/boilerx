import type { StackKind } from "./stacks.js";

export interface ProjectConfig {
  readonly name: string;
  readonly stack: StackKind;
  readonly path: string;
  readonly git: GitOptions;
  readonly docker: DockerOptions;
  readonly ci: CiOptions;
  readonly evolve: EvolveOptions;
}

export interface GitOptions {
  readonly init: boolean;
  readonly createGithubRepo: boolean;
  readonly visibility: "public" | "private";
  readonly defaultBranch: string;
  readonly conventionalCommits: boolean;
}

export interface DockerOptions {
  readonly enabled: boolean;
  readonly compose: boolean;
  readonly multistage: boolean;
}

export interface CiOptions {
  readonly githubActions: boolean;
  readonly coverageThreshold: number;
}

export interface EvolveOptions {
  readonly enabled: boolean;
  readonly judgeMetricFile: string;
}

export const DEFAULT_PROJECT_CONFIG: Omit<ProjectConfig, "name" | "stack" | "path"> = {
  git: {
    init: true,
    createGithubRepo: false,
    visibility: "private",
    defaultBranch: "main",
    conventionalCommits: true,
  },
  docker: {
    enabled: true,
    compose: true,
    multistage: true,
  },
  ci: {
    githubActions: true,
    coverageThreshold: 80,
  },
  evolve: {
    enabled: false,
    judgeMetricFile: ".judge/metric.yaml",
  },
};
