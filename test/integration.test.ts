import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";

const root = process.cwd();
const cli = join(root, "src", "cli.ts");
const fixture = join(root, "test", "fixtures", "server.ts");

async function startServer(ignoreTerm = false): Promise<{ child: ChildProcessWithoutNullStreams; port: number }> {
  const args = ["run", fixture, ...(ignoreTerm ? ["--ignore-term"] : [])];
  const child = spawn(process.execPath, args, { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for test server")), 5000);
    child.stdout.on("data", (chunk) => {
      const match = String(chunk).match(/PORT=(\d+)/);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Test server exited early (${code})`)));
  });
  return { child, port };
}

function runCli(...args: string[]) {
  return spawnSync(process.execPath, ["run", cli, ...args], {
    cwd: root, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" }, timeout: 10_000,
  });
}

function stopChild(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode === null) child.kill("SIGKILL");
}

test("complete CLI workflow against a disposable server", { timeout: 30_000 }, async () => {
  const { child, port } = await startServer();
  try {
    const shorthand = runCli(String(port));
    assert.equal(shorthand.status, 0, shorthand.stderr);
    assert.match(shorthand.stdout, new RegExp(`Port\\s+${port}`));
    if (process.platform !== "win32") {
      assert.match(shorthand.stdout, /Project\s+occidere/);
    }

    const info = runCli("info", String(port));
    assert.equal(info.status, 0, info.stderr);
    assert.match(info.stdout, /Status\s+Running/);

    const list = runCli("list");
    assert.equal(list.status, 0, list.stderr);
    assert.match(list.stdout, new RegExp(String(port)));

    if (process.platform !== "win32") {
      const directory = await mkdtemp(join(tmpdir(), "occidere-browser-"));
      const browser = join(directory, "browser");
      await writeFile(browser, "#!/bin/sh\nprintf '%s\\n' \"$1\"\n");
      await chmod(browser, 0o755);
      const opened = spawnSync(process.execPath, ["run", cli, "open", String(port)], {
        cwd: root, encoding: "utf8", env: { ...process.env, BROWSER: browser, NO_COLOR: "1" },
      });
      assert.equal(opened.status, 0, opened.stderr);
      assert.match(opened.stdout, new RegExp(`Opened http://localhost:${port}`));
    }

    const cancelled = runCli("kill", String(port));
    assert.equal(cancelled.status, 5);
    assert.match(cancelled.stdout, /Cancelled/);
    assert.equal(runCli("info", String(port)).status, 0, "cancelled kill must leave server running");

    const killed = runCli("kill", String(port), "--force");
    assert.equal(killed.status, 0, killed.stderr);
    assert.match(killed.stdout, /Stopped bun/);
    assert.equal(runCli("info", String(port)).status, 3);
  } finally { stopChild(child); }
});

test("--force escalates when a process ignores graceful termination", { timeout: 15_000 }, async (context) => {
  if (process.platform === "win32") { context.skip("Windows uses taskkill for termination"); return; }
  const { child, port } = await startServer(true);
  try {
    const killed = runCli("kill", String(port), "--force");
    assert.equal(killed.status, 0, killed.stderr);
    assert.match(killed.stdout, /Force-stopped bun/);
    assert.equal(runCli("info", String(port)).status, 3);
  } finally { stopChild(child); }
});

test("interactive kill defaults to no in a pseudo-terminal", { timeout: 15_000 }, async (context) => {
  if (process.platform === "win32") { context.skip("expect is not available on Windows runners"); return; }
  const available = spawnSync("expect", ["-v"], { encoding: "utf8" });
  if (available.error) { context.skip("expect is unavailable"); return; }
  const { child, port } = await startServer();
  try {
    const script = [
      "set timeout 10",
      `spawn ${process.execPath} run ${cli} kill ${port}`,
      'expect "\\[y/N\\]"',
      'send "n\\r"',
      'expect "Cancelled."',
      "expect eof",
    ].join("; ");
    const result = spawnSync("expect", ["-c", script], { cwd: root, encoding: "utf8", timeout: 12_000 });
    assert.equal(result.error, undefined);
    assert.match(`${result.stdout}${result.stderr}`, /Cancelled/);
    assert.equal(runCli("info", String(port)).status, 0, "interactive cancellation must leave server running");
  } finally { stopChild(child); }
});

test("CLI uses documented exit codes", () => {
  assert.equal(runCli("info", "not-a-port").status, 2);
  assert.equal(runCli("info", "65534").status, 3);
  assert.equal(runCli("unknown").status, 2);
});
