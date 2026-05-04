#!/usr/bin/env node
import { Command } from "commander";
import { createLogger } from "@boilerx/shared";
import { registerNewCommand } from "./commands/new.js";
import { registerEvolveCommand } from "./commands/evolve.js";
import { registerDoctorCommand } from "./commands/doctor.js";

const logger = createLogger({ level: "info", bindings: { app: "boiler-cli" } });

const program = new Command();

program
  .name("boiler")
  .description(
    "boilerX: scaffold full-SDLC projects (Capa 1) and run autonomous code-evolution loops (Capa 2).",
  )
  .version("0.0.1");

registerNewCommand(program, logger);
registerEvolveCommand(program, logger);
registerDoctorCommand(program, logger);

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error("command failed", { message });
  process.exit(1);
});
