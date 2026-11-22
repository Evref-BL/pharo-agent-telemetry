// The agent's service on each system, its definition written into a home of
// the test's own and its commands given to a runner that records them:
// nothing is installed on the machine that runs the tests, and the default
// runner refuses to reach the service manager under a test.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { definedAgentDirectories, installedDefinitions, installService, realServices, removeService, runCommand, serviceDefinition, serviceNames, serviceState, startService } from "../src/service.js";

/** A runner that records each command, and answers as `answers` says. */
function recorder(answers = () => ({ status: 0, stdout: "" })) {
  const commands = [];
  const run = (command, args) => {
    commands.push([command, ...args].join(" "));
    return answers(command, args);
  };
  return { commands, run };
}

function withHome(run) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pat-service-"));
  try {
    return run(home, path.join(home, "config", "pharo-agent-telemetry", "agent.mjs"));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test("each agent directory has a service of its own, named after it", () => {
  const a = serviceNames("/Users/a/.config/pharo-agent-telemetry/agent.mjs", "darwin");
  const b = serviceNames("/tmp/scratch/config/pharo-agent-telemetry/agent.mjs", "darwin");
  assert.match(a.label, /^org\.evref-bl\.pharo-agent-telemetry\.[0-9a-f]{12}$/);
  assert.match(a.unit, /^pharo-agent-telemetry-[0-9a-f]{12}\.service$/);
  assert.match(a.task, /^pharo-agent-telemetry-[0-9a-f]{12}$/);
  assert.notEqual(a.label, b.label);
  assert.deepEqual(serviceNames("/Users/a/.config/pharo-agent-telemetry/agent.mjs", "darwin"), a);
  // Windows paths are one whatever their case.
  assert.deepEqual(serviceNames("C:\\Users\\A\\AppData\\Roaming\\pharo-agent-telemetry\\agent.mjs", "win32"), serviceNames("c:\\users\\a\\appdata\\roaming\\pharo-agent-telemetry\\agent.mjs", "win32"));
});

test("the default runner reaches the real service manager only for the command line, outside a test, in the account's own home; a fake one a test gives runs", () => withHome((home) => {
  assert.ok(process.env.NODE_TEST_CONTEXT, "run by node --test");
  assert.throws(() => runCommand("launchctl", ["print", "gui/0"]), /only the pharo-agent-telemetry command runs service commands/);
  assert.throws(() => installService({ platform: "darwin", home, uid: 501, agent: path.join(home, "agent.mjs") }), /only the pharo-agent-telemetry command/);
  assert.throws(() => runCommand("launchctl", ["print", "gui/0"], { ...process.env, ...realServices }), /not run under a test/);
  // A harness that runs the command line outside node --test, with a home of its own.
  const outside = { ...process.env, ...realServices, NODE_TEST_CONTEXT: undefined, HOME: home, USERPROFILE: home };
  assert.throws(() => runCommand("launchctl", ["print", "gui/0"], outside), /is not the account's/);
  if (process.platform === "win32") return;
  const fakes = path.join(home, "fakes");
  fs.mkdirSync(fakes);
  fs.writeFileSync(path.join(fakes, "launchctl"), "#!/bin/sh\necho \"fake $*\"\n", { mode: 0o755 });
  assert.deepEqual(runCommand("launchctl", ["print", "x"], { ...process.env, PHARO_AGENT_TELEMETRY_SERVICE_COMMANDS: fakes }), { status: 0, stdout: "fake print x\n" });
}));

test("on macOS, a LaunchAgent that starts at login and again when the agent fails", () => {
  const { label } = serviceNames("/Users/a/.config/pharo-agent-telemetry/agent.mjs", "darwin");
  const { file, content } = serviceDefinition({ platform: "darwin", home: "/Users/a", node: "/opt/node & co/bin/node", agent: "/Users/a/.config/pharo-agent-telemetry/agent.mjs" });
  assert.equal(file, `/Users/a/Library/LaunchAgents/${label}.plist`);
  assert.match(content, /<string>\/opt\/node &amp; co\/bin\/node<\/string>\s*<string>\/Users\/a\/\.config\/pharo-agent-telemetry\/agent\.mjs<\/string>/);
  assert.match(content, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(content, /<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>/);
});

test("on Linux, a systemd user unit that starts at login and again when the agent fails, under both configuration directories", () => {
  const { unit } = serviceNames("/home/a/.config/pharo-agent-telemetry/100% $agent.mjs", "linux");
  const { file, content, extras } = serviceDefinition({ platform: "linux", home: "/home/a", env: {}, node: "/usr/bin/node", agent: "/home/a/.config/pharo-agent-telemetry/100% $agent.mjs" });
  assert.equal(file, `/home/a/.config/systemd/user/${unit}`);
  assert.deepEqual(extras, []);
  assert.match(content, /^ExecStart="\/usr\/bin\/node" "\/home\/a\/\.config\/pharo-agent-telemetry\/100%% \$\$agent\.mjs"$/m);
  assert.match(content, /^Restart=on-failure$/m);
  assert.match(content, /^WantedBy=default\.target$/m);
  // The user's systemd may read another XDG_CONFIG_HOME than this shell's.
  const both = serviceDefinition({ platform: "linux", home: "/home/a", env: { XDG_CONFIG_HOME: "/x" }, agent: "/a/agent.mjs" });
  const named = serviceNames("/a/agent.mjs", "linux").unit;
  assert.deepEqual([both.file, ...both.extras.map((extra) => extra.file)], [`/home/a/.config/systemd/user/${named}`, `/x/systemd/user/${named}`]);
});

test("on Windows, a hidden task at logon that restarts on failure, in the UTF-16 schtasks reads", () => {
  const { file, content } = serviceDefinition({ platform: "win32", env: { USERDOMAIN: "D", USERNAME: "a" }, node: "C:\\Program Files\\nodejs\\node.exe", agent: "/agent/agent.mjs" });
  assert.equal(file, path.join("/agent", "task.xml"));
  assert.ok(Buffer.isBuffer(content));
  assert.deepEqual([...content.subarray(0, 2)], [0xff, 0xfe]);
  const text = content.subarray(2).toString("utf16le");
  assert.match(text, /^<\?xml version="1\.0" encoding="UTF-16"\?>\r\n/);
  assert.match(text, /<LogonTrigger>\s*<Enabled>true<\/Enabled>\s*<UserId>D\\a<\/UserId>/);
  assert.match(text, /<RestartOnFailure>\s*<Interval>PT1M<\/Interval>/);
  assert.match(text, /<Hidden>true<\/Hidden>/);
  // No console window: wscript runs node hidden, and again after it fails.
  assert.match(text, /<Command>wscript\.exe<\/Command>\s*<Arguments>\/\/B \/\/Nologo &quot;\/agent\/agent\.vbs&quot;<\/Arguments>/);
  const [launcher] = serviceDefinition({ platform: "win32", env: {}, node: "C:\\Program Files\\nodejs\\node.exe", agent: "/agent/agent.mjs" }).extras;
  assert.equal(launcher.file, path.join("/agent", "agent.vbs"));
  assert.match(launcher.content.subarray(2).toString("utf16le"), /shell\.Run\("""C:\\Program Files\\nodejs\\node\.exe"" ""\/agent\/agent\.mjs""", 0, True\)/);
});

test("installing writes the definition and starts the service again; removing stops it and deletes the definition", () => withHome((home, agent) => {
  const names = (platform) => serviceNames(agent, platform);
  const expected = {
    darwin: {
      install: [`launchctl bootout gui/501/${names("darwin").label}`, `launchctl bootstrap gui/501 ${home}/Library/LaunchAgents/${names("darwin").label}.plist`],
      remove: [`launchctl bootout gui/501/${names("darwin").label}`],
      start: [`launchctl kickstart gui/501/${names("darwin").label}`],
    },
    linux: {
      install: ["systemctl --user daemon-reload", `systemctl --user enable ${names("linux").unit}`, `systemctl --user restart ${names("linux").unit}`],
      remove: [`systemctl --user disable --now ${names("linux").unit}`, "systemctl --user daemon-reload"],
      start: [`systemctl --user start ${names("linux").unit}`],
    },
    win32: {
      install: [`schtasks /Create /TN ${names("win32").task} /XML ${path.join(path.dirname(agent), "task.xml")} /F`, `schtasks /End /TN ${names("win32").task}`, `schtasks /Run /TN ${names("win32").task}`],
      remove: [`schtasks /End /TN ${names("win32").task}`, `schtasks /Delete /TN ${names("win32").task} /F`],
      start: [`schtasks /Run /TN ${names("win32").task}`],
    },
  };
  for (const [platform, { install, remove, start }] of Object.entries(expected)) {
    // Stopping a service that does not run fails, and need not stop the install.
    const installing = recorder((command, args) => ({ status: args.includes("bootout") || args.includes("/End") ? 1 : 0, stdout: "" }));
    const options = { platform, home, env: {}, uid: 501, agent, run: installing.run };
    const file = installService(options);
    assert.ok(fs.existsSync(file), platform);
    assert.deepEqual(installing.commands, install, platform);
    assert.deepEqual(installedDefinitions(options), [file], platform);
    const starting = recorder();
    assert.equal(startService({ ...options, run: starting.run }), true, platform);
    assert.deepEqual(starting.commands, start, platform);
    const removing = recorder();
    assert.equal(removeService({ ...options, run: removing.run }), true, platform);
    assert.deepEqual(removing.commands, remove, platform);
    assert.equal(fs.existsSync(file), false, platform);
    const after = recorder();
    assert.equal(removeService({ ...options, run: after.run }), false, platform);
    assert.equal(startService({ ...options, run: after.run }), false, platform);
    assert.deepEqual(after.commands, [], platform);
  }
}));

test("nothing is stopped, started or asked of a service whose definition is not this home's, nor names this agent", () => withHome((home, agent) => {
  // Another home's agent, as the real one is for a test's scratch home.
  const other = "/Users/someone/.config/pharo-agent-telemetry/agent.mjs";
  for (const platform of ["darwin", "linux", "win32"]) {
    const nothing = recorder();
    const options = { platform, home, env: {}, uid: 501, agent, run: nothing.run };
    // No definition at all in this home.
    assert.equal(removeService(options), false, platform);
    assert.equal(startService(options), false, platform);
    assert.equal(serviceState(options), "not installed", platform);
    // The other agent's definition, copied into this home under its own name.
    const theirs = serviceDefinition({ ...options, agent: other });
    // On Windows the definition is beside the agent, in the other home.
    if (platform !== "win32") {
      fs.mkdirSync(path.dirname(theirs.file), { recursive: true });
      fs.writeFileSync(theirs.file, theirs.content);
    }
    // A definition under this agent's name that runs the other agent.
    const ours = serviceDefinition(options);
    const forged = serviceDefinition({ ...options, agent: other });
    fs.mkdirSync(path.dirname(ours.file), { recursive: true });
    fs.writeFileSync(ours.file, forged.content);
    if (platform === "win32") fs.writeFileSync(ours.extras[0].file, forged.extras[0].content);
    assert.deepEqual(installedDefinitions(options), [], platform);
    assert.equal(removeService(options), false, platform);
    assert.equal(startService(options), false, platform);
    assert.equal(serviceState(options), "not installed", platform);
    assert.deepEqual(nothing.commands, [], platform);
    assert.ok(fs.existsSync(ours.file), platform);
    fs.rmSync(ours.file);
    if (platform !== "win32") fs.rmSync(theirs.file);
  }
}));

test("an install whose service will not start says so", () => withHome((home, agent) => {
  const failing = recorder((command, args) => ({ status: args.includes("bootstrap") ? 5 : 0, stdout: "" }));
  assert.throws(() => installService({ platform: "darwin", home, uid: 501, agent, run: failing.run }), /launchctl bootstrap .* failed \(5\)/);
}));

test("the service's state, as each system reports it", () => withHome((home, agent) => {
  const answer = (status, stdout) => recorder(() => ({ status, stdout })).run;
  for (const platform of ["darwin", "linux", "win32"]) {
    assert.equal(serviceState({ platform, home, env: {}, agent, run: answer(0, "") }), "not installed", platform);
  }
  // On Windows, PowerShell names the task's state in every language; schtasks, in the user's, only when PowerShell does not answer.
  const windows = (powershell, schtasks) => recorder((command) => (command === "powershell" ? powershell : schtasks)).run;
  const cases = [
    ["darwin", answer(0, "gui/501/org.evref-bl.pharo-agent-telemetry = {\n\tstate = running\n"), "running"],
    ["darwin", answer(0, "\tstate = not running\n"), "not running"],
    ["darwin", answer(113, ""), "not running"],
    ["linux", answer(0, "active\n"), "running"],
    ["linux", answer(3, "inactive\n"), "not running"],
    ["linux", answer(3, "failed\n"), "not running"],
    ["win32", windows({ status: 0, stdout: "Running\r\n" }, { status: 0, stdout: "Statut :       Pr\u00eat\r\n" }), "running"],
    ["win32", windows({ status: 0, stdout: "Ready\r\n" }, { status: 0, stdout: "Status:        Running\r\n" }), "not running"],
    ["win32", windows({ status: 1, stdout: "" }, { status: 0, stdout: "TaskName:      \\pharo-agent-telemetry\r\nStatus:        Running\r\n" }), "running"],
    ["win32", windows({ status: 1, stdout: "" }, { status: 1, stdout: "" }), "not running"],
  ];
  for (const [platform, run, state] of cases) {
    const options = { platform, home, env: {}, uid: 501, agent, node: process.execPath, run: answer(0, "") };
    installService(options);
    assert.equal(serviceState({ ...options, run }), state, platform);
    removeService(options);
  }
  // A node that went away with an upgrade.
  const gone = { platform: "darwin", home, env: {}, uid: 501, agent, node: path.join(home, "Cellar", "node", "1.0.0", "bin", "node"), run: answer(0, "") };
  installService(gone);
  assert.equal(serviceState(gone), "without its node");
  removeService(gone);
}));

test("the agents this home's service definitions run are found from the home alone, and only those under it", () => withHome((home) => {
  const other = path.join(home, "elsewhere", "pharo-agent-telemetry", "agent.mjs");
  const mine = path.join(home, "xdg", "pharo-agent-telemetry", "agent.mjs");
  const foreign = path.join(path.dirname(home), "another-home", ".config", "pharo-agent-telemetry", "agent.mjs");
  const run = recorder().run;
  for (const platform of ["darwin", "linux"]) {
    for (const agent of [other, mine]) installService({ platform, home, env: {}, uid: 501, agent, node: process.execPath, run });
    // A definition copied from another home names that home's agent.
    const { file, content } = serviceDefinition({ platform, home: path.join(path.dirname(home), "another-home"), env: {}, node: process.execPath, agent: foreign });
    const copied = path.join(path.dirname(serviceDefinition({ platform, home, env: {}, node: process.execPath, agent: mine }).file), path.basename(file));
    fs.writeFileSync(copied, content);
    assert.deepEqual(definedAgentDirectories({ platform, home }).sort(), [path.dirname(other), path.dirname(mine)].sort(), platform);
    for (const agent of [other, mine]) removeService({ platform, home, env: {}, uid: 501, agent, run });
    fs.rmSync(copied);
    assert.deepEqual(definedAgentDirectories({ platform, home }), [], platform);
  }
  assert.deepEqual(definedAgentDirectories({ platform: "win32", home }), []);
}));
