import { createStandaloneApplication } from './standalone/application.js';
import { describeError } from './standalone/errors.js';
import { t } from './i18n/index.js';
import { installMapDiagnostics } from './standalone/mapDiagnostics.js';

const application = createStandaloneApplication({
  googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
  cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
  allowQaRegistration: import.meta.env.DEV,
});

const diagnostics = installMapDiagnostics({ application });

application.start().catch((error) => {
  diagnostics.recordError('startup-error', error);
  console.error("God's Eye View initialization failed:", error);
  const loaderStatus = document.querySelector('#loading-screen .loader-status');
  loaderStatus.textContent = t('Error: {message}', {
    message: describeError(error),
  });
  loaderStatus.style.color = '#ff4444';
  const reportButton = document.createElement('button');
  reportButton.type = 'button';
  reportButton.textContent = t('Save map diagnostics');
  reportButton.addEventListener('click', diagnostics.download);
  loaderStatus.after(reportButton);
});

if (import.meta.hot) import.meta.hot.dispose(() => diagnostics.destroy());

export { application };
