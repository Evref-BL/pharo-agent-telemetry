// The agent's service on each system, its definition written into a home of
// the test's own and its commands given to a runner that records them:
// nothing is installed on the machine that runs the tests.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installService, label, removeService, serviceDefinition, serviceState, task, unit } from "../src/service.js";

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

test("on macOS, a LaunchAgent that starts at login and again when the agent fails", () => {
  const { file, content } = serviceDefinition({ platform: "darwin", home: "/Users/a", node: "/opt/node & co/bin/node", agent: "/Users/a/.config/pharo-agent-telemetry/agent.mjs" });
  assert.equal(file, `/Users/a/Library/LaunchAgents/${label}.plist`);
  assert.match(content, /<string>\/opt\/node &amp; co\/bin\/node<\/string>\s*<string>\/Users\/a\/\.config\/pharo-agent-telemetry\/agent\.mjs<\/string>/);
  assert.match(content, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(content, /<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>/);
});

test("on Linux, a systemd user unit that starts at login and again when the agent fails", () => {
  const { file, content } = serviceDefinition({ platform: "linux", home: "/home/a", env: {}, node: "/usr/bin/node", agent: "/home/a/.config/pharo-agent-telemetry/100% agent.mjs" });
  assert.equal(file, `/home/a/.config/systemd/user/${unit}`);
  assert.match(content, /^ExecStart="\/usr\/bin\/node" "\/home\/a\/\.config\/pharo-agent-telemetry\/100%% agent\.mjs"$/m);
  assert.match(content, /^Restart=on-failure$/m);
  assert.match(content, /^WantedBy=default\.target$/m);
  assert.equal(serviceDefinition({ platform: "linux", home: "/home/a", env: { XDG_CONFIG_HOME: "/x" }, agent: "/a" }).file, `/x/systemd/user/${unit}`);
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
  assert.match(text, /<Command>C:\\Program Files\\nodejs\\node\.exe<\/Command>\s*<Arguments>&quot;\/agent\/agent\.mjs&quot;<\/Arguments>/);
});

test("installing writes the definition and starts the service again; removing stops it and deletes the definition", () => withHome((home, agent) => {
  const expected = {
    darwin: {
      install: [`launchctl bootout gui/501/${label}`, `launchctl bootstrap gui/501 ${home}/Library/LaunchAgents/${label}.plist`],
      remove: [`launchctl bootout gui/501/${label}`],
    },
    linux: {
      install: ["systemctl --user daemon-reload", `systemctl --user enable ${unit}`, `systemctl --user restart ${unit}`],
      remove: [`systemctl --user disable --now ${unit}`, "systemctl --user daemon-reload"],
    },
    win32: {
      install: [`schtasks /Create /TN ${task} /XML ${path.join(path.dirname(agent), "task.xml")} /F`, `schtasks /End /TN ${task}`, `schtasks /Run /TN ${task}`],
      remove: [`schtasks /End /TN ${task}`, `schtasks /Delete /TN ${task} /F`],
    },
  };
  for (const [platform, { install, remove }] of Object.entries(expected)) {
    // Stopping a service that does not run fails, and need not stop the install.
    const installing = recorder((command, args) => ({ status: args.includes("bootout") || args.includes("/End") ? 1 : 0, stdout: "" }));
    const options = { platform, home, env: {}, uid: 501, agent, run: installing.run };
    const file = installService(options);
    assert.ok(fs.existsSync(file), platform);
    assert.deepEqual(installing.commands, install, platform);
    const removing = recorder();
    assert.equal(removeService({ ...options, run: removing.run }), true, platform);
    assert.deepEqual(removing.commands, remove, platform);
    assert.equal(fs.existsSync(file), false, platform);
    assert.equal(removeService({ ...options, run: recorder().run }), false, platform);
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
  const cases = [
    ["darwin", 0, "gui/501/org.evref-bl.pharo-agent-telemetry = {\n\tstate = running\n", "running"],
    ["darwin", 0, "\tstate = not running\n", "not running"],
    ["darwin", 113, "", "not running"],
    ["linux", 0, "active\n", "running"],
    ["linux", 3, "inactive\n", "not running"],
    ["linux", 3, "failed\n", "not running"],
    ["win32", 0, "TaskName:      \\pharo-agent-telemetry\r\nStatus:        Running\r\n", "running"],
    ["win32", 0, "Status:        Ready\r\n", "not running"],
    ["win32", 1, "", "not running"],
  ];
  for (const [platform, status, stdout, state] of cases) {
    const options = { platform, home, env: {}, uid: 501, agent, run: answer(0, "") };
    installService(options);
    assert.equal(serviceState({ ...options, run: answer(status, stdout) }), state, `${platform}: ${stdout}`);
    removeService(options);
  }
}));
