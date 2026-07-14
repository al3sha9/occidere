# occidere

`occidere` tells you what is listening on a local port and lets you deal with it without looking up the right `lsof`, `ss`, or `netstat` command.

```console
$ occidere 3000
Project  alishan.dev
Port     3000
Process  node
PID      28812
Path     /Users/you/projects/alishan-dev
Address  *:3000
Status   Running
```

## commands

```sh
occidere 3000          # show what is using port 3000
occidere info 3000     # same as above
occidere list          # list listening TCP ports
occidere open 3000     # open the service in your browser
occidere kill 3000     # ask before stopping the process
occidere kill 3000 -f  # skip the prompt and force the process to stop if needed
```

Project names come from the nearest `package.json`. If there is no package file, occidere uses the process working directory when it can.

The `open` command checks whether the service uses HTTP or HTTPS before launching the browser. You can set the `BROWSER` environment variable if you do not want to use the system default.

## requirements

You need [Bun](https://bun.sh/) 1.1 or newer.

The published CLI has no npm runtime dependencies. It only imports Bun or Node built-in modules. It still relies on tools supplied by the operating system:

| System | Commands used |
| --- | --- |
| macOS | `lsof`, `open`, `ps` |
| Linux | `lsof` or `ss`, `xdg-open` |
| Windows | `netstat`, `tasklist`, `taskkill`, `cmd` |

Most systems already include these commands. Some minimal Linux installations may need `lsof` or `iproute2`, which provides `ss`.

TypeScript and `@types/bun` are development dependencies. They are used for type checking and do not become part of the installed CLI.

## local setup

```sh
bun install
bun link
occidere --help
```

Run the checks with:

```sh
bun test
bun run typecheck
```

The test suite starts its own local servers. It never needs to stop a process that it did not create.

## process safety

`occidere kill` asks for confirmation, then sends the normal termination signal. If the process is still alive after 1.5 seconds, the command tells you to retry with `--force`.

`--force` skips confirmation. It tries a normal shutdown first and uses a forced stop only when the process refuses to exit.

## exit codes

| Code | Meaning |
| ---: | --- |
| `0` | Success |
| `1` | Runtime or system failure |
| `2` | Invalid command or argument |
| `3` | Nothing is listening on the requested port |
| `4` | Permission denied |
| `5` | The user cancelled the operation |

## versions

occidere follows semantic versioning:

- Patch releases such as `0.1.1` contain fixes that do not change the command interface.
- Minor releases such as `0.2.0` add backward-compatible features.
- Major releases such as `1.0.0` may change existing commands or behavior.

Each GitHub release must use a tag that matches the version in `package.json`, prefixed with `v`. For example, package version `0.2.0` uses the tag `v0.2.0`.
