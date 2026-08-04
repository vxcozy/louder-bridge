import { rollbackApplicationBundle } from "./application-bundle.mjs";
import {
  removeLaunchAgent,
  restoreRemovedLaunchAgent,
} from "./launch-agent.mjs";
import { openOnboardingApplication } from "./permission-onboarding.mjs";
import { stopOnboardingApplication } from "./running-application.mjs";

export async function rollbackSetupApplication(
  application,
  {
    installedApp = application?.app,
    reopenPrevious = false,
    previousAgent,
    stopApplication = stopOnboardingApplication,
    removeCurrentAgent = removeLaunchAgent,
    rollbackBundle = rollbackApplicationBundle,
    restorePreviousAgent = restoreRemovedLaunchAgent,
    openApplication = openOnboardingApplication,
  } = {},
) {
  if (application) {
    stopApplication({ launcher: application.launcher });
  }
  if (previousAgent?.removed) {
    removeCurrentAgent();
  }
  if (application) {
    rollbackBundle(application);
  }
  if (previousAgent?.removed) {
    restorePreviousAgent(previousAgent);
  }
  if (reopenPrevious) await openApplication(installedApp);
}
