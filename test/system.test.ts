import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { detectLocalUrl, parseLsof, parseNetstat, parseSs, projectFromDirectory } from "../src/system.ts";

test("parses lsof field output", () => {
  const items = parseLsof("p48213\ncnode\nn127.0.0.1:3000\n");
  assert.deepEqual(items, [{ port: 3000, pid: 48213, command: "node", address: "127.0.0.1:3000", protocol: "tcp" }]);
});

test("parses Linux ss output", () => {
  const items = parseSs('LISTEN 0 511 0.0.0.0:5173 0.0.0.0:* users:(("node",pid=1234,fd=20))');
  assert.equal(items[0]?.port, 5173);
  assert.equal(items[0]?.command, "node");
  assert.equal(items[0]?.pid, 1234);
});

test("parses Windows netstat output", () => {
  const items = parseNetstat("  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    9216");
  assert.equal(items[0]?.port, 3000);
  assert.equal(items[0]?.pid, 9216);
});

test("detects the current project from package.json", async () => {
  assert.equal(await projectFromDirectory(process.cwd()), "occidere");
});

test("detects an HTTP local service", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
  const port = server.port;
  assert.ok(port);
  try { assert.equal(await detectLocalUrl(port), `http://localhost:${port}`); }
  finally { server.stop(true); }
});

test("detects an HTTPS local service", async () => {
  const available = spawnSync("openssl", ["version"], { encoding: "utf8" });
  if (available.error) return;
  const directory = await mkdtemp(join(tmpdir(), "occidere-tls-"));
  const key = join(directory, "key.pem");
  const cert = join(directory, "cert.pem");
  const generated = spawnSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost",
    "-keyout", key, "-out", cert, "-days", "1",
  ], { stdio: "ignore" });
  assert.equal(generated.status, 0);
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0, tls: { key: Bun.file(key), cert: Bun.file(cert) },
    fetch: () => new Response("secure"),
  });
  const port = server.port;
  assert.ok(port);
  try { assert.equal(await detectLocalUrl(port), `https://localhost:${port}`); }
  finally { server.stop(true); }
});
