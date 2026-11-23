#!/usr/bin/env node
// The participants' commands, for this study: pharo-agent-telemetry runs
// them, on this package's directory.
import { fileURLToPath } from "node:url";
import { main } from "@evref-bl/pharo-agent-telemetry/cli";

await main(process.argv.slice(2), { study: fileURLToPath(new URL("..", import.meta.url)) });
