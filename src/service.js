// The agent as a per-user service: started at login, started again when it
// fails, run from the files `join` copied into its directory by an absolute
// path to node. A LaunchAgent on macOS, a systemd user unit on Linux, a
// scheduled task at logon on Windows.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const label = "org.evref-bl.pharo-agent-telemetry";
export const unit = "pharo-agent-telemetry.service";
export const task = "pharo-agent-telemetry";

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
const systemdQuoted = (text) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`;

/** Runs a command, quietly, and says how it ended. */
export function runCommand(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
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
export function serviceDefinition({ platform = process.platform, home = os.homedir(), env = process.env, node = process.execPath, agent }) {
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
      <Command>${xml(node)}</Command>
      <Arguments>${xml(`"${agent}"`)}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
    // schtasks reads a task's XML as UTF-16.
    return {
      file: path.join(path.dirname(agent), "task.xml"),
      content: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text.replace(/\n/g, "\r\n"), "utf16le")]),
    };
  }
  const xdg = env.XDG_CONFIG_HOME && path.posix.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.posix.join(home, ".config");
  return {
    file: path.posix.join(xdg, "systemd", "user", unit),
    content: `[Unit]
Description=${description}

[Service]
ExecStart=${systemdQuoted(node)} ${systemdQuoted(agent)}
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
`,
  };
}

const domain = (uid) => `gui/${uid}`;

/**
 * Writes the service's definition and starts it, again if it ran: a join
 * that changed the agent's files restarts it on them.
 *
 * @param {ServiceOptions} options
 */
export function installService(options) {
  const { platform = process.platform, uid = process.getuid?.() ?? 0, run = runCommand } = options;
  const { file, content } = serviceDefinition(options);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { mode: 0o644 });
  const steps = {
    darwin: [["launchctl", ["bootout", `${domain(uid)}/${label}`], true], ["launchctl", ["bootstrap", domain(uid), file]]],
    win32: [["schtasks", ["/Create", "/TN", task, "/XML", file, "/F"]], ["schtasks", ["/End", "/TN", task], true], ["schtasks", ["/Run", "/TN", task]]],
    linux: [["systemctl", ["--user", "daemon-reload"]], ["systemctl", ["--user", "enable", unit]], ["systemctl", ["--user", "restart", unit]]],
  }[platform === "darwin" || platform === "win32" ? platform : "linux"];
  for (const [command, args, mayFail] of steps) {
    const { status } = run(command, args);
    if (status !== 0 && !mayFail) throw new Error(`${command} ${args.join(" ")} failed (${status})`);
  }
  return file;
}

/**
 * Stops the service and removes its definition. Says whether there was one.
 *
 * @param {ServiceOptions} options
 */
export function removeService(options) {
  const { platform = process.platform, uid = process.getuid?.() ?? 0, run = runCommand } = options;
  const { file } = serviceDefinition(options);
  const known = fs.existsSync(file);
  if (platform === "darwin") {
    run("launchctl", ["bootout", `${domain(uid)}/${label}`]);
  } else if (platform === "win32") {
    run("schtasks", ["/End", "/TN", task]);
    run("schtasks", ["/Delete", "/TN", task, "/F"]);
  } else {
    run("systemctl", ["--user", "disable", "--now", unit]);
  }
  fs.rmSync(file, { force: true });
  if (platform !== "darwin" && platform !== "win32") run("systemctl", ["--user", "daemon-reload"]);
  return known;
}

/**
 * Whether the service is installed, and running.
 *
 * @param {ServiceOptions} options
 * @returns {"running" | "not running" | "installed" | "not installed"}
 */
export function serviceState(options) {
  const { platform = process.platform, uid = process.getuid?.() ?? 0, run = runCommand } = options;
  if (!fs.existsSync(serviceDefinition(options).file)) return "not installed";
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
