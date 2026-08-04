export function installSignalShutdown(
  target,
  {
    processObject = process,
    onError = () => {},
    exit = (code) => process.exit(code),
  } = {},
) {
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await target.stop();
      exit(0);
    } catch (error) {
      try {
        onError(error);
      } finally {
        exit(1);
      }
    }
  };
  processObject.once("SIGINT", stop);
  processObject.once("SIGTERM", stop);
  return stop;
}
