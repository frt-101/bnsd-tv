import { playerEngine } from './playerEngine.js';

// If no channel change has happened in this long, something's actually wedged
// (frozen player, dead event loop, etc.) rather than just a slow video —
// even the longest configured clip cutoff is nowhere near this.
const STALL_THRESHOLD_MS = 5 * 60 * 1000;
const STALL_CHECK_INTERVAL_MS = 30 * 1000;

// Periodic safety-valve reload so a kiosk tab that's been open for an entire
// business day doesn't slowly accumulate memory/state issues in the WebView.
const PREVENTIVE_RELOAD_MS = 6 * 60 * 60 * 1000;

let stallCheckIntervalId = null;
let preventiveReloadTimeoutId = null;

function reload(reason) {
  console.warn(`BNSD TV watchdog: reloading (${reason})`);
  window.location.reload();
}

/**
 * Start background monitoring for a wedged player and a scheduled preventive
 * reload. Call once, after the stream has started.
 */
export function startWatchdog() {
  clearInterval(stallCheckIntervalId);
  stallCheckIntervalId = setInterval(() => {
    if (!playerEngine.lastAdvanceAt) return;
    const stalledForMs = Date.now() - playerEngine.lastAdvanceAt;
    if (stalledForMs > STALL_THRESHOLD_MS) {
      reload(`no channel change in ${Math.round(stalledForMs / 1000)}s`);
    }
  }, STALL_CHECK_INTERVAL_MS);

  clearTimeout(preventiveReloadTimeoutId);
  preventiveReloadTimeoutId = setTimeout(() => {
    reload('scheduled preventive reload');
  }, PREVENTIVE_RELOAD_MS);
}
