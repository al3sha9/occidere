export interface PortProcess {
  port: number;
  pid: number;
  command: string;
  project?: string;
  cwd?: string;
  address: string;
  protocol: "tcp" | "tcp6";
}
