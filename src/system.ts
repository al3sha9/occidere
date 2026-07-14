import { execFile } from "node:child_process";
import { readFile, readlink } from "node:fs/promises";
import { basename, dirname, join, parse } from "node:path";
import { connect as connectTls } from "node:tls";
import { connect as connectTcp } from "node:net";
import { promisify } from "node:util";
import type { PortProcess } from "./types.ts";

const exec = promisify(execFile);

async function run(file: string, args: string[]): Promise<string> {
  const { stdout } = await exec(file, args, { encoding: "utf8", windowsHide: true });
  return stdout;
}

export function parseLsof(output: string): PortProcess[] {
  const results: PortProcess[] = [];
  let command = "unknown";
  let pid = 0;

  for (const line of output.split("\n")) {
    if (!line) continue;
    const field = line[0];
    const value = line.slice(1);
    if (field === "p") pid = Number(value);
    if (field === "c") command = value;
    if (field !== "n") continue;
    const match = value.match(/(?:\[.*\]|[^:]+):(\d+)$/);
    if (!match || !pid) continue;
    results.push({
      port: Number(match[1]), pid, command, address: value,
      protocol: value.startsWith("[") ? "tcp6" : "tcp",
    });
  }
  return results;
}

export function parseSs(output: string): PortProcess[] {
  const results: PortProcess[] = [];
  for (const line of output.split("\n")) {
    const pidMatch = line.match(/pid=(\d+)/);
    const commandMatch = line.match(/users:\(\(\"([^\"]+)/);
    const addressMatch = line.match(/\s(\[.*\]|\S+):(\d+)\s+/);
    if (!pidMatch || !addressMatch) continue;
    results.push({
      port: Number(addressMatch[2]), pid: Number(pidMatch[1]),
      command: commandMatch?.[1] ?? "unknown",
      address: `${addressMatch[1]}:${addressMatch[2]}`,
      protocol: addressMatch[1].includes(":") ? "tcp6" : "tcp",
    });
  }
  return results;
}

export function parseNetstat(output: string): Array<Omit<PortProcess, "command">> {
  const results: Array<Omit<PortProcess, "command">> = [];
  for (const line of output.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5 || !parts[0].toUpperCase().startsWith("TCP")) continue;
    const address = parts[1];
    const match = address.match(/:(\d+)$/);
    const pid = Number(parts.at(-1));
    if (!match || !pid || !parts.includes("LISTENING")) continue;
    results.push({ port: Number(match[1]), pid, address, protocol: address.startsWith("[") ? "tcp6" : "tcp" });
  }
  return results;
}

async function listUnix(): Promise<PortProcess[]> {
  try {
    return parseLsof(await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"]));
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") return parseLsof((error as { stdout?: string }).stdout ?? "");
  }
  try {
    return parseSs(await run("ss", ["-ltnpH"]));
  } catch {
    throw new Error("Could not inspect ports: neither lsof nor ss is available.");
  }
}

async function listWindows(): Promise<PortProcess[]> {
  const sockets = parseNetstat(await run("netstat", ["-ano", "-p", "tcp"]));
  const names = new Map<number, string>();
  await Promise.all([...new Set(sockets.map((item) => item.pid))].map(async (pid) => {
    try {
      const output = await run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
      names.set(pid, output.match(/^\"([^\"]+)/)?.[1] ?? "unknown");
    } catch { names.set(pid, "unknown"); }
  }));
  return sockets.map((socket) => ({ ...socket, command: names.get(socket.pid) ?? "unknown" }));
}

export async function projectFromDirectory(cwd: string): Promise<string> {
  let directory = cwd;
  for (let depth = 0; depth < 8; depth++) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as { name?: unknown };
      if (typeof manifest.name === "string" && manifest.name.trim()) return manifest.name;
    } catch { /* Walk upward when this is not a JavaScript project root. */ }
    const parent = dirname(directory);
    if (parent === directory || directory === parse(directory).root) break;
    directory = parent;
  }
  return basename(cwd);
}

async function workingDirectory(pid: number): Promise<string | undefined> {
  if (process.platform === "win32") return undefined;
  if (process.platform === "linux") {
    try { return await readlink(`/proc/${pid}/cwd`); } catch { return undefined; }
  }
  try {
    const output = await run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
    return output.split("\n").find((line) => line.startsWith("n"))?.slice(1);
  } catch { return undefined; }
}

async function enrichProjects(items: PortProcess[]): Promise<PortProcess[]> {
  const projects = new Map<number, { cwd?: string; project?: string }>();
  await Promise.all([...new Set(items.map((item) => item.pid))].map(async (pid) => {
    const cwd = await workingDirectory(pid);
    projects.set(pid, cwd ? { cwd, project: await projectFromDirectory(cwd) } : {});
  }));
  return items.map((item) => ({ ...item, ...projects.get(item.pid) }));
}

export async function listPorts(): Promise<PortProcess[]> {
  const items = process.platform === "win32" ? await listWindows() : await listUnix();
  const unique = new Map(items.map((item) => [`${item.pid}:${item.port}`, item]));
  return (await enrichProjects([...unique.values()])).sort((a, b) => a.port - b.port || a.pid - b.pid);
}

async function isRunning(pid: number): Promise<boolean> {
  try { process.kill(pid, 0); }
  catch (error: unknown) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
  try {
    if (process.platform === "linux") {
      const state = (await readFile(`/proc/${pid}/stat`, "utf8")).split(" ")[2];
      return state !== "Z";
    }
    if (process.platform === "darwin") {
      const state = (await run("ps", ["-p", String(pid), "-o", "stat="])).trim();
      return !state.startsWith("Z");
    }
  } catch { return false; }
  return true;
}

async function waitForExit(pid: number, timeoutMs = 1500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await isRunning(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !await isRunning(pid);
}

export async function killProcess(pid: number, force = false): Promise<{ forced: boolean }> {
  if (process.platform === "win32") await run("taskkill", ["/PID", String(pid), "/T"]);
  else process.kill(pid, "SIGTERM");
  if (await waitForExit(pid)) return { forced: false };
  if (!force) throw new Error(`Process ${pid} did not exit after SIGTERM. Retry with --force.`);
  if (process.platform === "win32") await run("taskkill", ["/PID", String(pid), "/T", "/F"]);
  else process.kill(pid, "SIGKILL");
  if (!await waitForExit(pid)) throw new Error(`Process ${pid} could not be stopped.`);
  return { forced: true };
}

export async function detectLocalUrl(port: number, timeoutMs = 500): Promise<string> {
  const plainHttp = await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    const socket = connectTcp({ host: "localhost", port }, () => {
      socket.write(`HEAD / HTTP/1.0\r\nHost: localhost:${port}\r\n\r\n`);
    });
    socket.once("data", (data) => finish(data.toString().startsWith("HTTP/")));
    socket.once("error", () => finish(false));
    socket.once("end", () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
  if (plainHttp) return `http://localhost:${port}`;

  const secure = await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    const socket = connectTls({ host: "localhost", port, rejectUnauthorized: false });
    socket.once("secureConnect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
  return `${secure ? "https" : "http"}://localhost:${port}`;
}

export async function openUrl(url: string): Promise<void> {
  if (process.env.BROWSER) { await run(process.env.BROWSER, [url]); return; }
  if (process.platform === "darwin") await run("open", [url]);
  else if (process.platform === "win32") await run("cmd", ["/c", "start", "", url]);
  else await run("xdg-open", [url]);
}
