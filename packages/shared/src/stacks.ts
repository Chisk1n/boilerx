export const STACK_KINDS = [
  "node-api",
  "node-web",
  "python-api",
  "python-cli",
] as const;

export type StackKind = (typeof STACK_KINDS)[number];

export interface StackDescriptor {
  readonly kind: StackKind;
  readonly displayName: string;
  readonly language: "typescript" | "python";
  readonly description: string;
  readonly testFramework: string;
  readonly defaultPort?: number;
}

export const STACK_DESCRIPTORS: Record<StackKind, StackDescriptor> = {
  "node-api": {
    kind: "node-api",
    displayName: "Node API",
    language: "typescript",
    description: "Fastify + TypeScript + Vitest. HTTP API with healthcheck and OpenAPI.",
    testFramework: "vitest",
    defaultPort: 3000,
  },
  "node-web": {
    kind: "node-web",
    displayName: "Node Web (Next.js)",
    language: "typescript",
    description: "Next.js 15 + Tailwind + Vitest + Playwright E2E.",
    testFramework: "vitest+playwright",
    defaultPort: 3000,
  },
  "python-api": {
    kind: "python-api",
    displayName: "Python API",
    language: "python",
    description: "FastAPI + uv + Pytest + Ruff. Async HTTP API with OpenAPI.",
    testFramework: "pytest",
    defaultPort: 8000,
  },
  "python-cli": {
    kind: "python-cli",
    displayName: "Python CLI",
    language: "python",
    description: "Typer + uv + Pytest + Ruff. Modern CLI tool scaffold.",
    testFramework: "pytest",
  },
};

export function isStackKind(value: string): value is StackKind {
  return (STACK_KINDS as readonly string[]).includes(value);
}
