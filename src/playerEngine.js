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

    // Config Rules & Pacing Modes
    this.pacingMode = 'channel-surfer'; // 'channel-surfer' | 'balanced' | 'deep-cuts'
    this.commercialMaxSec = 30;
    this.generalClipMaxSec = 60;
    this.randomOffsetEnabled = true;
    this.zapBurstEnabled = true;

    // Surfing Zap Burst Engine (simulates quick remote clicks)
    this.zapBurstRemaining = 0;
    this.clipsSinceLastBurst = 0;
    this.burstInterval = Math.floor(Math.random() * 3) + 5; // next burst in 5 to 7 clips

    // State Tracking
    this.currentVideoItem = null;
    this.clipTimer = null;
    this.elapsedSeconds = 0;
    this.activeCutoffSec = 30;
    this.isZapClip = false;
    this.onProgressCallback = null;
  }

  /**
   * Initialize YouTube iFrame API with queue and start index
   */
  init(queueOrCb, startIndexOrCb, onReadyCallback) {
    let cb = onReadyCallback;
    if (typeof queueOrCb === 'function') {
      cb = queueOrCb;
    } else if (Array.isArray(queueOrCb)) {
      this.queue = queueOrCb;
      this.currentIndex = typeof startIndexOrCb === 'number' ? startIndexOrCb : 0;
      if (this.queue.length > 0) {
        this.currentIndex = this.findNextLiveIndex(this.currentIndex);
        this.currentVideoItem = this.queue[this.currentIndex];
        this.cuedItems['A'] = this.currentVideoItem;
      }
    }

    if (window.YT && window.YT.Player) {
      this.createPlayers(cb);
      return;
    }

    // Load YouTube API script
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

    window.onYouTubeIframeAPIReady = () => {
      this.createPlayers(cb);
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

    // Guarantee stream starts within 400ms fallback
    setTimeout(() => {
      fireCallback();
    }, 400);

    const defaultPlayerVars = {
      autoplay: 1,
      controls: 0,
      cc_load_policy: 0,
      cc_lang_pref: 'none',
      iv_load_policy: 3,
      modestbranding: 1,
      rel: 0,
      playsinline: 1,
      disablekb: 1,
      fs: 0,
      origin: window.location.origin,
      enablejsapi: 1
    };

    let videoIdA = undefined;
    let startSecA = 0;
    let videoIdB = undefined;
    let startSecB = 0;

    if (this.queue && this.queue.length > 0) {
      this.currentIndex = this.findNextLiveIndex(this.currentIndex);
      this.currentVideoItem = this.queue[this.currentIndex];
      this.cuedItems['A'] = this.currentVideoItem;
      if (this.currentVideoItem) {
        videoIdA = this.currentVideoItem.videoId;
        const clipA = this.calculateSmartClip(this.currentVideoItem);
        startSecA = clipA.startSec;
        this.activeCutoffSec = clipA.maxDurationSec;
      }

      const nextIndex = this.findNextLiveIndex((this.currentIndex + 1) % this.queue.length);
      const nextItem = this.queue[nextIndex];
      this.cuedItems['B'] = nextItem;
      if (nextItem) {
        videoIdB = nextItem.videoId;
        const clipB = this.calculateSmartClip(nextItem);
        startSecB = clipB.startSec;
      }
    }

    this.playerA = new window.YT.Player('player-a', {
      width: '100%',
      height: '100%',
      videoId: videoIdA,
      playerVars: {
        ...defaultPlayerVars,
        start: startSecA
      },
      events: {
        onReady: (e) => {
          try {
            e.target.mute();
            this.disableCaptions(e.target);
            if (this.activePlayerId === 'A') {
              e.target.playVideo();
            }
          } catch (err) {}
          checkReady();
        },
        onStateChange: (e) => this.handlePlayerStateChange('A', e),
        onError: (e) => this.handlePlayerError('A', e)
      }
    });

    this.playerB = new window.YT.Player('player-b', {
      width: '100%',
      height: '100%',
      videoId: videoIdB,
      playerVars: {
        ...defaultPlayerVars,
        start: startSecB
      },
      events: {
        onReady: (e) => {
          try {
            e.target.mute();
            this.disableCaptions(e.target);
          } catch (err) {}
          checkReady();
        },
        onStateChange: (e) => this.handlePlayerStateChange('B', e),
        onError: (e) => this.handlePlayerError('B', e)
      }
    });
  }

  /**
   * Unload YouTube closed captions module cleanly without triggering player UI overlay
   */
  disableCaptions(player) {
    if (!player) return;
    try {
      if (typeof player.unloadModule === 'function') {
        player.unloadModule('captions');
        player.unloadModule('cc');
      }
    } catch (e) {}
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

    // Load active video on active player using idiomatic object parameters
    if (activePlayer && typeof activePlayer.loadVideoById === 'function') {
      try {
        activePlayer.loadVideoById({
          videoId: this.currentVideoItem.videoId,
          startSeconds: startSec
        });
        activePlayer.mute();
        this.disableCaptions(activePlayer);
        this.scheduleAutoplayFallback(activePlayer, this.currentVideoItem.videoId);
      } catch (e) {
        console.warn("loadVideoById error:", e);
      }
    }

    // Update OSD green HUD display
    this.updateOSD(this.currentVideoItem);

    // Preload NEXT video on inactive player
    this.preloadNext();

    // Start clip timing monitor
    this.startClipTimer();
  }

  /**
   * Cue the next live (non-quarantined) video on the currently inactive player using idiomatic object parameters
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
        inactivePlayer.cueVideoById({
          videoId: nextItem.videoId,
          startSeconds: nextClip.startSec
        });
        inactivePlayer.mute();
        this.disableCaptions(inactivePlayer);
      } catch (e) {
        console.warn("cueVideoById error:", e);
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
   * Calculate smart clip duration and start offset based on category and visual pacing mode.
   * Tailored specifically for silent visual projection (jumps past slow title cards & spoken intros).
   */
  calculateSmartClip(videoItem) {
    if (!videoItem) return { startSec: 0, maxDurationSec: 30 };

    const cat = (videoItem.category || '').toLowerCase();
    let startSec = videoItem.startSec || 0;
    let maxDurationSec = 30;

    // 1. Check if currently in a rapid "Zap Burst" (simulates fast channel surfing)
    if (this.zapBurstEnabled && this.zapBurstRemaining > 0) {
      this.isZapClip = true;
      this.zapBurstRemaining--;
      // Zap clips are ultra-punchy: 6 to 10 seconds
      maxDurationSec = Math.floor(Math.random() * 5) + 6;
      if (this.randomOffsetEnabled && startSec === 0) {
        startSec = this.getSmartVisualSeekOffset(cat);
      }
      return { startSec, maxDurationSec };
    }

    this.isZapClip = false;

    // 2. Schedule next Zap Burst interval
    if (this.zapBurstEnabled) {
      this.clipsSinceLastBurst++;
      if (this.clipsSinceLastBurst >= this.burstInterval) {
        this.clipsSinceLastBurst = 0;
        this.burstInterval = Math.floor(Math.random() * 4) + 5; // next burst in 5 to 8 clips
        this.zapBurstRemaining = Math.floor(Math.random() * 2) + 2; // 2 to 3 rapid zap clips
      }
    }

    // 3. Category-specific durations and smart visual seek offsets
    const mode = this.pacingMode || 'channel-surfer';

    if (cat === 'commercials') {
      // Commercials: 15-25s in surfer, 20-30s in balanced, 30-45s in deep-cuts
      if (mode === 'channel-surfer') maxDurationSec = Math.floor(Math.random() * 11) + 15;
      else if (mode === 'balanced') maxDurationSec = Math.floor(Math.random() * 11) + 20;
      else maxDurationSec = Math.floor(Math.random() * 16) + 30;

      // Commercials start at 0s for immediate visual hook
      if (startSec === 0) startSec = 0;
    } else if (cat === 'music') {
      // Music: Needs time for beat, choreography, and visual concept
      if (mode === 'channel-surfer') maxDurationSec = Math.floor(Math.random() * 16) + 28; // 28-43s
      else if (mode === 'balanced') maxDurationSec = Math.floor(Math.random() * 21) + 38; // 38-58s
      else maxDurationSec = Math.floor(Math.random() * 26) + 50; // 50-75s

      // MUSIC VISUAL SEEK: Jump 30s to 90s to bypass MTV title cards and spoken intros
      if (this.randomOffsetEnabled && startSec === 0) {
        startSec = Math.floor(Math.random() * 61) + 30; // 30s to 90s
      }
    } else if (cat === 'cartoons' || cat === 'kids') {
      // Cartoons / Kids: High visual kinetic energy
      if (mode === 'channel-surfer') maxDurationSec = Math.floor(Math.random() * 16) + 20; // 20-35s
      else if (mode === 'balanced') maxDurationSec = Math.floor(Math.random() * 21) + 30; // 30-50s
      else maxDurationSec = Math.floor(Math.random() * 26) + 45; // 45-70s

      // CARTOON VISUAL SEEK: 25% chance theme song (0s), 75% chance jump 45s-200s into slapstick
      if (this.randomOffsetEnabled && startSec === 0) {
        if (Math.random() < 0.25) {
          startSec = 0;
        } else {
          startSec = Math.floor(Math.random() * 156) + 45; // 45s to 200s
        }
      }
    } else if (cat === 'trailers') {
      // Trailers: Fast cuts, high visual drama
      if (mode === 'channel-surfer') maxDurationSec = Math.floor(Math.random() * 16) + 18; // 18-33s
      else if (mode === 'balanced') maxDurationSec = Math.floor(Math.random() * 16) + 25; // 25-40s
      else maxDurationSec = Math.floor(Math.random() * 21) + 35; // 35-55s

      // Start at 0s-4s to catch title cards / opening VO
      if (startSec === 0) startSec = Math.floor(Math.random() * 4);
    } else if (cat === 'sports') {
      // Sports / Action: Dunks, wrestling slams, extreme sports
      if (mode === 'channel-surfer') maxDurationSec = Math.floor(Math.random() * 16) + 16; // 16-31s
      else if (mode === 'balanced') maxDurationSec = Math.floor(Math.random() * 16) + 24; // 24-39s
      else maxDurationSec = Math.floor(Math.random() * 21) + 35; // 35-55s

      // Jump straight into action highlight (60s to 300s)
      if (this.randomOffsetEnabled && startSec === 0) {
        startSec = Math.floor(Math.random() * 241) + 60;
      }
    } else if (cat === 'gameshows' || cat === 'talkshows' || cat === 'soaps') {
      // In silent projection, keep talking heads short & punchy
      if (mode === 'channel-surfer') maxDurationSec = Math.floor(Math.random() * 9) + 12; // 12-20s
      else if (mode === 'balanced') maxDurationSec = Math.floor(Math.random() * 11) + 18; // 18-28s
      else maxDurationSec = Math.floor(Math.random() * 16) + 25; // 25-40s

      if (this.randomOffsetEnabled && startSec === 0) {
        startSec = Math.floor(Math.random() * 151) + 45; // 45s to 195s
      }
    } else {
      // Comedy, Movies, Drama, Specials, Other
      if (mode === 'channel-surfer') maxDurationSec = Math.floor(Math.random() * 16) + 20; // 20-35s
      else if (mode === 'balanced') maxDurationSec = Math.floor(Math.random() * 16) + 28; // 28-43s
      else maxDurationSec = Math.floor(Math.random() * 21) + 40; // 40-60s

      if (this.randomOffsetEnabled && startSec === 0) {
        startSec = Math.floor(Math.random() * 181) + 60; // 60s to 240s
      }
    }

    // Apply manual user caps if set in admin
    if (this.generalClipMaxSec && cat !== 'commercials') {
      maxDurationSec = Math.min(maxDurationSec, this.generalClipMaxSec);
    }
    if (this.commercialMaxSec && cat === 'commercials') {
      maxDurationSec = Math.min(maxDurationSec, this.commercialMaxSec);
    }

    return { startSec, maxDurationSec };
  }

  /**
   * Helper for instant visual action seek offset
   */
  getSmartVisualSeekOffset(cat) {
    if (cat === 'commercials' || cat === 'trailers') return 0;
    if (cat === 'music') return Math.floor(Math.random() * 61) + 30; // 30-90s
    if (cat === 'cartoons' || cat === 'kids') return Math.floor(Math.random() * 156) + 45; // 45-200s
    if (cat === 'sports') return Math.floor(Math.random() * 241) + 60; // 60-300s
    return Math.floor(Math.random() * 181) + 60; // 60-240s
  }

  /**
   * Advance to next video in queue with CRT channel static glitch.
   * Automatically uses faster static burst for rapid zap clips.
   */
  nextVideo() {
    if (!this.queue || this.queue.length === 0) return;

    this.clearClipTimer();

    // Fast 160ms static during rapid zap bursts vs 250ms normal static
    const staticDuration = this.zapBurstRemaining > 0 || this.isZapClip ? 160 : 250;

    effectsEngine.triggerChannelSwitch(staticDuration, () => {
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
    const player = playerId === 'A' ? this.playerA : this.playerB;

    if (event.data === 1) { // PLAYING
      this.disableCaptions(player);
    }

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
    const errorDescriptions = {
      2: 'Invalid Video ID parameter',
      5: 'HTML5 player playback error',
      100: 'Video not found (removed or private)',
      101: 'Playback not allowed by owner in embedded players',
      150: 'Playback not allowed by owner in embedded players'
    };
    const errorCode = event?.data;
    const reason = errorDescriptions[errorCode] || `Error Code ${errorCode}`;

    const erroredItem = this.cuedItems[playerId];
    if (erroredItem) {
      catalogManager.markVideoDead(erroredItem.videoId, erroredItem.title);
    }

    // Errors from the inactive background preloader: just re-cue a live
    // replacement, no need to disrupt what's currently on screen.
    if (playerId !== this.activePlayerId) {
      console.warn(`Preloader player ${playerId} hit an unplayable video (${reason}): ${erroredItem?.videoId || 'unknown'}. Re-cueing replacement.`);
      this.preloadNext();
      return;
    }

    this.consecutiveErrorCount++;
    console.warn(`Active player error (${reason}): ${erroredItem?.videoId || 'unknown'}. Consecutive error count: ${this.consecutiveErrorCount}`);

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
   * Cleanly destroy YouTube players to prevent memory leaks in kiosk mode
   */
  destroy() {
    this.clearClipTimer();
    clearTimeout(this.autoplayFallbackTimeout);

    try {
      if (this.playerA && typeof this.playerA.destroy === 'function') {
        this.playerA.destroy();
      }
      if (this.playerB && typeof this.playerB.destroy === 'function') {
        this.playerB.destroy();
      }
    } catch (e) {}

    this.playerA = null;
    this.playerB = null;
    this.isApiReady = false;
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
    const eraLabel = document.getElementById('osd-era-badge');
    const channelLabel = document.getElementById('osd-channel-label');

    const chNum = admin ? admin.getChannelNum(admin.currentChannelId) : '03';

    if (osdMode === 'vcr-watermark') {
      if (channelLabel) channelLabel.textContent = 'BNSD TV';
      if (eraLabel) eraLabel.textContent = this.isZapClip ? '⚡ ZAP ►' : 'PLAY ►';
    } else {
      if (channelLabel) channelLabel.textContent = `CH ${chNum} • BNSD TV`;
      if (eraLabel) eraLabel.textContent = this.isZapClip ? `⚡ ${videoItem?.decade || '1990s'}` : (videoItem?.decade || '1990s');
    }

    if (catLabel) {
      const catText = (videoItem?.category || 'RETRO TV').toUpperCase();
      catLabel.textContent = this.isZapClip ? `⚡ ${catText}` : catText;
    }
  }

  updatePacingRules(commercialMax, generalMax, randomOffset, pacingMode = 'channel-surfer', zapBurstEnabled = true) {
    this.commercialMaxSec = commercialMax;
    this.generalClipMaxSec = generalMax;
    this.randomOffsetEnabled = randomOffset;
    this.pacingMode = pacingMode;
    this.zapBurstEnabled = zapBurstEnabled;
  }
}

export const playerEngine = new PlayerEngine();
