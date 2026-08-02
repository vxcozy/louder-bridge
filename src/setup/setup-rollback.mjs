import { rollbackApplicationBundle } from "./application-bundle.mjs";
import { openOnboardingApplication } from "./permission-onboarding.mjs";
import { stopOnboardingApplication } from "./running-application.mjs";

export async function rollbackSetupApplication(
  application,
  {
    installedApp = application?.app,
    reopenPrevious = false,
    stopApplication = stopOnboardingApplication,
    rollbackBundle = rollbackApplicationBundle,
    openApplication = openOnboardingApplication,
  } = {},
) {
  if (application) {
    stopApplication({ launcher: application.launcher });
    rollbackBundle(application);
  }
  if (reopenPrevious) await openApplication(installedApp);
}
