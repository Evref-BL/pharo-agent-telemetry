// The agent as a per-user service: started at login, started again when it
// fails, run from the files `join` copied into its directory by an absolute
// path to node. A LaunchAgent on macOS, a systemd user unit on Linux, a
// scheduled task at logon on Windows.
//
// Each agent directory has a service of its own, named after it, and a
// command acts on a service only while its definition, in the home the
// command runs for, names that service and runs that agent: a join, leave,
// status or preview run with another HOME or XDG_CONFIG_HOME (a test, a
// reviewer's scratch home) never stops, replaces or reports another home's
// agent, though the service manager is the user's one.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The names of the service that runs the agent at `agent`, one per agent
 * directory: a LaunchAgent's label, a systemd unit, a scheduled task.
 *
 * @param {string} agent the agent's agent.mjs
 * @param {NodeJS.Platform} [platform]
 */
export function serviceNames(agent, platform = process.platform) {
  const directory = (platform === "win32" ? path.win32 : path.posix).dirname(agent);
  const id = createHash("sha256").update(platform === "win32" ? directory.toLowerCase() : directory).digest("hex").slice(0, 12);
  return { label: `org.evref-bl.pharo-agent-telemetry.${id}`, unit: `pharo-agent-telemetry-${id}.service`, task: `pharo-agent-telemetry-${id}` };
}

const description = "pharo-agent-telemetry: keeps of the Pharo tools' telemetry only what the participants page lists, and sends it to the collector";

/**
 * @typedef {{
 *   platform?: NodeJS.Platform,
 *   home?: string,
 *   env?: Record<string, string | undefined>,
 *   uid?: number,
 *   node?: string,
 *   agent: string,
 *   run?: (command: string, args: string[]) => { status: number | null, stdout: string },
 * }} ServiceOptions
 */

const xml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const systemdQuoted = (text) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%").replace(/\$/g, "$$$$")}"`;

/** Where a version manager or a package manager keeps one version of Node, gone at the next upgrade. */
const versioned = /\/Cellar\/|\/\.nvm\/versions\/|\/\.volta\/tools\/image\/|\/\.asdf\/installs\/|\/fnm\/node-versions\/|\/snap\/node\/[0-9]|\\Volta\\tools\\image\\|\\nvm\\v[0-9]/;

/**
 * The node the service runs: the one on PATH that is this very node, by a
 * path that survives its upgrades (Homebrew's /opt/homebrew/bin/node rather
 * than the Cellar's version), else this process's own. `lasts` says whether
 * the path is not one version's.
 *
 * @returns {{ node: string, lasts: boolean }}
 */
export function stableNode(env = process.env, exec = process.execPath, platform = process.platform) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  let real;
  try {
    real = fs.realpathSync(exec);
  } catch {
    return { node: exec, lasts: !versioned.test(exec) };
  }
  for (const directory of (env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : ":")) {
    if (!paths.isAbsolute(directory) || /fnm_multishells/.test(directory)) continue;
    const candidate = paths.join(directory, platform === "win32" ? "node.exe" : "node");
    try {
      if (fs.realpathSync(candidate) === real) return { node: candidate, lasts: !versioned.test(candidate) };
    } catch {
      // Not there.
    }
  }
  return { node: exec, lasts: !versioned.test(exec) };
}

/** The node a service definition runs, as written in it. */
export function definedNode(content, platform = process.platform) {
  const text = typeof content === "string" ? content : platform === "win32" ? content.subarray(2).toString("utf16le") : content.toString("utf8");
  const found = platform === "darwin" ? /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]*)<\/string>/.exec(text)
    : platform === "win32" ? /code = shell\.Run\("""([^"]*)""/.exec(text)
      : /^ExecStart="((?:[^"\\]|\\.)*)"/m.exec(text);
  const raw = found?.[1];
  if (raw === undefined) return undefined;
  return platform === "linux" || (platform !== "darwin" && platform !== "win32")
    ? raw.replace(/\\(.)/g, "$1").replace(/%%/g, "%").replace(/\$\$/g, "$")
    : raw.replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
}

/**
 * Runs a command, quietly, and says how it ended. Under a test (node --test
 * sets NODE_TEST_CONTEXT) it refuses, unless the test gives a directory of
 * fake commands in PHARO_AGENT_TELEMETRY_SERVICE_COMMANDS, which it then
 * runs instead: a test never reaches the real service manager.
 */
export function runCommand(command, args, env = process.env) {
  const fakes = env.PHARO_AGENT_TELEMETRY_SERVICE_COMMANDS;
  if (!fakes && env.NODE_TEST_CONTEXT) {
    throw new Error(`${command} is not run under a test: set PHARO_AGENT_TELEMETRY_DRY_RUN, or PHARO_AGENT_TELEMETRY_SERVICE_COMMANDS to a directory of fake commands.`);
  }
  const result = spawnSync(fakes ? path.join(fakes, command) : command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { status: result.status, stdout: result.stdout ?? "" };
}

/**
 * Records the commands instead of running them, as a test asks with
 * PHARO_AGENT_TELEMETRY_DRY_RUN: nothing is installed on the machine.
 *
 * @param {string} file where each command is appended, one JSON array a line
 */
export function dryRun(file) {
  return (command, args) => {
    fs.appendFileSync(file, `${JSON.stringify([command, ...args])}\n`);
    return { status: 0, stdout: "" };
  };
}

/**
 * Where the service's definition goes, and what it says.
 *
 * @param {ServiceOptions} options
 * @returns {{ file: string, content: string | Buffer }}
 */
export function serviceDefinition({ platform = process.platform, home = os.homedir(), env = process.env, node = stableNode(env, process.execPath, platform).node, agent }) {
  const { label, unit } = serviceNames(agent, platform);
  if (platform === "darwin") {
    return {
      file: path.posix.join(home, "Library", "LaunchAgents", `${label}.plist`),
      content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${label}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${xml(node)}</string>
		<string>${xml(agent)}</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>ThrottleInterval</key>
	<integer>30</integer>
	<key>ProcessType</key>
	<string>Background</string>
	<key>StandardOutPath</key>
	<string>/dev/null</string>
	<key>StandardErrorPath</key>
	<string>/dev/null</string>
</dict>
</plist>
`,
    };
  }
  if (platform === "win32") {
    // node.exe is a console program: run by the task as it is, it opens a
    // window at every logon, which closing stops. wscript runs it with no
    // window, and starts it again 30 s after it fails, which the task's own
    // RestartOnFailure does not do for a program that started.
    const launcher = path.join(path.dirname(agent), "agent.vbs");
    const vbs = (text) => `"${text.replace(/"/g, '""')}"`;
    const script = `' pharo-agent-telemetry: runs the agent with no window, again 30 s after it fails.\r\nSet shell = CreateObject("WScript.Shell")\r\nDo\r\n  code = shell.Run(${vbs(`"${node}" "${agent}"`)}, 0, True)\r\n  If code = 0 Then Exit Do\r\n  WScript.Sleep 30000\r\nLoop\r\n`;
    const user = env.USERNAME ? `${env.USERDOMAIN ? `${env.USERDOMAIN}\\` : ""}${env.USERNAME}` : undefined;
    const text = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>${xml(description)}</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>${user ? `\n      <UserId>${xml(user)}</UserId>` : ""}
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Hidden>true</Hidden>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>wscript.exe</Command>
      <Arguments>${xml(`//B //Nologo "${launcher}"`)}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
    // schtasks reads a task's XML as UTF-16.
    const utf16 = (each) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(each, "utf16le")]);
    return {
      file: path.join(path.dirname(agent), "task.xml"),
      content: utf16(text.replace(/\n/g, "\r\n")),
      // wscript reads a script with non-ASCII paths only as UTF-16 with its mark.
      extras: [{ file: launcher, content: utf16(script) }],
    };
  }
  // The user's systemd reads its own XDG_CONFIG_HOME, which need not be this shell's: the unit goes under both when they differ.
  const xdg = env.XDG_CONFIG_HOME && path.posix.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : undefined;
  const directories = [...new Set([path.posix.join(home, ".config"), ...(xdg ? [xdg] : [])])].map((directory) => path.posix.join(directory, "systemd", "user", unit));
  const content = `[Unit]
Description=${description}

[Service]
ExecStart=${systemdQuoted(node)} ${systemdQuoted(agent)}
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
`;
  return { file: directories[0], content, extras: directories.slice(1).map((file) => ({ file, content })) };
}

const domain = (uid) => `gui/${uid}`;
const system = (platform) => (platform === "darwin" || platform === "win32" ? platform : "linux");

/** A definition's text: UTF-16 with its mark on Windows, UTF-8 elsewhere. */
function definitionText(file, platform) {
  try {
    const content = fs.readFileSync(file);
    return platform === "win32" ? content.subarray(2).toString("utf16le") : content.toString("utf8");
  } catch {
    return undefined;
  }
}

/**
 * The definitions of this agent's service there are in this home: each file
 * that names the service and runs this very agent. A command acts on the
 * service only when there is one.
 *
 * @param {ServiceOptions} options
 * @returns {string[]}
 */
export function installedDefinitions(options) {
  const { platform = process.platform, agent } = options;
  const { label } = serviceNames(agent, platform);
  const { file, extras = [] } = serviceDefinition(options);
  const names = {
    darwin: (text) => text.includes(`<string>${xml(label)}</string>`) && text.includes(`<string>${xml(agent)}</string>`),
    // The task runs the launcher beside the agent, which runs the agent.
    win32: (text) => text.includes(xml(extras[0].file)) && (definitionText(extras[0].file, platform) ?? "").includes(agent),
    linux: (text) => text.includes(systemdQuoted(agent)),
  }[system(platform)];
  return [file, ...(platform === "win32" ? [] : extras.map((extra) => extra.file))].filter((each) => {
    const text = definitionText(each, platform);
    return text !== undefined && names(text);
  });
}

/**
 * Writes the service's definition and starts it, again if it ran: a join
 * that changed the agent's files restarts it on them.
 *
 * @param {ServiceOptions} options
 */
export function installService(options) {
  const { platform = process.platform, uid = process.getuid?.() ?? 0, run = runCommand, agent } = options;
  const { label, unit, task } = serviceNames(agent, platform);
  const { file, content, extras = [] } = serviceDefinition(options);
  for (const each of [...extras, { file, content }]) {
    fs.mkdirSync(path.dirname(each.file), { recursive: true });
    fs.writeFileSync(each.file, each.content, { mode: 0o644 });
  }
  // The definition just written names this label: stopping it stops this home's agent, and no other.
  const steps = {
    darwin: [["launchctl", ["bootout", `${domain(uid)}/${label}`], true], ["launchctl", ["bootstrap", domain(uid), file]]],
    win32: [["schtasks", ["/Create", "/TN", task, "/XML", file, "/F"]], ["schtasks", ["/End", "/TN", task], true], ["schtasks", ["/Run", "/TN", task]]],
    linux: [["systemctl", ["--user", "daemon-reload"]], ["systemctl", ["--user", "enable", unit]], ["systemctl", ["--user", "restart", unit]]],
  }[system(platform)];
  for (const [command, args, mayFail] of steps) {
    let { status } = run(command, args);
    // launchd may still be removing the job bootout asked it to: bootstrap then fails (5, 37) for a moment.
    for (let attempt = 0; status !== 0 && command === "launchctl" && args[0] === "bootstrap" && attempt < 10; attempt += 1) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
      ({ status } = run(command, args));
    }
    if (status !== 0 && !mayFail) throw new Error(`${command} ${args.join(" ")} failed (${status})`);
  }
  return file;
}

/**
 * Stops this home's service and removes its definition, when this home has
 * one; another home's service, or a definition this agent's service does not
 * name, is left alone. Says whether there was one.
 *
 * @param {ServiceOptions} options
 */
export function removeService(options) {
  const { platform = process.platform, uid = process.getuid?.() ?? 0, run = runCommand, agent } = options;
  if (installedDefinitions(options).length === 0) return false;
  const { label, unit, task } = serviceNames(agent, platform);
  const { file, extras = [] } = serviceDefinition(options);
  if (platform === "darwin") {
    run("launchctl", ["bootout", `${domain(uid)}/${label}`]);
  } else if (platform === "win32") {
    run("schtasks", ["/End", "/TN", task]);
    run("schtasks", ["/Delete", "/TN", task, "/F"]);
  } else {
    run("systemctl", ["--user", "disable", "--now", unit]);
  }
  for (const each of [file, ...extras.map((extra) => extra.file)]) fs.rmSync(each, { force: true });
  if (system(platform) === "linux") run("systemctl", ["--user", "daemon-reload"]);
  return true;
}

/**
 * Starts this home's service again, as after a preview stopped its agent;
 * nothing when this home has none, as when leave ran meanwhile.
 *
 * @param {ServiceOptions} options
 */
export function startService(options) {
  const { platform = process.platform, uid = process.getuid?.() ?? 0, run = runCommand, agent } = options;
  if (installedDefinitions(options).length === 0) return false;
  const { label, unit, task } = serviceNames(agent, platform);
  const [command, args] = {
    darwin: ["launchctl", ["kickstart", `${domain(uid)}/${label}`]],
    win32: ["schtasks", ["/Run", "/TN", task]],
    linux: ["systemctl", ["--user", "start", unit]],
  }[system(platform)];
  return run(command, args).status === 0;
}

/**
 * Whether this home's service is installed, and running.
 *
 * @param {ServiceOptions} options
 * @returns {"running" | "not running" | "installed" | "not installed" | "without its node"}
 */
export function serviceState(options) {
  const { platform = process.platform, uid = process.getuid?.() ?? 0, run = runCommand, agent } = options;
  const [file] = installedDefinitions(options);
  if (file === undefined) return "not installed";
  const { label, unit, task } = serviceNames(agent, platform);
  const node = definedNode(fs.readFileSync(platform === "win32" ? path.join(path.dirname(file), "agent.vbs") : file), platform);
  if (node !== undefined && !fs.existsSync(node)) return "without its node";
  if (platform === "darwin") {
    const { status, stdout } = run("launchctl", ["print", `${domain(uid)}/${label}`]);
    if (status !== 0) return "not running";
    const state = /^\s*state = (\S+)/m.exec(stdout)?.[1];
    return state === undefined ? "installed" : state === "running" ? "running" : "not running";
  }
  if (platform === "win32") {
    const { status, stdout } = run("schtasks", ["/Query", "/TN", task, "/FO", "LIST"]);
    if (status !== 0) return "not running";
    const state = /^Status:\s*(.+)$/m.exec(stdout)?.[1]?.trim();
    return state === undefined ? "installed" : state === "Running" ? "running" : "not running";
  }
  const { stdout } = run("systemctl", ["--user", "is-active", unit]);
  const state = stdout.trim();
  return state === "" ? "installed" : state === "active" ? "running" : "not running";
}
