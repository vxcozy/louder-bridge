export async function runInterruptibleSetup({
  operation,
  rollback,
  processObject = process,
}) {
  const controller = new AbortController();
  let receivedSignal;
  const interrupt = (signal) => {
    receivedSignal ??= signal;
    controller.abort();
  };
  const handleInterrupt = () => interrupt("SIGINT");
  const handleTermination = () => interrupt("SIGTERM");
  processObject.once("SIGINT", handleInterrupt);
  processObject.once("SIGTERM", handleTermination);

  try {
    await operation(controller.signal);
    return { error: null, signal: null };
  } catch (error) {
    await rollback(error);
    return { error, signal: receivedSignal ?? null };
  } finally {
    processObject.off("SIGINT", handleInterrupt);
    processObject.off("SIGTERM", handleTermination);
  }
}
