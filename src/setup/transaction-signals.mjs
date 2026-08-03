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
  const handleParentExit = () => interrupt("SIGTERM");
  processObject.once("SIGINT", handleInterrupt);
  processObject.once("SIGTERM", handleTermination);
  const monitorParent = processObject.connected === true;
  if (monitorParent) processObject.once("disconnect", handleParentExit);

  try {
    await operation(controller.signal);
    return { error: null, signal: null };
  } catch (error) {
    await rollback(error);
    return { error, signal: receivedSignal ?? null };
  } finally {
    processObject.off("SIGINT", handleInterrupt);
    processObject.off("SIGTERM", handleTermination);
    if (monitorParent) processObject.off("disconnect", handleParentExit);
  }
}
