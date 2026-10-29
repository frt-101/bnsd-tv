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
    this.isTransitioning = false;

    // Watchdog support: timestamp of the last successful channel change, and
    // the pending autoplay-retry timer for whatever's currently loading.
    this.lastAdvanceAt = null;
    this.autoplayFallbackTimeout = null;

    // Tracks which video object is actually loaded/cued on each physical player,
    // so error handling can identify and quarantine the right video regardless
    // of which player (active or preloading) reported the error.
    this.cuedItems = { A: null, B: null };
    this.deliberatelyPaused = { A: false, B: false };

    // Per-player continuous PLAYING tracking to verify YouTube's ~4.4s startup
    // Play/Pause center modal (.new-controls.fadein) has 100% faded to opacity 0
    // before any stream is ever revealed on screen.
    this.playingSince = { A: 0, B: 0 };
    this.playStartVideoTime = { A: 0, B: 0 };
    this.clampedSeekDone = { A: false, B: false };
    this.intendedStartSec = { A: 0, B: 0 };
    this.preloadedQueueIndex = null;

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
    this.currentChannelNumber = 3;
    this.currentVideoItem = null;
    this.clipTimer = null;
    this.elapsedSeconds = 0;
    this.activeCutoffSec = 30;
    this.isZapClip = false;
    this.hasPreloadedForCurrentClip = false;
    this.onProgressCallback = null;

    // calculateSmartClip() both rolls a random duration AND advances the
    // human-surfing session state machine (sessionClipsRemaining--). Every
    // video is run through it once when it's preloaded (to get its startSec)
    // and again once it becomes current (to get its on-screen cutoff) --
    // without this cache those were two separate calls, silently burning two
    // session "ticks" per video actually shown instead of one, so a
    // browse_flurry configured for e.g. 3 rapid clicks only ever showed
    // ~1.5 of them before the mood flipped. This caches the duration rolled
    // at preload time so activation reuses it instead of rerolling.
    this.pendingClipCache = new Map(); // videoId -> maxDurationSec
  }

  /**
   * Cache the duration calculateSmartClip() rolled for a video at preload
   * time, so the same video's activation later reuses it instead of calling
   * calculateSmartClip() (and its session-state side effects) a second time.
   */
  cachePendingClipDuration(videoItem, maxDurationSec) {
    if (!videoItem) return;
    this.pendingClipCache.set(videoItem.videoId, maxDurationSec);
  }

  /**
   * Consume (and remove) a cached preload-time duration for this video, if
   * one exists. Returns null if there's no cached value, so callers can fall
   * back to a fresh calculateSmartClip() call.
   */
  consumePendingClipDuration(videoItem) {
    if (!videoItem || !this.pendingClipCache.has(videoItem.videoId)) return null;
    const maxDurationSec = this.pendingClipCache.get(videoItem.videoId);
    this.pendingClipCache.delete(videoItem.videoId);
    return maxDurationSec;
  }

  /**
   * Initialize YouTube iFrame API with queue and start index
   */
  init(queueOrCb, startIndexOrCb, onReadyCallback) {
    window.playerEngine = this;
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
        this.intendedStartSec['A'] = startSecA;
        this.clampedSeekDone['A'] = false;
        this.cachePendingClipDuration(this.currentVideoItem, clipA.maxDurationSec);
      }

      // Only pre-roll Player B at t=0 if the initial clip is short (<= 15s);
      // otherwise let startClipTimer() trigger preloadNext() 10s before cutoff
      // so Player B doesn't play through an entire commercial in the dark before reveal.
      if (this.activeCutoffSec <= 15) {
        const nextIndex = this.findNextLiveIndex((this.currentIndex + 1) % this.queue.length);
        const nextItem = this.queue[nextIndex];
        this.cuedItems['B'] = nextItem;
        this.preloadedQueueIndex = nextIndex;
        if (nextItem) {
          videoIdB = nextItem.videoId;
          const clipB = this.calculateSmartClip(nextItem);
          startSecB = clipB.startSec;
          this.intendedStartSec['B'] = startSecB;
          this.clampedSeekDone['B'] = false;
          this.cachePendingClipDuration(nextItem, clipB.maxDurationSec);
        }
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
            if (typeof e.target.mute === 'function') e.target.mute();
            this.suppressCaptions(e.target);
            if (this.activePlayerId === 'A') {
              e.target.playVideo();
            }
          } catch (err) {}
          checkReady();
        },
        onApiChange: (e) => this.suppressCaptions(e.target),
        onStateChange: (e) => this.handlePlayerStateChange('A', e),
        onError: (e) => this.handlePlayerError('A', e)
      }
    });

    const playerBConfig = {
      width: '100%',
      height: '100%',
      playerVars: {
        ...defaultPlayerVars,
        ...(videoIdB ? { start: startSecB } : {})
      },
      events: {
        onReady: (e) => {
          try {
            if (typeof e.target.mute === 'function') e.target.mute();
            this.suppressCaptions(e.target);
            if (this.activePlayerId === 'B' || videoIdB) {
              e.target.playVideo();
            }
          } catch (err) {}
          checkReady();
        },
        onApiChange: (e) => this.suppressCaptions(e.target),
        onStateChange: (e) => this.handlePlayerStateChange('B', e),
        onError: (e) => this.handlePlayerError('B', e)
      }
    };
    if (videoIdB) {
      playerBConfig.videoId = videoIdB;
      this.preloadedAt = Date.now();
    }

    this.playerB = new window.YT.Player('player-b', playerBConfig);
  }

  /**
   * Safe getters for YouTube IFrame API methods
   */
  safeGetPlayerState(player) {
    try {
      if (player && typeof player.getPlayerState === 'function') {
        return player.getPlayerState();
      }
    } catch (e) {}
    return -1;
  }

  safeGetCurrentTime(player) {
    try {
      if (player && typeof player.getCurrentTime === 'function') {
        return Number(player.getCurrentTime()) || 0;
      }
    } catch (e) {}
    return 0;
  }

  safeGetDuration(player) {
    try {
      if (player && typeof player.getDuration === 'function') {
        return Number(player.getDuration()) || 0;
      }
    } catch (e) {}
    return 0;
  }

  /**
   * Verify whether a player ('A' or 'B') has been continuously in YT.PlayerState.PLAYING (1)
   * long enough (>= 4.8s wall-clock and >= 4.4s of actual video playback progress) that
   * YouTube's centered Play/Pause modal (.new-controls.fadein) has 100% faded to opacity 0.
   */
  isPlayerModalFree(playerId) {
    const player = playerId === 'A' ? this.playerA : this.playerB;
    if (!player) return false;
    const state = this.safeGetPlayerState(player);
    if (state !== 1) return false;

    const since = this.playingSince[playerId] || 0;
    if (since <= 0) return false;

    const wallMs = Date.now() - since;
    const currentTime = this.safeGetCurrentTime(player);
    const startVideoTime = this.playStartVideoTime[playerId] || 0;
    const advancedSec = currentTime - startVideoTime;

    return wallMs >= 4800 && advancedSec >= 4.4;
  }

  /**
   * Disable YouTube auto-captions / CC overlays via Player API
   */
  suppressCaptions(player) {
    if (!player) return;
    try {
      if (typeof player.setOption === 'function') {
        player.setOption('captions', 'track', {});
        player.setOption('cc', 'track', {});
      }
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

    this.currentIndex = this.findNextLiveIndex(this.currentIndex);
    this.currentVideoItem = this.queue[this.currentIndex];
    const activePlayer = this.getActivePlayer();
    const alreadyCuedOnActive = this.cuedItems[this.activePlayerId]?.videoId === this.currentVideoItem?.videoId;

    // If startStream is called after initial boot warmup (e.g. from Admin settings or custom video test)
    // and the new video isn't already cued on the active player, route through the hidden inactive player
    // + static-covered transition so we never load a raw un-preroll'd video on the visible screen.
    if (!alreadyCuedOnActive && !effectsEngine.isWarmupActive && this.isApiReady) {
      this.currentIndex = (this.currentIndex - 1 + this.queue.length) % this.queue.length;
      this.preloadedQueueIndex = null;
      this.cuedItems[this.activePlayerId === 'A' ? 'B' : 'A'] = null;
      this.hasPreloadedForCurrentClip = true;
      this.preloadNext();
      this.nextVideo();
      return;
    }

    this.cuedItems[this.activePlayerId] = this.currentVideoItem;
    this.deliberatelyPaused[this.activePlayerId] = false;
    this.lastAdvanceAt = Date.now();

    let maxDurationSec = this.consumePendingClipDuration(this.currentVideoItem);
    let startSec = 0;
    if (maxDurationSec == null) {
      const clip = this.calculateSmartClip(this.currentVideoItem);
      maxDurationSec = clip.maxDurationSec;
      startSec = clip.startSec;
    }
    this.activeCutoffSec = maxDurationSec;
    this.elapsedSeconds = 0;

    // Check if the inactive player already has the next item preloading from createPlayers()
    const inactivePlayerId = this.activePlayerId === 'A' ? 'B' : 'A';
    const nextIndex = this.findNextLiveIndex((this.currentIndex + 1) % this.queue.length);
    const nextItem = this.queue[nextIndex];
    const alreadyPreloadedOnInactive = Boolean(
      nextItem &&
      this.cuedItems[inactivePlayerId]?.videoId === nextItem.videoId &&
      !this.deliberatelyPaused[inactivePlayerId]
    );
    this.hasPreloadedForCurrentClip = alreadyPreloadedOnInactive;

    this.updateOSD(this.currentVideoItem);

    if (!alreadyCuedOnActive && activePlayer && typeof activePlayer.loadVideoById === 'function') {
      try {
        this.playingSince[this.activePlayerId] = 0;
        this.playStartVideoTime[this.activePlayerId] = 0;
        this.clampedSeekDone[this.activePlayerId] = false;
        this.intendedStartSec[this.activePlayerId] = startSec;
        if (typeof activePlayer.mute === 'function') activePlayer.mute();
        activePlayer.loadVideoById({
          videoId: this.currentVideoItem.videoId,
          startSeconds: startSec
        });
      } catch (e) {}
    }

    if (this.activeCutoffSec <= 15 && !alreadyPreloadedOnInactive) {
      this.hasPreloadedForCurrentClip = true;
      this.preloadNext();
    }

    this.startClipTimer();
  }

  /**
   * Preload and start the next video on the hidden inactive player in the background.
   * Because it starts playing behind the opaque active player, all loading/buffering and
   * YouTube's ~4.4s Play/Pause center modal (.new-controls.fadein) expire 100% unseen.
   */
  preloadNext(advancePastPreloaded = false) {
    if (!this.queue || this.queue.length === 0) return;

    const inactivePlayer = this.getInactivePlayer();
    const inactivePlayerId = this.activePlayerId === 'A' ? 'B' : 'A';
    const baseIndex = (advancePastPreloaded && this.preloadedQueueIndex != null)
      ? this.preloadedQueueIndex
      : this.currentIndex;
    const nextIndex = this.findNextLiveIndex((baseIndex + 1) % this.queue.length);
    const nextItem = this.queue[nextIndex];
    if (!nextItem) return;

    this.hasPreloadedForCurrentClip = true;

    // If this exact video is already playing in the background on inactivePlayer, do not reload it
    // (reloading would reset its 4.8-second YouTube play/pause bezel fade-out timer).
    if (
      !advancePastPreloaded &&
      this.cuedItems[inactivePlayerId]?.videoId === nextItem.videoId &&
      !this.deliberatelyPaused[inactivePlayerId]
    ) {
      this.preloadedQueueIndex = nextIndex;
      return;
    }

    this.preloadedQueueIndex = nextIndex;
    this.cuedItems[inactivePlayerId] = nextItem;
    this.deliberatelyPaused[inactivePlayerId] = false;
    this.playingSince[inactivePlayerId] = 0;
    this.playStartVideoTime[inactivePlayerId] = 0;
    this.clampedSeekDone[inactivePlayerId] = false;
    this.preloadedAt = Date.now();

    const nextClip = this.calculateSmartClip(nextItem);
    this.intendedStartSec[inactivePlayerId] = nextClip.startSec;
    this.cachePendingClipDuration(nextItem, nextClip.maxDurationSec);

    if (inactivePlayer && typeof inactivePlayer.loadVideoById === 'function') {
      try {
        if (typeof inactivePlayer.mute === 'function') {
          inactivePlayer.mute();
        }
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
   * Advance the virtual channel number to simulate human remote control surfing.
   * In rapid browse/zap bursts: steps sequentially (e.g. 23 -> 24 -> 25).
   * In standard channel flips: hops to another realistic vintage cable channel number.
   */
  advanceChannelNumber(isSequential = false) {
    if (isSequential) {
      this.currentChannelNumber = (this.currentChannelNumber >= 68) ? 2 : this.currentChannelNumber + 1;
    } else {
      const realisticChannels = [2, 3, 4, 5, 7, 9, 11, 13, 14, 18, 22, 24, 28, 32, 36, 42, 45, 51, 55, 60, 68];
      let next = this.currentChannelNumber;
      while (next === this.currentChannelNumber) {
        next = realisticChannels[Math.floor(Math.random() * realisticChannels.length)];
      }
      this.currentChannelNumber = next;
    }
  }

  getChannelNumberString() {
    return String(this.currentChannelNumber).padStart(2, '0');
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
    const isShortFormCat = cat === 'commercials' || cat === 'trailers' || cat === 'bumpers' || cat === 'promos' || cat === 'intros';
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
      // Quick remote clicks: 12 to 15 seconds (guarantees background preloader has full 10s+ lead time to buffer & fade out modal)
      maxDurationSec = Math.floor(Math.random() * 4) + 12;
      if (this.randomOffsetEnabled && startSec === 0 && !isShortFormCat) {
        startSec = this.getSmartVisualSeekOffset(cat);
      }
      return { startSec, maxDurationSec };
    }

    this.isZapClip = false;

    if (this.currentSessionType === 'curious_glance') {
      // 18 to 35 seconds - catch the hook / chorus / commercial punchline / gameshow buzzer
      if (isShortFormCat) {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 11) + 25 : Math.floor(Math.random() * 11) + 16; // 16-27s
        if (startSec === 0) startSec = 0;
      } else if (cat === 'gameshows') {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 16) + 35 : Math.floor(Math.random() * 11) + 24; // 24-35s
        if (this.randomOffsetEnabled && startSec === 0) startSec = this.getSmartVisualSeekOffset(cat);
      } else if (cat === 'music') {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 16) + 35 : Math.floor(Math.random() * 11) + 26; // 26-37s
        if (this.randomOffsetEnabled && startSec === 0) startSec = this.getSmartVisualSeekOffset(cat);
      } else if (cat === 'cartoons' || cat === 'kids') {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 16) + 30 : Math.floor(Math.random() * 11) + 20; // 20-31s
        if (this.randomOffsetEnabled && startSec === 0) startSec = this.getSmartVisualSeekOffset(cat);
      } else if (cat === 'comedy') {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 16) + 32 : Math.floor(Math.random() * 11) + 22; // 22-33s
        if (this.randomOffsetEnabled && startSec === 0) startSec = this.getSmartVisualSeekOffset(cat);
      } else {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 16) + 30 : Math.floor(Math.random() * 11) + 20; // 20-31s
        if (this.randomOffsetEnabled && startSec === 0) startSec = this.getSmartVisualSeekOffset(cat);
      }
    } else {
      // 'settle_in' session: 45 to 85 seconds - deep nostalgic immersion
      if (isShortFormCat) {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 16) + 30 : Math.floor(Math.random() * 11) + 22; // 22-33s
        if (startSec === 0) startSec = 0;
      } else if (cat === 'gameshows') {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 26) + 60 : (isBalanced ? Math.floor(Math.random() * 21) + 45 : Math.floor(Math.random() * 16) + 38); // 38-54s
        if (this.randomOffsetEnabled && startSec === 0) startSec = this.getSmartVisualSeekOffset(cat);
      } else if (cat === 'music') {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 26) + 65 : (isBalanced ? Math.floor(Math.random() * 21) + 48 : Math.floor(Math.random() * 21) + 40); // 40-69s
        if (this.randomOffsetEnabled && startSec === 0) startSec = this.getSmartVisualSeekOffset(cat);
      } else if (cat === 'cartoons' || cat === 'kids') {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 26) + 55 : (isBalanced ? Math.floor(Math.random() * 21) + 40 : Math.floor(Math.random() * 16) + 35); // 35-51s
        if (this.randomOffsetEnabled && startSec === 0) startSec = Math.random() < 0.25 ? 0 : this.getSmartVisualSeekOffset(cat);
      } else if (cat === 'comedy') {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 26) + 60 : (isBalanced ? Math.floor(Math.random() * 21) + 42 : Math.floor(Math.random() * 16) + 35); // 35-51s
        if (this.randomOffsetEnabled && startSec === 0) startSec = this.getSmartVisualSeekOffset(cat);
      } else {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 26) + 60 : (isBalanced ? Math.floor(Math.random() * 21) + 45 : Math.floor(Math.random() * 16) + 35); // 35-51s
        if (this.randomOffsetEnabled && startSec === 0) startSec = this.getSmartVisualSeekOffset(cat);
      }
    }

    // Apply manual user caps if set in admin (enforce minimum 12s so background pre-roll always completes)
    if (this.generalClipMaxSec && cat !== 'commercials') {
      maxDurationSec = Math.max(12, Math.min(maxDurationSec, this.generalClipMaxSec));
    }
    if (this.commercialMaxSec && cat === 'commercials') {
      maxDurationSec = Math.max(12, Math.min(maxDurationSec, this.commercialMaxSec));
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
   * Helper for instant visual action seek offset.
   * Kept in a safe 15-65s window so we don't overshoot 60-90s clips;
   * handlePlayerStateChange also clamps against real getDuration() as soon as metadata loads.
   */
  getSmartVisualSeekOffset(cat) {
    if (cat === 'commercials' || cat === 'trailers' || cat === 'bumpers' || cat === 'promos' || cat === 'intros') return 0;
    if (cat === 'gameshows') return Math.floor(Math.random() * 41) + 25; // 25-65s
    if (cat === 'music') return Math.floor(Math.random() * 41) + 25; // 25-65s
    if (cat === 'cartoons' || cat === 'kids') return Math.floor(Math.random() * 36) + 15; // 15-50s
    if (cat === 'sports') return Math.floor(Math.random() * 46) + 25; // 25-70s
    if (cat === 'comedy') return Math.floor(Math.random() * 36) + 15; // 15-50s
    return Math.floor(Math.random() * 36) + 15; // 15-50s
  }

  /**
   * Advance to next video in queue with CRT channel static glitch.
   * Guarantees the incoming player has finished its 4.8s modal fade-out before revealing it.
   */
  nextVideo() {
    if (!this.queue || this.queue.length === 0) return;

    if (this.isTransitioning) return;
    this.isTransitioning = true;

    this.clearClipTimer();

    const isRapidSurfing = this.isZapClip || this.currentSessionType === 'browse_flurry';
    this.advanceChannelNumber(isRapidSurfing);

    const staticDuration = isRapidSurfing ? 160 : 240;
    const inactivePlayerId = this.activePlayerId === 'A' ? 'B' : 'A';
    const hadPreloaded = this.hasPreloadedForCurrentClip && Boolean(this.cuedItems[inactivePlayerId]);

    if (!hadPreloaded) {
      this.hasPreloadedForCurrentClip = true;
      this.preloadNext();
    }

    effectsEngine.triggerChannelSwitch(
      staticDuration,
      () => {
        this.isTransitioning = false;

        // 1. Swap active player container focus (brings already-baked background player to front)
        this.toggleActivePlayerFocus();
        const outgoingPlayerId = this.activePlayerId === 'A' ? 'B' : 'A';
        const outgoingPlayer = this.getInactivePlayer();

        // 2. Sync currentIndex with the exact queue index loaded on the newly active player
        if (this.preloadedQueueIndex != null) {
          this.currentIndex = this.preloadedQueueIndex;
          this.preloadedQueueIndex = null;
        } else {
          this.currentIndex = this.findNextLiveIndex((this.currentIndex + 1) % this.queue.length);
        }
        this.currentVideoItem = this.cuedItems[this.activePlayerId] || this.queue[this.currentIndex];
        this.cuedItems[this.activePlayerId] = this.currentVideoItem;
        this.deliberatelyPaused[this.activePlayerId] = false;
        this.lastAdvanceAt = Date.now();

        // 3. Set cutoff duration for this newly active video
        let maxDurationSec = this.consumePendingClipDuration(this.currentVideoItem);
        if (maxDurationSec == null) {
          maxDurationSec = this.calculateSmartClip(this.currentVideoItem).maxDurationSec;
        }
        // Clamp activeCutoffSec to actual remaining playable time if known
        const activePlayer = this.getActivePlayer();
        const dur = this.safeGetDuration(activePlayer);
        const cur = this.safeGetCurrentTime(activePlayer);
        if (dur > 0 && cur >= 0) {
          const remaining = Math.floor(dur - cur - 2.5);
          if (remaining > 6 && remaining < maxDurationSec) {
            maxDurationSec = remaining;
          }
        }
        this.activeCutoffSec = Math.max(10, maxDurationSec);
        this.elapsedSeconds = 0;
        this.hasPreloadedForCurrentClip = false;

        // 4. Update OSD green HUD display
        this.updateOSD(this.currentVideoItem);

        // 5. Start clip timing monitor
        this.startClipTimer();

        // 6. If clip is <= 16s, immediately load next video onto outgoing player (without calling pauseVideo()
        // first, which would race with loadVideoById() and trigger YouTube's pause/play control bar!).
        // Only pause outgoing player if it will sit idle for several seconds before preloadNext() fires.
        if (this.activeCutoffSec <= 16) {
          this.hasPreloadedForCurrentClip = true;
          this.preloadNext();
        } else {
          this.deliberatelyPaused[outgoingPlayerId] = true;
          this.playingSince[outgoingPlayerId] = 0;
          if (outgoingPlayer && typeof outgoingPlayer.pauseVideo === 'function') {
            try {
              outgoingPlayer.pauseVideo();
            } catch (e) {}
          }
        }
      },
      () => this.isPlayerModalFree(inactivePlayerId),
      6500
    );
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

    // YT.PlayerState.ENDED = 0
    if (event.data === 0) {
      // Never use seekTo() as it triggers YouTube's interactive scrubber UI (.new-controls.fadein).
      // Instead, if a video ends on the active player, advance to the next video;
      // if it ends on the hidden background preloader, immediately cue the next live video via loadVideoById.
      if (playerId === this.activePlayerId) {
        this.nextVideo();
      } else if (!this.deliberatelyPaused[playerId]) {
        this.preloadNext(true);
      }
      return;
    }

    // YT.PlayerState.PLAYING = 1: video started rolling
    if (event.data === 1) {
      this.suppressCaptions(event.target);
      const dur = this.safeGetDuration(player);
      const cur = this.safeGetCurrentTime(player);

      // Perform one-time duration validation when video first begins playing
      if (!this.clampedSeekDone[playerId] && dur > 0) {
        this.clampedSeekDone[playerId] = true;

        // If a background preloaded video is too short (< 14s total) or our random startSec landed
        // within 16s of the end of the video, skip/re-load cleanly via loadVideoById (never seekTo!)
        if (playerId !== this.activePlayerId && (dur < 14 || (cur > 2 && (dur - cur) < 16))) {
          if (dur >= 18 && cur > 2) {
            // Video itself is plenty long, just reload it cleanly from 0s via loadVideoById
            const item = this.cuedItems[playerId];
            this.intendedStartSec[playerId] = 0;
            this.playingSince[playerId] = 0;
            this.playStartVideoTime[playerId] = 0;
            this.preloadedAt = Date.now();
            try {
              player.loadVideoById({ videoId: item.videoId, startSeconds: 0 });
            } catch (e) {}
            return;
          }
          // Video is under 18s total: skip to the next live stream in the queue
          const shortItem = this.cuedItems[playerId];
          if (shortItem) {
            catalogManager.markVideoDead(shortItem.videoId, shortItem.title);
          }
          this.preloadNext(true);
          return;
        }
      }

      if (this.playingSince[playerId] === 0) {
        this.playingSince[playerId] = Date.now();
        this.playStartVideoTime[playerId] = cur;
      }

      if (playerId === this.activePlayerId) {
        this.stuckSeconds = 0;
        this.consecutiveErrorCount = 0;
      }
      return;
    }

    // YT.PlayerState.PAUSED = 2: If any video is unexpectedly paused (not the deliberately paused outgoing player), resume immediately
    if (event.data === 2) {
      this.playingSince[playerId] = 0;
      if (!this.deliberatelyPaused[playerId]) {
        try {
          if (player && typeof player.playVideo === 'function') {
            player.playVideo();
          }
        } catch (e) {}
      }
      return;
    }

    // YT.PlayerState.CUED = 5: If a video is in CUED state, immediately command it to play
    if (event.data === 5) {
      this.playingSince[playerId] = 0;
      if (!this.deliberatelyPaused[playerId]) {
        try {
          if (player && typeof player.playVideo === 'function') {
            if (typeof player.mute === 'function') player.mute();
            player.playVideo();
          }
        } catch (e) {}
      }
      return;
    }

    // YT.PlayerState.UNSTARTED = -1
    if (event.data === -1) {
      this.playingSince[playerId] = 0;
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
      this.pendingClipCache.delete(erroredItem.videoId);
    }

    // Errors from the inactive background preloader: just re-cue a live
    // replacement, no need to disrupt what's currently on screen.
    if (playerId !== this.activePlayerId) {
      console.warn(`Preloader player ${playerId} hit an unplayable video (${reason}): ${erroredItem?.videoId || 'unknown'}. Re-cueing replacement.`);
      this.preloadNext(true);
      return;
    }

    this.consecutiveErrorCount++;
    console.warn(`Active player error (${reason}): ${erroredItem?.videoId || 'unknown'}. Consecutive error count: ${this.consecutiveErrorCount}`);

    if (this.consecutiveErrorCount >= 3) {
      console.warn("Multiple consecutive video errors. Fast-forwarding queue...");
      this.consecutiveErrorCount = 0;
      const targetIndex = this.findNextLiveIndex((this.currentIndex + 5) % this.queue.length);
      this.currentIndex = (targetIndex - 1 + this.queue.length) % this.queue.length;
      this.preloadedQueueIndex = null;
      this.hasPreloadedForCurrentClip = true;
      this.preloadNext();
      this.nextVideo();
      return;
    }

    // Advance to next working video (nextVideo will hold CRT static until replacement is modal-free)
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

      // Query live player state, duration, and current position
      const activePlayer = this.getActivePlayer();
      const playerState = this.safeGetPlayerState(activePlayer);
      const duration = this.safeGetDuration(activePlayer);
      const currentTime = this.safeGetCurrentTime(activePlayer);

      // If active video is stuck in UNSTARTED (-1), CUED (5), or unexpectedly frozen
      if (playerState !== 1 && playerState !== 3) {
        this.stuckSeconds = (this.stuckSeconds || 0) + 1;
        try {
          if (activePlayer && typeof activePlayer.mute === 'function') activePlayer.mute();
          if (activePlayer && typeof activePlayer.playVideo === 'function') activePlayer.playVideo();
        } catch (e) {}

        // If stuck for 4 seconds, mark dead and automatically advance with CRT static glitch
        if (this.stuckSeconds >= 4) {
          console.warn(`Video ${this.currentVideoItem?.videoId} stuck in state ${playerState}. Skipping...`);
          this.stuckSeconds = 0;
          if (this.currentVideoItem) {
            catalogManager.markVideoDead(this.currentVideoItem.videoId, this.currentVideoItem.title);
          }
          this.nextVideo();
          return;
        }
      } else {
        this.stuckSeconds = 0;
      }

      // JIT background pre-loading: start background player 10s before channel switch
      // (or when <= 14s of file duration remain) so YouTube's startup bezel expires 100% in the dark!
      const leadTime = 10;
      const nearFileEnd = duration > 0 && currentTime > 0 && (duration - currentTime <= 14);
      if ((this.elapsedSeconds >= Math.max(1, this.activeCutoffSec - leadTime) || nearFileEnd) && !this.hasPreloadedForCurrentClip) {
        this.hasPreloadedForCurrentClip = true;
        this.preloadNext();
      }

      // Monitor background preloader health: if preloaded player is stuck for > 4.5s without entering PLAYING,
      // or if the preloaded video is about to run out (< 5s left) while still waiting in the background,
      // quarantine/skip it and re-cue the next video immediately.
      const inactiveId = this.activePlayerId === 'A' ? 'B' : 'A';
      if (this.hasPreloadedForCurrentClip && this.cuedItems[inactiveId]) {
        const inactivePlayer = this.getInactivePlayer();
        const inactiveState = this.safeGetPlayerState(inactivePlayer);
        const inactiveDur = this.safeGetDuration(inactivePlayer);
        const inactiveCur = this.safeGetCurrentTime(inactivePlayer);
        const preloadAgeMs = this.preloadedAt ? (Date.now() - this.preloadedAt) : 0;

        if (inactiveState !== 1 && preloadAgeMs >= 4500) {
          const stalledItem = this.cuedItems[inactiveId];
          console.warn(`Preloaded video ${stalledItem?.videoId} failed to start within 4.5s (state=${inactiveState}). Re-cueing...`);
          if (stalledItem) {
            catalogManager.markVideoDead(stalledItem.videoId, stalledItem.title);
          }
          this.preloadNext(true);
        } else if (inactiveState === 1 && inactiveDur > 0 && (inactiveDur - inactiveCur <= 5.0)) {
          console.warn(`Preloaded video ${this.cuedItems[inactiveId]?.videoId} nearing end in background. Re-cueing fresh stream...`);
          this.preloadNext(true);
        }
      }

      // Auto-next if elapsed reaches cutoff AND the background player is 100% modal-free,
      // OR if the active video is within 2.5s of ending (in which case nextVideo holds static if needed).
      const isCutoff = this.activeCutoffSec > 0 && this.elapsedSeconds >= this.activeCutoffSec;
      const isNearEnd = duration > 0 && currentTime > 0 && (duration - currentTime <= 2.5);
      const isPreloadModalFree = this.isPlayerModalFree(inactiveId);

      if ((isCutoff && isPreloadModalFree) || isNearEnd) {
        console.log(`Auto-advancing stream (Cutoff: ${isCutoff}, NearEnd: ${isNearEnd}, ModalFree: ${isPreloadModalFree})...`);
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
    const eraBadge = document.getElementById('osd-era-badge');

    const chNum = this.getChannelNumberString();
    const category = (videoItem?.category || 'RETRO TV').toUpperCase();
    const decade = videoItem?.decade || '1990s';

    if (osdMode === 'vcr-watermark') {
      if (channelLabel) channelLabel.textContent = `CH ${chNum} • BNSD TV`;
    } else {
      if (channelLabel) channelLabel.textContent = `CH ${chNum} • BNSD TV`;
    }

    if (catLabel) {
      catLabel.textContent = category;
    }
    if (eraBadge) {
      eraBadge.textContent = decade;
    }

    // Trigger glowing CRT channel popup flash animation
    hud.classList.remove('channel-popping');
    void hud.offsetWidth; // Force reflow to restart CSS animation
    hud.classList.add('channel-popping');
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
