#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { CliError, ExitCode } from "./errors.ts";
import { detectLocalUrl, killProcess, listPorts, openUrl } from "./system.ts";
import { printInfo, printList } from "./output.ts";

const HELP = `occidere — understand and manage local ports

Usage:
  occidere <port>          Show what is running on a port
  occidere info <port>     Show what is running on a port
  occidere list            List listening TCP ports
  occidere kill <port>     Gracefully stop the process on a port
  occidere open <port>     Open the port in your browser
  occidere --help          Show this help

Options:
  -f, --force              Skip confirmation and force-stop if needed`;

function parsePort(value: string | undefined): number {
  const port = Number(value);
  if (!value || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CliError(`Invalid port: ${value ?? "(missing)"}. Expected a number from 1 to 65535.`, ExitCode.usage);
  }
  return port;
}

async function find(port: number) {
  return (await listPorts()).filter((item) => item.port === port);
}

async function show(port: number): Promise<void> {
  const matches = await find(port);
  if (!matches.length) throw new CliError(`Nothing is listening on port ${port}.`, ExitCode.notFound);
  matches.forEach((item, index) => { if (index) console.log(); printInfo(item); });
}

async function confirm(message: string): Promise<boolean> {
  if (!stdin.isTTY) return false;
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(`${message} [y/N] `);
  rl.close();
  return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
}

async function main(): Promise<void> {
  const [command, value, ...rest] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h" || command === "help") { console.log(HELP); return; }
  if (command === "--version" || command === "-v") { console.log("occidere 0.1.0"); return; }
  if (command === "list") { printList(await listPorts()); return; }
  if (/^\d+$/.test(command)) { await show(parsePort(command)); return; }

  const port = parsePort(value);
  if (command === "info") { await show(port); return; }
  if (command === "open") {
    const matches = await find(port);
    if (!matches.length) throw new CliError(`Nothing is listening on port ${port}.`, ExitCode.notFound);
    const url = await detectLocalUrl(port);
    await openUrl(url);
    console.log(`Opened ${url}`);
    return;
  }
  if (command === "kill") {
    const matches = await find(port);
    if (!matches.length) throw new CliError(`Nothing is listening on port ${port}.`, ExitCode.notFound);
    const forced = rest.includes("--force") || rest.includes("-f");
    for (const item of matches) {
      if (!forced && !await confirm(`Stop ${item.command} (PID ${item.pid}) on port ${port}?`)) {
        console.log("Cancelled."); process.exitCode = ExitCode.cancelled; continue;
      }
      const result = await killProcess(item.pid, forced);
      console.log(`${result.forced ? "Force-stopped" : "Stopped"} ${item.command} (PID ${item.pid}).`);
    }
    return;
  }
  throw new CliError(`Unknown command: ${command}. Run occidere --help for usage.`, ExitCode.usage);
}

main().catch((error: unknown) => {
  console.error(`occidere: ${error instanceof Error ? error.message : String(error)}`);
  const code = error instanceof CliError ? error.exitCode
    : (error as NodeJS.ErrnoException)?.code === "EPERM" ? ExitCode.permission : ExitCode.failure;
  process.exitCode = code;
});
