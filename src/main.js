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

  // 3. Load CSV Catalog (bnsd_tv_playlist.csv)
  const isLoaded = await catalogManager.loadCSV('/bnsd_tv_playlist.csv');
  if (!isLoaded) {
    console.error("Failed to load bnsd_tv_playlist.csv catalog.");
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
      if (remoteConfig.enabledDecades) adminController.enabledDecades = remoteConfig.enabledDecades;
      if (remoteConfig.enabledCategories) adminController.enabledCategories = remoteConfig.enabledCategories;
      if (remoteConfig.commercialMaxSec) adminController.commercialMaxSec = remoteConfig.commercialMaxSec;
      if (remoteConfig.generalClipMaxSec) adminController.generalClipMaxSec = remoteConfig.generalClipMaxSec;
      if (remoteConfig.randomOffsetEnabled !== undefined) adminController.randomOffsetEnabled = remoteConfig.randomOffsetEnabled;
      if (remoteConfig.pacingMode) adminController.pacingMode = remoteConfig.pacingMode;
      if (remoteConfig.zapBurstEnabled !== undefined) adminController.zapBurstEnabled = remoteConfig.zapBurstEnabled;
      
      playerEngine.updatePacingRules(
        adminController.commercialMaxSec,
        adminController.generalClipMaxSec,
        adminController.randomOffsetEnabled,
        adminController.pacingMode,
        adminController.zapBurstEnabled
      );
    }
  });

  // 6. Initialize YouTube Player Engine and Start Stream with CRT Power-On Warmup
  const queue = catalogManager.generateChannelQueue(channelParam, adminController.enabledCategories, adminController.enabledDecades);

  const countEl = document.getElementById('tel-queue-count');
  if (countEl) countEl.textContent = `${queue.length.toLocaleString()} videos`;

  // Start CRT Analog Warmup & Auto-Tuning Static Sequence
  const eraBadge = document.getElementById('osd-era-badge');
  const catLabel = document.getElementById('osd-category-label');
  const chNum = adminController.getChannelNum(channelParam);
  if (eraBadge) eraBadge.textContent = '⚡ POWER ON';
  if (catLabel) catLabel.textContent = `TUNING CH ${chNum} BROADCAST...`;

  effectsEngine.triggerWarmup(5800, chNum, () => {
    playerEngine.updateOSD(playerEngine.currentVideoItem);
  });

  const randomStartIndex = queue.length > 0 ? Math.floor(Math.random() * queue.length) : 0;
  playerEngine.init(queue, randomStartIndex, () => {
    playerEngine.startStream(queue, randomStartIndex);
    startWatchdog();
  });

  // Prevent browser from ever holding focus on YouTube iframes
  window.addEventListener('blur', () => {
    if (document.activeElement && document.activeElement.tagName === 'IFRAME') {
      document.activeElement.blur();
      window.focus();
    }
  });

  document.getElementById('player-shield')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    window.focus();
  });
}

// Launch application on DOM Ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapApp);
} else {
  bootstrapApp();
}
