import { playerEngine } from './playerEngine.js';

// If no channel change has happened in this long, something's actually wedged
// (frozen player, dead event loop, etc.) rather than just a slow video —
// even the longest configured clip cutoff is nowhere near this.
const STALL_THRESHOLD_MS = 5 * 60 * 1000;
const STALL_CHECK_INTERVAL_MS = 30 * 1000;

// Once-daily safety-valve reload, anchored to a fixed local clock hour
// rather than "N hours after whenever the kiosk happened to boot" — cheap
// insurance against slow memory/state buildup from hours of loadVideoById()
// calls on a long-lived WebView tab. Anchored to land inside FreeKiosk's own
// overnight blank window (off ~11pm-midnight, back on ~9-11am per current
// projector schedules) rather than a rolling timer that could just as easily
// land mid-dinner-service. FreeKiosk blanking the display doesn't reliably
// kill the WebView process (see docs/BUSINESS_HOURS_SYNC.md) — that's exactly
// why this can't just rely on "the page reloads naturally every morning."
// Since nobody's watching a blanked screen, the reload (and its ~6s CRT
// warmup) costs nothing here. Move this if a location's actual blank window
// differs from the range above.
const PREVENTIVE_RELOAD_HOUR_LOCAL = 3; // 0-23, local kiosk clock, aim for the middle of the nightly blank window
const DAILY_RELOAD_CHECK_INTERVAL_MS = 60 * 1000;

let stallCheckIntervalId = null;
let dailyReloadCheckIntervalId = null;
let lastPreventiveReloadDay = null;

function reload(reason) {
  console.warn(`BNSD TV watchdog: reloading (${reason})`);
  window.location.reload();
}

/**
 * Start background monitoring for a wedged player and a once-daily
 * preventive reload anchored to a fixed off-hours clock time. Call once,
 * after the stream has started.
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

  // Don't fire on the same day the page happened to boot -- only from the
  // first full night onward, the first time the local clock crosses the
  // target hour on a new calendar day.
  lastPreventiveReloadDay = new Date().toDateString();
  clearInterval(dailyReloadCheckIntervalId);
  dailyReloadCheckIntervalId = setInterval(() => {
    const now = new Date();
    const today = now.toDateString();
    if (today === lastPreventiveReloadDay) return;
    if (now.getHours() !== PREVENTIVE_RELOAD_HOUR_LOCAL) return;
    lastPreventiveReloadDay = today;
    reload(`scheduled preventive reload (${PREVENTIVE_RELOAD_HOUR_LOCAL}:00 local)`);
  }, DAILY_RELOAD_CHECK_INTERVAL_MS);
}
