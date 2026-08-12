import { effectsEngine } from './effectsEngine.js';
import { catalogManager } from './catalogManager.js';

class PlayerEngine {
  constructor() {
    this.playerA = null;
    this.playerB = null;
    this.activePlayerId = 'A'; // 'A' or 'B'
    this.isApiReady = false;

    this.queue = [];
    this.currentIndex = 0;
    this.consecutiveErrorCount = 0;

    // Watchdog support: timestamp of the last successful channel change, and
    // the pending autoplay-retry timer for whatever's currently loading.
    this.lastAdvanceAt = null;
    this.autoplayFallbackTimeout = null;

    // Tracks which video object is actually loaded/cued on each physical player,
    // so error handling can identify and quarantine the right video regardless
    // of which player (active or preloading) reported the error.
    this.cuedItems = { A: null, B: null };

    // Config Rules
    this.commercialMaxSec = 45;
    this.generalClipMaxSec = 90;
    this.randomOffsetEnabled = true;

    // State Tracking
    this.currentVideoItem = null;
    this.clipTimer = null;
    this.elapsedSeconds = 0;
    this.activeCutoffSec = 90;
    this.onProgressCallback = null;
  }

  /**
   * Initialize YouTube iFrame API
   */
  init(onReadyCallback) {
    if (window.YT && window.YT.Player) {
      this.createPlayers(onReadyCallback);
      return;
    }

    // Load YouTube API script
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

    window.onYouTubeIframeAPIReady = () => {
      this.createPlayers(onReadyCallback);
    };
  }

  createPlayers(onReadyCallback) {
    let triggered = false;
    const fireCallback = () => {
      if (!triggered) {
        triggered = true;
        this.isApiReady = true;
        console.log("YouTube player engine active. Starting stream...");
        if (onReadyCallback) onReadyCallback();
      }
    };

    let readyCount = 0;
    const checkReady = () => {
      readyCount++;
      if (readyCount >= 1) {
        fireCallback();
      }
    };

    // Guarantee stream starts within 300ms fallback
    setTimeout(() => {
      fireCallback();
    }, 300);

    const defaultPlayerVars = {
      autoplay: 1,
      controls: 0,
      cc_load_policy: 0,
      iv_load_policy: 3,
      modestbranding: 1,
      rel: 0,
      playsinline: 1
    };

    this.playerA = new window.YT.Player('player-a', {
      playerVars: defaultPlayerVars,
      events: {
        onReady: checkReady,
        onStateChange: (e) => this.handlePlayerStateChange('A', e),
        onError: (e) => this.handlePlayerError('A', e)
      }
    });

    this.playerB = new window.YT.Player('player-b', {
      playerVars: defaultPlayerVars,
      events: {
        onReady: checkReady,
        onStateChange: (e) => this.handlePlayerStateChange('B', e),
        onError: (e) => this.handlePlayerError('B', e)
      }
    });
  }

  /**
   * Set playback queue and start playback
   */
  startStream(queue, startIndex = 0) {
    this.queue = queue;
    this.currentIndex = startIndex;

    if (!this.queue || this.queue.length === 0) {
      console.warn("Player queue is empty.");
      return;
    }

    this.playCurrentVideo();
  }

  /**
   * Play current video on active player, and preload next video on inactive player
   */
  playCurrentVideo() {
    if (!this.queue || this.queue.length === 0) return;

    // Skip over any videos flagged dead since this index was queued
    // (e.g. quarantined by the other player, or restored from a prior session).
    this.currentIndex = this.findNextLiveIndex(this.currentIndex);

    this.currentVideoItem = this.queue[this.currentIndex];
    this.cuedItems[this.activePlayerId] = this.currentVideoItem;
    this.lastAdvanceAt = Date.now();
    const activePlayer = this.getActivePlayer();

    // Determine smart clip duration and start offset
    const { startSec, maxDurationSec } = this.calculateSmartClip(this.currentVideoItem);
    this.activeCutoffSec = maxDurationSec;
    this.elapsedSeconds = 0;

    // Load active video on active player
    if (activePlayer && typeof activePlayer.loadVideoById === 'function') {
      try {
        activePlayer.loadVideoById(this.currentVideoItem.videoId, startSec);
        activePlayer.mute();
        this.scheduleAutoplayFallback(activePlayer, this.currentVideoItem.videoId);
      } catch (e) {
        console.warn("loadVideoById fallback:", e);
      }
    } else {
      const activeId = this.activePlayerId === 'A' ? 'player-a' : 'player-b';
      const iframe = document.getElementById(activeId);
      if (iframe) {
        iframe.src = `https://www.youtube.com/embed/${this.currentVideoItem.videoId}?enablejsapi=1&autoplay=1&mute=1&controls=0&playsinline=1&cc_load_policy=0&iv_load_policy=3&modestbranding=1&rel=0&start=${startSec}`;
      }
    }

    // Force unload Closed Captions module if available
    try {
      if (activePlayer && typeof activePlayer.unloadModule === 'function') {
        activePlayer.unloadModule('captions');
        activePlayer.unloadModule('cc');
      }
    } catch (e) {}

    // Update OSD green HUD display
    this.updateOSD(this.currentVideoItem);

    // Preload NEXT video on inactive player
    this.preloadNext();

    // Start clip timing monitor
    this.startClipTimer();
  }

  /**
   * Cue the next live (non-quarantined) video on the currently inactive player.
   */
  preloadNext() {
    if (!this.queue || this.queue.length === 0) return;

    const inactivePlayer = this.getInactivePlayer();
    const inactivePlayerId = this.activePlayerId === 'A' ? 'B' : 'A';
    const nextIndex = this.findNextLiveIndex((this.currentIndex + 1) % this.queue.length);
    const nextItem = this.queue[nextIndex];
    if (!nextItem) return;

    this.cuedItems[inactivePlayerId] = nextItem;
    const nextClip = this.calculateSmartClip(nextItem);

    if (inactivePlayer && typeof inactivePlayer.cueVideoById === 'function') {
      try {
        inactivePlayer.cueVideoById(nextItem.videoId, nextClip.startSec);
        inactivePlayer.mute();
      } catch (e) {}
    } else {
      const inactiveId = inactivePlayerId === 'A' ? 'player-a' : 'player-b';
      const nextIframe = document.getElementById(inactiveId);
      if (nextIframe) {
        nextIframe.src = `https://www.youtube.com/embed/${nextItem.videoId}?enablejsapi=1&autoplay=1&mute=1&controls=0&playsinline=1&cc_load_policy=0&iv_load_policy=3&modestbranding=1&rel=0&start=${nextClip.startSec}`;
      }
    }
  }

  /**
   * Some kiosk WebViews are stricter about the URL's autoplay=1 param than
   * they are about a JS-driven playVideo() call. If the active video hasn't
   * actually started (still unstarted/cued) shortly after loading, nudge it
   * directly through the Player API rather than waiting on the clip timer
   * to eventually time it out.
   */
  scheduleAutoplayFallback(player, videoId) {
    clearTimeout(this.autoplayFallbackTimeout);
    this.autoplayFallbackTimeout = setTimeout(() => {
      // Bail if the stream has already moved on to a different video.
      if (!this.currentVideoItem || this.currentVideoItem.videoId !== videoId) return;

      try {
        if (typeof player.getPlayerState !== 'function') return;
        const state = player.getPlayerState();
        const isStalled = state === -1 /* UNSTARTED */ || state === 5 /* CUED */;
        if (isStalled && typeof player.playVideo === 'function') {
          console.warn(`Autoplay appears blocked for ${videoId} (state ${state}). Retrying via playVideo().`);
          player.playVideo();
        }
      } catch (e) {}
    }, 2000);
  }

  /**
   * Find the next index in the queue whose video isn't flagged dead, starting
   * at startIndex (inclusive). Falls back to startIndex if every video in the
   * queue is currently quarantined, rather than looping forever.
   */
  findNextLiveIndex(startIndex) {
    const len = this.queue.length;
    if (len === 0) return 0;
    for (let step = 0; step < len; step++) {
      const idx = (startIndex + step) % len;
      if (!catalogManager.deadVideoIds.has(this.queue[idx].videoId)) {
        return idx;
      }
    }
    console.warn("Every video in the current queue is flagged dead. Playing anyway.");
    return startIndex;
  }

  /**
   * Calculate smart clip duration and start offset based on category
   */
  calculateSmartClip(videoItem) {
    if (!videoItem) return { startSec: 0, maxDurationSec: 90 };

    const isCommercial = (videoItem.category || '').toLowerCase() === 'commercials';
    let baseMaxDurationSec = isCommercial ? this.commercialMaxSec : this.generalClipMaxSec;
    let startSec = videoItem.startSec || 0;

    // Organic clip duration variance (+/- 15s) for dynamic TV pacing
    let maxDurationSec = baseMaxDurationSec;
    if (!isCommercial) {
      const variance = Math.floor(Math.random() * 30) - 15;
      maxDurationSec = Math.max(25, baseMaxDurationSec + variance);
    }

    // Random highlights jump for non-commercials (start between 15s and 120s)
    if (!isCommercial && this.randomOffsetEnabled && startSec === 0) {
      startSec = Math.floor(Math.random() * 105) + 15;
    }

    return { startSec, maxDurationSec };
  }

  /**
   * Advance to next video in queue with CRT channel static glitch
   */
  nextVideo() {
    if (!this.queue || this.queue.length === 0) return;

    this.clearClipTimer();

    // Trigger CRT Static Transition
    effectsEngine.triggerChannelSwitch(250, () => {
      // Swap active player container focus
      this.toggleActivePlayerFocus();

      // Advance to the next live (non-quarantined) queue index
      this.currentIndex = this.findNextLiveIndex((this.currentIndex + 1) % this.queue.length);

      // Play next video on the newly active player
      this.playCurrentVideo();
    });
  }

  /**
   * Toggle CSS focus between Player A and Player B
   */
  toggleActivePlayerFocus() {
    const containerA = document.getElementById('iframe-a-container');
    const containerB = document.getElementById('iframe-b-container');

    if (this.activePlayerId === 'A') {
      this.activePlayerId = 'B';
      if (containerA) containerA.className = 'player-iframe-container inactive-player';
      if (containerB) containerB.className = 'player-iframe-container active-player';
    } else {
      this.activePlayerId = 'A';
      if (containerB) containerB.className = 'player-iframe-container inactive-player';
      if (containerA) containerA.className = 'player-iframe-container active-player';
    }
  }

  getActivePlayer() {
    return this.activePlayerId === 'A' ? this.playerA : this.playerB;
  }

  getInactivePlayer() {
    return this.activePlayerId === 'A' ? this.playerB : this.playerA;
  }

  handlePlayerStateChange(playerId, event) {
    // YT.PlayerState.ENDED = 0
    if (event.data === 0 && playerId === this.activePlayerId) {
      this.nextVideo();
    }
  }

  /**
   * Auto-skip unavailable, private, or non-embeddable YouTube videos.
   * Quarantines whichever video actually errored (active or preloading)
   * so it's excluded from the queue immediately, not just on the next
   * full rotation.
   */
  handlePlayerError(playerId, event) {
    const erroredItem = this.cuedItems[playerId];
    if (erroredItem) {
      catalogManager.markVideoDead(erroredItem.videoId, erroredItem.title);
    }

    // Errors from the inactive background preloader: just re-cue a live
    // replacement, no need to disrupt what's currently on screen.
    if (playerId !== this.activePlayerId) {
      console.warn(`Preloader player ${playerId} hit an unplayable video (error ${event.data}). Re-cueing replacement.`);
      this.preloadNext();
      return;
    }

    this.consecutiveErrorCount++;
    console.warn(`Active player error (${event.data}). Consecutive error count: ${this.consecutiveErrorCount}`);

    // If 3 consecutive errors occur, fast-forward 5 live steps ahead in queue without static glitch
    if (this.consecutiveErrorCount >= 3) {
      console.warn("Multiple consecutive video errors. Fast-forwarding queue...");
      this.consecutiveErrorCount = 0;
      this.currentIndex = this.findNextLiveIndex((this.currentIndex + 5) % this.queue.length);
      this.toggleActivePlayerFocus();
      this.playCurrentVideo();
      return;
    }

    // INSTANTLY advance to next working video with 0ms delay
    this.nextVideo();
  }

  /**
   * Clip Timer Monitor
   */
  startClipTimer() {
    this.clearClipTimer();

    this.clipTimer = setInterval(() => {
      this.elapsedSeconds++;

      if (this.onProgressCallback) {
        this.onProgressCallback({
          elapsed: this.elapsedSeconds,
          cutoff: this.activeCutoffSec,
          currentVideo: this.currentVideoItem
        });
      }

      // Query live player duration and current position
      const activePlayer = this.getActivePlayer();
      let duration = 0;
      let currentTime = 0;
      try {
        if (activePlayer && typeof activePlayer.getDuration === 'function') {
          duration = activePlayer.getDuration();
        }
        if (activePlayer && typeof activePlayer.getCurrentTime === 'function') {
          currentTime = activePlayer.getCurrentTime();
        }
      } catch (e) {}

      // Auto-next if elapsed reaches cutoff OR if video is within 1.5s of ending
      const isCutoff = this.activeCutoffSec > 0 && this.elapsedSeconds >= this.activeCutoffSec;
      const isNearEnd = duration > 0 && currentTime > 0 && (duration - currentTime <= 1.5);

      if (isCutoff || isNearEnd) {
        console.log(`Auto-advancing stream (Cutoff: ${isCutoff}, NearEnd: ${isNearEnd})...`);
        this.nextVideo();
      }
    }, 1000);
  }

  clearClipTimer() {
    if (this.clipTimer) {
      clearInterval(this.clipTimer);
      this.clipTimer = null;
    }
  }

  /**
   * Update OSD HUD Labels
   */
  /**
   * Update OSD HUD Labels
   */
  updateOSD(videoItem) {
    const hud = document.getElementById('osd-hud');
    if (!hud) return;

    const admin = window.adminController;
    const osdMode = admin ? admin.osdMode : (localStorage.getItem('bnsd_osd_mode') || 'crt-header');
    hud.setAttribute('data-osd-mode', osdMode);

    if (osdMode === 'hidden') {
      hud.classList.add('hidden');
      return;
    }

    hud.classList.remove('hidden');

    const catLabel = document.getElementById('osd-category-label');
    const titleLabel = document.getElementById('osd-title-label');
    const eraLabel = document.getElementById('osd-era-badge');
    const channelLabel = document.getElementById('osd-channel-label');

    const chNum = admin ? admin.getChannelNum(admin.currentChannelId) : '03';

    if (osdMode === 'vcr-watermark') {
      if (channelLabel) channelLabel.textContent = 'BNSD TV';
      if (eraLabel) eraLabel.textContent = 'PLAY ►';
    } else {
      if (channelLabel) channelLabel.textContent = `CH ${chNum} • BNSD TV`;
      if (eraLabel) eraLabel.textContent = videoItem?.decade || '1990s';
    }

    if (catLabel) catLabel.textContent = (videoItem?.category || 'VINTAGE STREAM').toUpperCase();
    if (titleLabel) titleLabel.textContent = videoItem?.title || 'BNSD TV Stream';
  }

  updatePacingRules(commercialMax, generalMax, randomOffset) {
    this.commercialMaxSec = commercialMax;
    this.generalClipMaxSec = generalMax;
    this.randomOffsetEnabled = randomOffset;
  }
}

export const playerEngine = new PlayerEngine();
