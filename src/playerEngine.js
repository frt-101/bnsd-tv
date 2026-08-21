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

    // Human Remote Surfing Engine (Authentic Psychological Session State Machine)
    // Sessions cycle naturally: 'browse_flurry' (2-4 fast clicks) -> 'curious_glance' (15-30s) -> 'settle_in' (45-85s)
    this.currentSessionType = 'settle_in';
    this.sessionClipsRemaining = 1;

    // State Tracking
    this.currentVideoItem = null;
    this.clipTimer = null;
    this.elapsedSeconds = 0;
    this.activeCutoffSec = 30;
    this.isZapClip = false;
    this.hasPreloadedForCurrentClip = false;
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
      mute: 1,
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
        onReady: () => checkReady(),
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
        onReady: () => checkReady(),
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
    this.currentIndex = this.findNextLiveIndex(this.currentIndex);

    this.currentVideoItem = this.queue[this.currentIndex];
    this.cuedItems[this.activePlayerId] = this.currentVideoItem;
    this.lastAdvanceAt = Date.now();
    const activePlayer = this.getActivePlayer();

    // Determine smart clip duration and start offset
    const { startSec, maxDurationSec } = this.calculateSmartClip(this.currentVideoItem);
    this.activeCutoffSec = maxDurationSec;
    this.elapsedSeconds = 0;
    this.hasPreloadedForCurrentClip = false;

    // Load active video on active player purely via API
    if (activePlayer && typeof activePlayer.loadVideoById === 'function') {
      try {
        activePlayer.loadVideoById({
          videoId: this.currentVideoItem.videoId,
          startSeconds: startSec
        });
      } catch (e) {
        console.warn("loadVideoById error:", e);
      }
    }

    // Update OSD green HUD display
    this.updateOSD(this.currentVideoItem);

    // If initial clip is short (<= 10s), preload next video immediately
    if (this.activeCutoffSec <= 10) {
      this.hasPreloadedForCurrentClip = true;
      this.preloadNext();
    }

    // Start clip timing monitor
    this.startClipTimer();
  }

  /**
   * Preload and start the next video on the hidden inactive player in the background (opacity: 0).
   * Because it starts playing in the dark, all loading/buffering and pause overlays are invisible.
   */
  preloadNext() {
    if (!this.queue || this.queue.length === 0) return;

    const inactivePlayer = this.getInactivePlayer();
    const inactivePlayerId = this.activePlayerId === 'A' ? 'B' : 'A';
    const nextIndex = this.findNextLiveIndex((this.currentIndex + 1) % this.queue.length);
    const nextItem = this.queue[nextIndex];
    if (!nextItem) return;

    this.cuedItems[inactivePlayerId] = nextItem;
    this.preloadedAt = Date.now();
    const nextClip = this.calculateSmartClip(nextItem);

    if (inactivePlayer && typeof inactivePlayer.loadVideoById === 'function') {
      try {
        inactivePlayer.loadVideoById({
          videoId: nextItem.videoId,
          startSeconds: nextClip.startSec
        });
      } catch (e) {
        console.warn("preload loadVideoById error:", e);
      }
    }
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
   * Calculate smart clip duration and start offset based on human channel-surfing behavior clusters.
   * Alternates naturally between:
   * 1. Rapid remote "flurry" clicks (5s to 9s) - "searching"
   * 2. Curious glances (18s to 32s) - "hooked"
   * 3. Settle-in deeper watches (45s to 85s) - "immersed"
   */
  calculateSmartClip(videoItem) {
    if (!videoItem) return { startSec: 0, maxDurationSec: 30 };

    const cat = (videoItem.category || '').toLowerCase();
    let startSec = videoItem.startSec || 0;
    let maxDurationSec = 30;

    // 1. Advance or establish the Human Surfing Session state
    if (this.sessionClipsRemaining <= 0) {
      this.pickNextSurfingSession();
    }
    this.sessionClipsRemaining--;

    // 2. Mode-based pacing multipliers
    const mode = this.pacingMode || 'channel-surfer';
    const isDeepCuts = mode === 'deep-cuts';
    const isBalanced = mode === 'balanced';

    // 3. Derive duration based on current session mood and video category
    if (this.currentSessionType === 'browse_flurry' && this.zapBurstEnabled) {
      this.isZapClip = true;
      // Quick remote clicks: 5 to 9 seconds
      maxDurationSec = Math.floor(Math.random() * 5) + 5;
      if (this.randomOffsetEnabled && startSec === 0) {
        startSec = this.getSmartVisualSeekOffset(cat);
      }
      return { startSec, maxDurationSec };
    }

    this.isZapClip = false;

    if (this.currentSessionType === 'curious_glance') {
      // 18 to 35 seconds - catch the hook / chorus / commercial punchline
      if (cat === 'commercials') {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 11) + 25 : Math.floor(Math.random() * 11) + 16; // 16-27s
        if (startSec === 0) startSec = 0;
      } else if (cat === 'music') {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 16) + 35 : Math.floor(Math.random() * 11) + 26; // 26-37s
        if (this.randomOffsetEnabled && startSec === 0) startSec = Math.floor(Math.random() * 51) + 30;
      } else if (cat === 'cartoons' || cat === 'kids') {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 16) + 30 : Math.floor(Math.random() * 11) + 20; // 20-31s
        if (this.randomOffsetEnabled && startSec === 0) startSec = Math.floor(Math.random() * 121) + 30;
      } else {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 16) + 30 : Math.floor(Math.random() * 11) + 20; // 20-31s
        if (this.randomOffsetEnabled && startSec === 0) startSec = Math.floor(Math.random() * 121) + 45;
      }
    } else {
      // 'settle_in' session: 45 to 85 seconds - deep nostalgic immersion
      if (cat === 'commercials') {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 16) + 30 : Math.floor(Math.random() * 11) + 22; // 22-33s
        if (startSec === 0) startSec = 0;
      } else if (cat === 'music') {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 26) + 65 : (isBalanced ? Math.floor(Math.random() * 21) + 48 : Math.floor(Math.random() * 21) + 40); // 40-69s
        if (this.randomOffsetEnabled && startSec === 0) startSec = Math.floor(Math.random() * 61) + 30;
      } else if (cat === 'cartoons' || cat === 'kids') {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 26) + 55 : (isBalanced ? Math.floor(Math.random() * 21) + 40 : Math.floor(Math.random() * 16) + 35); // 35-51s
        if (this.randomOffsetEnabled && startSec === 0) startSec = Math.random() < 0.25 ? 0 : Math.floor(Math.random() * 156) + 45;
      } else {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 26) + 60 : (isBalanced ? Math.floor(Math.random() * 21) + 45 : Math.floor(Math.random() * 16) + 35); // 35-51s
        if (this.randomOffsetEnabled && startSec === 0) startSec = Math.floor(Math.random() * 181) + 60;
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
   * Select next human surfing session mood based on natural psychological arcs
   */
  pickNextSurfingSession() {
    const lastSession = this.currentSessionType;

    if (lastSession === 'browse_flurry') {
      // After a quick click flurry, human ALWAYS stops on something: 60% settle in, 40% glance
      if (Math.random() < 0.6) {
        this.currentSessionType = 'settle_in';
        this.sessionClipsRemaining = 1;
      } else {
        this.currentSessionType = 'curious_glance';
        this.sessionClipsRemaining = Math.floor(Math.random() * 2) + 1; // 1-2 clips
      }
    } else if (lastSession === 'settle_in') {
      // After watching a long segment, 40% browse flurry, 60% curious glance
      if (Math.random() < 0.40 && this.zapBurstEnabled) {
        this.currentSessionType = 'browse_flurry';
        this.sessionClipsRemaining = Math.floor(Math.random() * 3) + 2; // 2 to 4 rapid clicks
      } else {
        this.currentSessionType = 'curious_glance';
        this.sessionClipsRemaining = Math.floor(Math.random() * 2) + 1;
      }
    } else {
      // After a curious glance: 50% settle in, 30% browse flurry, 20% another glance
      const rand = Math.random();
      if (rand < 0.50) {
        this.currentSessionType = 'settle_in';
        this.sessionClipsRemaining = 1;
      } else if (rand < 0.80 && this.zapBurstEnabled) {
        this.currentSessionType = 'browse_flurry';
        this.sessionClipsRemaining = Math.floor(Math.random() * 2) + 2; // 2-3 clicks
      } else {
        this.currentSessionType = 'curious_glance';
        this.sessionClipsRemaining = 1;
      }
    }
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
   * Seamlessly reveals the already-playing background player with zero pause or loading overlay.
   */
  nextVideo() {
    if (!this.queue || this.queue.length === 0) return;

    this.clearClipTimer();

    // Fast 140ms static during rapid browse flurries vs 240ms normal static
    const staticDuration = this.isZapClip || this.currentSessionType === 'browse_flurry' ? 140 : 240;

    effectsEngine.triggerChannelSwitch(staticDuration, () => {
      // 1. Swap active player container focus (brings already-running background player to front)
      this.toggleActivePlayerFocus();

      // 2. Advance to the next live queue index
      this.currentIndex = this.findNextLiveIndex((this.currentIndex + 1) % this.queue.length);
      this.currentVideoItem = this.queue[this.currentIndex];
      this.cuedItems[this.activePlayerId] = this.currentVideoItem;
      this.lastAdvanceAt = Date.now();

      // 3. Set cutoff duration for this newly active video
      const { maxDurationSec } = this.calculateSmartClip(this.currentVideoItem);
      this.activeCutoffSec = maxDurationSec;
      this.elapsedSeconds = 0;
      this.hasPreloadedForCurrentClip = false;

      // 4. Update OSD green HUD display
      this.updateOSD(this.currentVideoItem);

      // 5. Start clip timing monitor
      this.startClipTimer();

      // 6. If clip is ultra-short (<= 5s), preload next video immediately
      if (this.activeCutoffSec <= 5) {
        this.hasPreloadedForCurrentClip = true;
        this.preloadNext();
      }
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

      // JIT background pre-loading: start background player 6s before channel switch
      // so YouTube's 5.0-second startup bezel expires 100% in the dark!
      const leadTime = 6;
      if (this.elapsedSeconds >= Math.max(1, this.activeCutoffSec - leadTime) && !this.hasPreloadedForCurrentClip) {
        this.hasPreloadedForCurrentClip = true;
        this.preloadNext();
      }

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
    const channelLabel = document.getElementById('osd-channel-label');

    const chNum = admin ? admin.getChannelNum(admin.currentChannelId) : '03';

    if (osdMode === 'vcr-watermark') {
      if (channelLabel) channelLabel.textContent = this.isZapClip ? 'BNSD TV ⚡' : 'BNSD TV';
    } else {
      if (channelLabel) channelLabel.textContent = this.isZapClip ? `CH ${chNum} • BNSD TV ⚡` : `CH ${chNum} • BNSD TV`;
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
