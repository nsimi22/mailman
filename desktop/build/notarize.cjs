// electron-builder `afterSign` hook: notarize the signed macOS .app with Apple's notarytool.
// Same approach as nsimi22/video-chat-app (Huddle). Skips cleanly when the Apple credentials
// are not present, so local `npm run desktop:dist` still produces an (unsigned) build.
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log('[notarize] Apple credentials not set — skipping notarization.');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  console.log(`[notarize] submitting ${appName}.app to notarytool …`);
  await notarize({
    tool: 'notarytool',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });
  console.log('[notarize] done.');
};
