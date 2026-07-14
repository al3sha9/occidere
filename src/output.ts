import type { PortProcess } from "./types.ts";

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const cyan = (text: string) => color ? `\x1b[36m${text}\x1b[0m` : text;
const dim = (text: string) => color ? `\x1b[2m${text}\x1b[0m` : text;

export function printInfo(item: PortProcess): void {
  if (item.project) console.log(`${cyan("Project")}  ${item.project}`);
  console.log(`${cyan("Port")}     ${item.port}`);
  console.log(`${cyan("Process")}  ${item.command}`);
  console.log(`${cyan("PID")}      ${item.pid}`);
  if (item.cwd) console.log(`${cyan("Path")}     ${item.cwd}`);
  console.log(`${cyan("Address")}  ${item.address}`);
  console.log(`${cyan("Status")}   Running`);
}

export function printList(items: PortProcess[]): void {
  if (!items.length) { console.log(dim("No listening TCP ports found.")); return; }
  const widths = {
    port: Math.max(4, ...items.map((x) => String(x.port).length)),
    pid: Math.max(3, ...items.map((x) => String(x.pid).length)),
    process: Math.max(7, ...items.map((x) => x.command.length)),
    project: Math.max(7, ...items.map((x) => (x.project || "—").length)),
  };
  console.log(dim(`${"PORT".padEnd(widths.port)}  ${"PID".padEnd(widths.pid)}  ${"PROJECT".padEnd(widths.project)}  ${"PROCESS".padEnd(widths.process)}  ADDRESS`));
  for (const item of items) {
    console.log(`${cyan(String(item.port).padEnd(widths.port))}  ${String(item.pid).padEnd(widths.pid)}  ${(item.project || "—").padEnd(widths.project)}  ${item.command.padEnd(widths.process)}  ${item.address}`);
  }
}
