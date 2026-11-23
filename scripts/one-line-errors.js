// Loaded before each operator's command: a failure ends it with its message
// on one line, as the participants' commands do, never a stack.
for (const event of ["uncaughtException", "unhandledRejection"]) {
  process.on(event, (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
