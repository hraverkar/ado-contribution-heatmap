/**
 * Entry point.
 *
 * Completes the host handshake, builds the Azure DevOps context, and hands off
 * to the app controller. Bootstrap failures are rendered as a friendly error
 * rather than left as a blank frame, and the host is told either way so its own
 * loading indicator resolves.
 */

import {
  createAzureDevOpsContext,
  initializeHost,
  notifyFailed,
  notifyLoaded,
} from './api/azureDevOpsClient.js';
import { toAppError } from './models/errors.js';
import { logError } from './util/log.js';
import { App } from './ui/app.js';
import { requireElement } from './ui/dom.js';
import { renderErrorState } from './ui/states.js';
import { watchTheme } from './ui/theme.js';

async function bootstrap(): Promise<void> {
  const root = requireElement('app');

  try {
    await initializeHost();
    watchTheme();

    const context = await createAzureDevOpsContext();
    const app = new App(context, root);

    // Tell the host we rendered before the first scan finishes, so its spinner
    // gives way to our own progress instead of stacking two loading states.
    await notifyLoaded();
    await app.start();
  } catch (caught) {
    const error = toAppError(caught, 'Unable to retrieve Azure DevOps activity. Please try again.');
    logError('Failed to start.', caught);

    root.replaceChildren(
      renderErrorState(error, () => {
        window.location.reload();
      }),
    );

    // The host still needs to stop showing its loading indicator.
    await notifyFailed(error).catch(() => undefined);
  }
}

void bootstrap();
