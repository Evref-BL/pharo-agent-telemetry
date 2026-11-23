#!/usr/bin/env node
// Writes the names MCP can give the class of a failure, in an image of each
// Pharo version its CI runs, for `pharo-agent-telemetry catalog --exceptions`:
//
//   pharo-agent-telemetry exception-names --mcp <MCP> --cli <PLexus CLI> --out <directory>
//
// <MCP> is a checkout of the MCP release in use, whose CI workflow names the
// versions; <PLexus CLI> is the dist/cli.js of the PLexus release in use,
// which loads that MCP release into the images it makes. For each version it
// has a template of, PLexus makes an image with MCP's Telemetry group, named
// exceptions-<version>, in which scripts/exception-names.st writes
// <directory>/pharo-<version>.txt; the image is deleted after. A version
// without a template is said, and left out. Nothing is recorded: PLexus and
// the images run without telemetry, and read no settings file.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { ciPharoVersions, pharoTemplate } from "../src/catalog.js";

const { values } = parseArgs({ options: { mcp: { type: "string" }, cli: { type: "string" }, out: { type: "string" } } });
if (!values.mcp || !values.cli || !values.out) {
  console.error("Usage: pharo-agent-telemetry exception-names --mcp <MCP checkout> --cli <PLexus's dist/cli.js> --out <directory>");
  process.exit(1);
}
const cli = path.resolve(values.cli);
const out = path.resolve(values.out);
const evaluation = fs.readFileSync(new URL("exception-names.st", import.meta.url), "utf8");

const workflow = path.join(values.mcp, ".github", "workflows", "ci.yml");
const versions = ciPharoVersions(fs.readFileSync(workflow, "utf8"));
if (versions.length === 0) throw new Error(`${workflow} names no Pharo64-<version> image.`);

// No settings file, OTEL_* or PLEXUS_TELEMETRY of a participant's reaches PLexus or the images.
const config = fs.mkdtempSync(path.join(os.tmpdir(), "exception-names-"));
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("OTEL_") && name !== "PLEXUS_TELEMETRY" && name !== "PLEXUS_SCOPE"));
Object.assign(env, { XDG_CONFIG_HOME: config, PLEXUS_TELEMETRY: "0" });

/** A PLexus command's JSON answer; a refusal throws. */
function plexus(...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { env, encoding: "utf8", maxBuffer: 1 << 26 });
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch {
    answer = undefined;
  }
  if (result.status !== 0 || answer?.ok === false) throw new Error(`plexus ${args.join(" ")}: ${answer?.error ?? (result.stderr || result.stdout).trim()}`);
  return answer;
}

/** Evaluates code in a running image through `plexus mcp`, and answers the tool's text; an error result throws. */
async function evaluate(image, code) {
  const server = spawn(process.execPath, [cli, "mcp"], { env, stdio: ["pipe", "pipe", "inherit"] });
  const answers = new Map();
  let buffered = "";
  server.stdout.on("data", (chunk) => {
    buffered += chunk;
    let end;
    while ((end = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      try {
        const message = JSON.parse(line);
        answers.get(message.id)?.(message);
      } catch {
        // Not a JSON-RPC line.
      }
    }
  });
  const exited = new Promise((resolve) => server.on("exit", resolve));
  let id = 0;
  const request = (method, params) => new Promise((resolve, reject) => {
    id += 1;
    answers.set(id, resolve);
    exited.then(() => reject(new Error("plexus mcp exited before answering.")));
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  try {
    await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "pharo-agent-telemetry", version: "0" } });
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const answer = await request("tools/call", { name: "evaluate", arguments: { image, code, timeoutSeconds: 600 } });
    const text = (answer.result?.content ?? []).map((each) => each.text).join("\n");
    if (answer.error || answer.result?.isError) throw new Error(`evaluate in ${image}: ${text || JSON.stringify(answer.error)}`);
    return text;
  } finally {
    server.stdin.end();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 15_000))]);
    server.kill();
  }
}

const smalltalkString = (text) => `'${text.replaceAll("'", "''")}'`;

fs.mkdirSync(out, { recursive: true });
const templates = plexus("image", "templates");
const missing = [];
try {
  for (const version of versions) {
    const template = pharoTemplate(version, templates);
    if (template === undefined) {
      missing.push(version);
      console.log(`Pharo ${version}: PLexus has no template of it; left out.`);
      continue;
    }
    const image = `exceptions-${version}`;
    const file = path.join(out, `pharo-${version}.txt`);
    plexus("image", "create", image, "--template", template.name, ...(template.category ? ["--category", template.category] : []), "--telemetry");
    try {
      plexus("image", "start", image);
      await evaluate(image, `(${evaluation}) value: ${smalltalkString(file)}`);
      const [from] = fs.readFileSync(file, "utf8").split("\n");
      console.log(`Pharo ${version}: wrote ${file} (${from.replace(/^#\s*/, "")}, from ${template.name}).`);
    } finally {
      try {
        plexus("image", "stop", image);
      } catch {
        // It did not start: the delete says if anything keeps it.
      }
      plexus("image", "delete", image);
    }
  }
} finally {
  fs.rmSync(config, { recursive: true, force: true });
}
if (missing.length > 0) console.log(`No template of Pharo ${missing.join(", ")}: the catalog names only what the other versions' images name.`);
