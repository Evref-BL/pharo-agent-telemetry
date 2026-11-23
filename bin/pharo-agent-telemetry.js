#!/usr/bin/env node
// pharo-agent-telemetry: a study's operators' commands, on the study in the
// current directory or the one --study names; and the participants' commands
// on the study --study names, as a study's own package runs them.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { main, participantCommands } from "../src/cli.js";

/** The operators' commands, by the script each runs. */
const operatorCommands = {
  init: "Start a study in a new directory, from the example study.",
  generate: "Write the study's filter, collector and participants page (--check: only say whether they are current).",
  check: "Check the study: its generated files are current, and its rule fixtures pass through both filters.",
  catalog: "Read the Pharo tools' names from their releases into the study's catalog.",
  "exception-names": "Have MCP name the exception classes, in an image of each Pharo version.",
  "sign-catalog": "Sign the study's catalog for its collector to serve, or make its key (--new-key).",
  "check-deployment": "Ask the study's deployed collector what the participants rely on.",
  audit: "Say what an archive holds, and whether the allowlist allows it.",
  "check-release": "Refuse to publish the study while its page lacks a fact participants are owed.",
};

const usage = `Usage: pharo-agent-telemetry <command> [--study <directory>] [options]

A study's operators, in the study's directory or with --study:
${Object.entries(operatorCommands).map(([name, about]) => `  ${name.padEnd(17)} ${about}`).join("\n")}

The participants' commands (${participantCommands.join(", ")}) run as the study's own
package runs them: npx <the study's package> <command>, or here with --study.`;

const [command, ...rest] = process.argv.slice(2);
if (command !== undefined && Object.hasOwn(operatorCommands, command)) {
  const script = fileURLToPath(new URL(`../scripts/${command}.js`, import.meta.url));
  const { status } = spawnSync(process.execPath, [script, ...rest], { stdio: "inherit" });
  process.exit(status ?? 1);
} else if (command === undefined || command === "--help" || command === "-h") {
  console.log(usage);
} else {
  await main(process.argv.slice(2), { program: "pharo-agent-telemetry --study <directory>" });
}
