// En Android las actualizaciones llegan por la tienda (o por un APK nuevo), no por electron-updater.
const { EventEmitter } = require('events');
const autoUpdater = Object.assign(new EventEmitter(), { autoDownload: false, autoInstallOnAppQuit: false, logger: null, checkForUpdates: async () => null, checkForUpdatesAndNotify: async () => null, downloadUpdate: async () => null, quitAndInstall: () => {}, setFeedURL: () => {} });
module.exports = { autoUpdater };
