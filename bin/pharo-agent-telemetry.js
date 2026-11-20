#!/usr/bin/env node
// Join, preview or leave the Pharo agent tools' field telemetry.
import fs from "node:fs";
import { parseArgs } from "node:util";
import { publicEndpoint, publicToken } from "../src/collector.js";
import { startPreview } from "../src/preview.js";
import { collectorSettings, readSettings, removeSettings, settingsFile, settingsText, writeSettings } from "../src/settings.js";

const usage = `Usage: pharo-agent-telemetry <command>

  preview   Show what the tools would send, sending nothing, until Ctrl-C.
  join      Send the tools' telemetry to the project's collector.
  status    Say whether you joined, and print the settings.
  leave     Stop sending.

What is sent: https://github.com/Evref-BL/pharo-agent-telemetry/blob/main/docs/participants.md

Options for join:
  --endpoint <url>   Another collector than the project's.
  --token <token>    That collector's token.
  --force            Replace OpenTelemetry settings you wrote yourself.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    endpoint: { type: "string" },
    token: { type: "string" },
    force: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

const file = settingsFile();
const [command] = positionals;

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (values.help || command === undefined) {
  console.log(usage);
} else if (command === "join") {
  const endpoint = values.endpoint ?? publicEndpoint;
  const token = values.token ?? (values.endpoint ? undefined : publicToken);
  if (!endpoint) fail("The project's collector is not deployed yet. Give --endpoint to send to another one.");
  const current = readSettings(file);
  if (current?.writer === "other" && !values.force) {
    fail(`${file} holds OpenTelemetry settings this command did not write. Run join --force to replace them.`);
  }
  if (current?.writer === "preview") fail("A preview is running. Stop it first.");
  writeSettings(file, settingsText("joined", collectorSettings({ endpoint, token })));
  console.log(`Joined: the Pharo tools send their traces to ${endpoint}.`);
  console.log("Tools already running keep their settings until they restart, and images made before now send nothing until they are made again.");
  console.log(`Settings: ${file}`);
} else if (command === "leave") {
  const current = readSettings(file);
  if (current === undefined) {
    console.log("Not joined: there is nothing to stop.");
  } else if (current.writer === "other" && !values.force) {
    fail(`${file} holds OpenTelemetry settings this command did not write. Delete it yourself, or run leave --force.`);
  } else {
    removeSettings(file);
    console.log("Left: the Pharo tools send nothing once they restart.");
  }
} else if (command === "status") {
  const current = readSettings(file);
  if (current === undefined) console.log("Not joined.");
  else if (current.writer === "joined") console.log(`Joined. ${file}:\n\n${current.text}`);
  else if (current.writer === "preview") console.log(`A preview is running, or was stopped without cleaning up. ${file}:\n\n${current.text}`);
  else console.log(`Not joined, but ${file} holds settings of your own:\n\n${current.text}`);
} else if (command === "preview") {
  const allowlist = JSON.parse(fs.readFileSync(new URL("../collector/allowlist.json", import.meta.url), "utf8"));
  const stop = new AbortController();
  process.once("SIGINT", () => stop.abort());
  process.once("SIGTERM", () => stop.abort());
  const { port, done } = await startPreview({ file, allowlist, print: (line) => console.log(line), signal: stop.signal });
  console.log(`Previewing on 127.0.0.1:${port}. Start a new agent session and use the Pharo tools: what they would send is printed here, and nothing leaves this machine. Ctrl-C ends the preview and puts your settings back.\n`);
  await done;
} else {
  fail(usage);
}
