import { catalogManager } from './catalogManager.js';
import { playerEngine } from './playerEngine.js';
import { effectsEngine } from './effectsEngine.js';
import { adminController } from './admin.js';
import { subscribeChannelConfig } from './firebase.js';
import { startWatchdog } from './watchdog.js';

async function bootstrapApp() {
  console.log("Initializing BNSD TV...");

  // Give every video a fresh chance each launch (e.g. after the kiosk's
  // overnight power-off / morning relaunch) rather than permanently
  // quarantining videos that hit a one-off YouTube blip. Must go through
  // catalogManager so the in-memory flag set is cleared too, not just the
  // persisted copy.
  catalogManager.clearDeadVideoFlags();

  // 1. Initialize Retro Effects Engine
  effectsEngine.init();

  // 2. Parse URL Parameters
  const urlParams = new URLSearchParams(window.location.search);
  const channelParam = urlParams.get('channel') || 'projector-bar';
  const openAdminParam = urlParams.get('admin');
  const tvParam = urlParams.get('tv') || urlParams.get('frame') || urlParams.get('mode') || urlParams.get('theme');

  const isTvMode = tvParam === 'true' || tvParam === 'trinitron' || tvParam === 'red' || (localStorage.getItem('bnsd_tv_frame') === 'true');
  adminController.tvFrameEnabled = isTvMode;
  document.body.classList.toggle('trinitron-mode', isTvMode);

  adminController.currentChannelId = channelParam;
  const selectChannel = document.getElementById('select-channel');
  if (selectChannel) selectChannel.value = channelParam;

  // Set OSD Channel Title
  const osdChannel = document.getElementById('osd-channel-label');
  if (osdChannel) {
    osdChannel.textContent = `CH ${adminController.getChannelNum(channelParam)} • BNSD TV`;
  }

  // 3. Load CSV Catalog (90s_playlist.csv)
  const isLoaded = await catalogManager.loadCSV('/90s_playlist.csv');
  if (!isLoaded) {
    console.error("Failed to load 90s_playlist.csv catalog.");
    return;
  }

  // 4. Initialize Admin Controller & Categories Grid
  adminController.init();

  // If ?admin=true in URL, open modal automatically
  if (openAdminParam === 'true') {
    document.getElementById('admin-modal')?.classList.remove('hidden');
  }

  // 5. Subscribe to Firestore / LocalStorage real-time channel updates
  subscribeChannelConfig(channelParam, (remoteConfig) => {
    if (remoteConfig) {
      if (remoteConfig.enabledCategories) adminController.enabledCategories = remoteConfig.enabledCategories;
      if (remoteConfig.commercialMaxSec) adminController.commercialMaxSec = remoteConfig.commercialMaxSec;
      if (remoteConfig.generalClipMaxSec) adminController.generalClipMaxSec = remoteConfig.generalClipMaxSec;
      if (remoteConfig.randomOffsetEnabled !== undefined) adminController.randomOffsetEnabled = remoteConfig.randomOffsetEnabled;
      
      playerEngine.updatePacingRules(
        adminController.commercialMaxSec,
        adminController.generalClipMaxSec,
        adminController.randomOffsetEnabled
      );
    }
  });

  // 6. Initialize YouTube Player Engine and Start Stream once players are ready
  const queue = catalogManager.generateChannelQueue(channelParam, adminController.enabledCategories);

  const countEl = document.getElementById('tel-queue-count');
  if (countEl) countEl.textContent = `${queue.length} videos`;

  playerEngine.init(() => {
    const randomStartIndex = queue.length > 0 ? Math.floor(Math.random() * queue.length) : 0;
    playerEngine.startStream(queue, randomStartIndex);
    startWatchdog();
  });
}

// Launch application on DOM Ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapApp);
} else {
  bootstrapApp();
}
