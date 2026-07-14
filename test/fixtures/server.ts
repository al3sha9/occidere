const ignoreTerm = process.argv.includes("--ignore-term");
if (ignoreTerm) process.on("SIGTERM", () => {});

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Response("occidere integration test"),
});

console.log(`PORT=${server.port}`);
