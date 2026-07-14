export const ExitCode = {
  success: 0,
  failure: 1,
  usage: 2,
  notFound: 3,
  permission: 4,
  cancelled: 5,
} as const;

export class CliError extends Error {
  constructor(message: string, readonly exitCode: number = ExitCode.failure) {
    super(message);
  }
}
