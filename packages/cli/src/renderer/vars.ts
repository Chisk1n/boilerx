import { STACK_DESCRIPTORS, type ProjectConfig } from "@boilerx/shared";

/**
 * Variables exposed to handlebars templates.
 *
 * Keep this surface intentional and documented in `docs/STACKS.md`. New keys
 * should land here together with their docs entry, not behind a back door.
 */
export interface TemplateVars {
  readonly name: string;
  readonly stack: string;
  readonly language: "typescript" | "python";
  readonly displayName: string;
  readonly stackDescription: string;
  readonly testFramework: string;
  readonly defaultPort: number | null;

  readonly defaultBranch: string;
  readonly conventionalCommits: boolean;
  readonly visibility: "public" | "private";
  readonly createGithubRepo: boolean;

  readonly dockerEnabled: boolean;
  readonly dockerCompose: boolean;
  readonly dockerMultistage: boolean;

  readonly ciGithubActions: boolean;
  readonly coverageThreshold: number;

  readonly evolveEnabled: boolean;
  readonly judgeMetricFile: string;

  readonly year: number;
  readonly author: string;
  readonly nodeMajor: number;
}

export interface BuildVarsInput {
  readonly project: ProjectConfig;
  readonly author?: string;
  readonly now?: () => Date;
  readonly nodeMajor?: number;
}

export function buildTemplateVars(input: BuildVarsInput): TemplateVars {
  const { project } = input;
  const desc = STACK_DESCRIPTORS[project.stack];
  const now = input.now ? input.now() : new Date();

  return {
    name: project.name,
    stack: project.stack,
    language: desc.language,
    displayName: desc.displayName,
    stackDescription: desc.description,
    testFramework: desc.testFramework,
    defaultPort: desc.defaultPort ?? null,

    defaultBranch: project.git.defaultBranch,
    conventionalCommits: project.git.conventionalCommits,
    visibility: project.git.visibility,
    createGithubRepo: project.git.createGithubRepo,

    dockerEnabled: project.docker.enabled,
    dockerCompose: project.docker.compose,
    dockerMultistage: project.docker.multistage,

    ciGithubActions: project.ci.githubActions,
    coverageThreshold: project.ci.coverageThreshold,

    evolveEnabled: project.evolve.enabled,
    judgeMetricFile: project.evolve.judgeMetricFile,

    year: now.getFullYear(),
    author: input.author ?? "boilerX user",
    nodeMajor: input.nodeMajor ?? 22,
  };
}
