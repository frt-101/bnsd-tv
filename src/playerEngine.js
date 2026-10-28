import { effectsEngine } from './effectsEngine.js';
import { catalogManager } from './catalogManager.js';

// YouTube embedded players display their title bar, channel watermark, and initial
// play/pause bezel for ~4.0–4.5s after entering YT.PlayerState.PLAYING (1).
// Requiring a full 6.0s of continuous, uninterrupted PLAYING time in the background
// player guarantees 100% of YouTube's startup UI has disappeared before any swap.
const MIN_HIDDEN_PLAY_BAKE_MS = 6000;

// Lead time (in seconds before clip cutoff) to start loading & playing the next
// video in the background container (~2-3s network buffer + 6.0s bake + safety margin).
const PRELOAD_LEAD_TIME_SEC = 13;

class PlayerEngine {
  constructor() {
    this.playerA = null;
    this.playerB = null;
    this.activePlayerId = 'A'; // 'A' or 'B'
    this.isApiReady = false;
    this.hasStartedStream = false;

    this.queue = [];
    this.currentIndex = 0;
    this.preloadedIndex = null;
    this.consecutiveErrorCount = 0;
    this.isTransitioning = false;
    this.bakePollTimer = null;

    // Watchdog support: timestamp of the last successful channel change
    this.lastAdvanceAt = null;
    this.autoplayFallbackTimeout = null;

    // Per-player state tracking
    this.cuedItems = { A: null, B: null };
    this.cuedStartSec = { A: 0, B: 0 };
    this.seekVerified = { A: false, B: false };
    this.deliberatelyPaused = { A: false, B: false };
    this.playerStates = { A: -1, B: -1 };
    this.playingSince = { A: 0, B: 0 };
    this.resumeTimeouts = { A: null, B: null };
    this.postSwapPauseTimeout = null;

    // Config Rules & Pacing Modes
    this.pacingMode = 'channel-surfer'; // 'channel-surfer' | 'balanced' | 'deep-cuts'
    this.commercialMaxSec = 30;
    this.generalClipMaxSec = 60;
    this.randomOffsetEnabled = true;
    this.zapBurstEnabled = true;

    // Human Remote Surfing Engine (Authentic Psychological Session State Machine)
    // Sessions cycle naturally: 'browse_flurry' (2-4 fast clicks) -> 'curious_glance' (18-35s) -> 'settle_in' (45-85s)
    this.currentSessionType = 'settle_in';
    this.sessionClipsRemaining = 1;

    // State Tracking
    this.currentChannelNumber = 3;
    this.currentVideoItem = null;
    this.clipTimer = null;
    this.elapsedSeconds = 0;
    this.activeCutoffSec = 30;
    this.stuckSeconds = 0;
    this.isZapClip = false;
    this.hasPreloadedForCurrentClip = false;
    this.onProgressCallback = null;

    // Cache the clip parameters rolled at preload time so activation reuses them
    // without double-ticking the surfing session state machine.
    this.pendingClipCache = new Map(); // videoId -> { startSec, maxDurationSec }
  }

  /**
   * Cache clip timing rolled for a video at preload time.
   */
  cachePendingClip(videoItem, clipData) {
    if (!videoItem) return;
    this.pendingClipCache.set(videoItem.videoId, clipData);
  }

  /**
   * Consume (and remove) cached preload-time clip timing for this video.
   */
  consumePendingClip(videoItem) {
    if (!videoItem || !this.pendingClipCache.has(videoItem.videoId)) return null;
    const clipData = this.pendingClipCache.get(videoItem.videoId);
    this.pendingClipCache.delete(videoItem.videoId);
    return clipData;
  }

  /**
   * Check whether a given player ('A' or 'B') is actively playing and has been in
   * YT.PlayerState.PLAYING (1) long enough for YouTube's startup UI bezel to auto-hide.
   */
  isPlayerBaked(playerId, minBakeMs = MIN_HIDDEN_PLAY_BAKE_MS) {
    return (
      this.playerStates[playerId] === 1 &&
      this.playingSince[playerId] > 0 &&
      Date.now() - this.playingSince[playerId] >= minBakeMs
    );
  }

  isActivePlayerBaked(minBakeMs = MIN_HIDDEN_PLAY_BAKE_MS) {
    return this.isPlayerBaked(this.activePlayerId, minBakeMs);
  }

  isInactivePlayerBaked(minBakeMs = MIN_HIDDEN_PLAY_BAKE_MS) {
    const inactiveId = this.activePlayerId === 'A' ? 'B' : 'A';
    return this.isPlayerBaked(inactiveId, minBakeMs);
  }

  /**
   * Configure underlying iframe attributes so browser autoplay policies and
   * focus behavior never interfere with headless display operation.
   */
  configureIframeElement(player) {
    try {
      const iframe = player && typeof player.getIframe === 'function' ? player.getIframe() : null;
      if (iframe) {
        iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
        iframe.setAttribute('tabindex', '-1');
      }
    } catch (e) {}
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
      if (readyCount >= 2) {
        fireCallback();
      }
    };

    // Fallback so startup proceeds even if inactive player takes longer to report ready
    setTimeout(() => {
      fireCallback();
    }, 1200);

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

    if (this.queue && this.queue.length > 0) {
      this.currentIndex = this.findNextLiveIndex(this.currentIndex);
      this.currentVideoItem = this.queue[this.currentIndex];
      this.cuedItems['A'] = this.currentVideoItem;
      if (this.currentVideoItem) {
        videoIdA = this.currentVideoItem.videoId;
        const clipA = this.calculateSmartClip(this.currentVideoItem);
        startSecA = clipA.startSec;
        this.activeCutoffSec = clipA.maxDurationSec;
        this.cuedStartSec['A'] = startSecA;
        this.seekVerified['A'] = false;
        this.cachePendingClip(this.currentVideoItem, clipA);
      }
    }

    // Player A boots immediately behind the CRT Power-On Warmup screen.
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
          this.configureIframeElement(e.target);
          try {
            if (typeof e.target.mute === 'function') e.target.mute();
            if (this.activePlayerId === 'A') {
              const state = typeof e.target.getPlayerState === 'function' ? e.target.getPlayerState() : -1;
              if (state !== 1 && state !== 3 && typeof e.target.playVideo === 'function') {
                e.target.playVideo();
              }
            }
          } catch (err) {}
          checkReady();
        },
        onStateChange: (e) => this.handlePlayerStateChange('A', e),
        onError: (e) => this.handlePlayerError('A', e)
      }
    });

    // Player B is created idle (no initial videoId) so it doesn't prematurely play and
    // finish Video 2 while Video 1 is still playing. preloadNext() loads Video 2 at the
    // exact lead-time window before Video 1 ends.
    this.playerB = new window.YT.Player('player-b', {
      width: '100%',
      height: '100%',
      playerVars: defaultPlayerVars,
      events: {
        onReady: (e) => {
          this.configureIframeElement(e.target);
          try {
            if (typeof e.target.mute === 'function') e.target.mute();
          } catch (err) {}
          checkReady();
        },
        onStateChange: (e) => this.handlePlayerStateChange('B', e),
        onError: (e) => this.handlePlayerError('B', e)
      }
    });
  }

  /**
   * Set playback queue and start playback.
   * On initial boot, Player A is already loading the first video from createPlayers().
   * On subsequent calls (e.g. Admin settings refresh or Direct Video Tester), loads the
   * new video onto the hidden player and transitions cleanly once baked.
   */
  startStream(queue, startIndex = 0) {
    this.queue = queue;
    this.currentIndex = startIndex;

    if (!this.queue || this.queue.length === 0) {
      console.warn("Player queue is empty.");
      return;
    }

    // If stream is already running (e.g. Admin Panel settings update or Direct Video Tester),
    // preload the target video into the hidden player and transition cleanly via nextVideo().
    if (this.hasStartedStream) {
      const targetIdx = this.findNextLiveIndex(this.currentIndex);
      this.hasPreloadedForCurrentClip = true;
      this.preloadNext(targetIdx);
      this.nextVideo(true);
      return;
    }

    this.hasStartedStream = true;
    this.currentIndex = this.findNextLiveIndex(this.currentIndex);
    this.currentVideoItem = this.queue[this.currentIndex];
    this.cuedItems['A'] = this.currentVideoItem;
    this.deliberatelyPaused['A'] = false;
    this.lastAdvanceAt = Date.now();

    const cached = this.consumePendingClip(this.currentVideoItem);
    const maxDurationSec = cached ? cached.maxDurationSec : this.calculateSmartClip(this.currentVideoItem).maxDurationSec;
    this.activeCutoffSec = maxDurationSec;
    this.elapsedSeconds = 0;
    this.stuckSeconds = 0;
    this.hasPreloadedForCurrentClip = false;

    this.updateOSD(this.currentVideoItem);

    // If the initial clip is short, start preloading the next clip immediately
    if (this.activeCutoffSec <= PRELOAD_LEAD_TIME_SEC + 3) {
      this.hasPreloadedForCurrentClip = true;
      this.preloadNext();
    }

    this.startClipTimer();
  }

  /**
   * Preload and start the next video on the hidden inactive player in the background (opacity: 0).
   * Because it starts playing in the dark, all loading/buffering and startup overlays remain invisible.
   */
  preloadNext(explicitTargetIndex = null) {
    if (!this.queue || this.queue.length === 0) return;

    const inactivePlayer = this.getInactivePlayer();
    const inactivePlayerId = this.activePlayerId === 'A' ? 'B' : 'A';

    let nextIndex;
    if (typeof explicitTargetIndex === 'number') {
      nextIndex = this.findNextLiveIndex(explicitTargetIndex % this.queue.length);
    } else if (this.preloadedIndex !== null) {
      nextIndex = this.findNextLiveIndex((this.preloadedIndex + 1) % this.queue.length);
    } else {
      nextIndex = this.findNextLiveIndex((this.currentIndex + 1) % this.queue.length);
    }

    const nextItem = this.queue[nextIndex];
    if (!nextItem) return;

    clearTimeout(this.postSwapPauseTimeout);
    clearTimeout(this.resumeTimeouts[inactivePlayerId]);

    this.preloadedIndex = nextIndex;
    this.cuedItems[inactivePlayerId] = nextItem;
    this.deliberatelyPaused[inactivePlayerId] = false;
    this.playerStates[inactivePlayerId] = -1;
    this.playingSince[inactivePlayerId] = 0;
    this.seekVerified[inactivePlayerId] = false;
    this.preloadedAt = Date.now();

    const nextClip = this.calculateSmartClip(nextItem);
    this.cuedStartSec[inactivePlayerId] = nextClip.startSec;
    this.cachePendingClip(nextItem, nextClip);

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
   * 1. Rapid remote "flurry" clicks (9s to 12s) - "searching"
   * 2. Curious glances (18s to 35s) - "hooked"
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
      // Quick remote clicks: 14 to 18 seconds (gives hidden preloader full buffer + 6.0s bake window)
      maxDurationSec = Math.floor(Math.random() * 5) + 14;
      if (this.randomOffsetEnabled && startSec === 0) {
        startSec = this.getSmartVisualSeekOffset(cat);
      }
      return { startSec, maxDurationSec };
    }

    this.isZapClip = false;

    if (this.currentSessionType === 'curious_glance') {
      // 18 to 35 seconds - catch the hook / chorus / commercial punchline / gameshow buzzer
      if (cat === 'commercials') {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 11) + 25 : Math.floor(Math.random() * 11) + 16; // 16-27s
        if (startSec === 0) startSec = 0;
      } else if (cat === 'gameshows') {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 16) + 35 : Math.floor(Math.random() * 11) + 24; // 24-35s
        if (this.randomOffsetEnabled && startSec === 0) startSec = this.getSmartVisualSeekOffset(cat);
      } else if (cat === 'music') {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 16) + 35 : Math.floor(Math.random() * 11) + 26; // 26-37s
        if (this.randomOffsetEnabled && startSec === 0) startSec = Math.floor(Math.random() * 51) + 30;
      } else if (cat === 'cartoons' || cat === 'kids') {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 16) + 30 : Math.floor(Math.random() * 11) + 20; // 20-31s
        if (this.randomOffsetEnabled && startSec === 0) startSec = Math.floor(Math.random() * 91) + 25;
      } else if (cat === 'comedy') {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 16) + 32 : Math.floor(Math.random() * 11) + 22; // 22-33s
        if (this.randomOffsetEnabled && startSec === 0) startSec = this.getSmartVisualSeekOffset(cat);
      } else {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 16) + 30 : Math.floor(Math.random() * 11) + 20; // 20-31s
        if (this.randomOffsetEnabled && startSec === 0) startSec = Math.floor(Math.random() * 91) + 30;
      }
    } else {
      // 'settle_in' session: 45 to 85 seconds - deep nostalgic immersion
      if (cat === 'commercials') {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 16) + 30 : Math.floor(Math.random() * 11) + 22; // 22-33s
        if (startSec === 0) startSec = 0;
      } else if (cat === 'gameshows') {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 26) + 60 : (isBalanced ? Math.floor(Math.random() * 21) + 45 : Math.floor(Math.random() * 16) + 38); // 38-54s
        if (this.randomOffsetEnabled && startSec === 0) startSec = this.getSmartVisualSeekOffset(cat);
      } else if (cat === 'music') {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 26) + 65 : (isBalanced ? Math.floor(Math.random() * 21) + 48 : Math.floor(Math.random() * 21) + 40); // 40-69s
        if (this.randomOffsetEnabled && startSec === 0) startSec = Math.floor(Math.random() * 61) + 30;
      } else if (cat === 'cartoons' || cat === 'kids') {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 26) + 55 : (isBalanced ? Math.floor(Math.random() * 21) + 40 : Math.floor(Math.random() * 16) + 35); // 35-51s
        if (this.randomOffsetEnabled && startSec === 0) startSec = Math.random() < 0.25 ? 0 : Math.floor(Math.random() * 110) + 35;
      } else if (cat === 'comedy') {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 26) + 60 : (isBalanced ? Math.floor(Math.random() * 21) + 42 : Math.floor(Math.random() * 16) + 35); // 35-51s
        if (this.randomOffsetEnabled && startSec === 0) startSec = this.getSmartVisualSeekOffset(cat);
      } else {
        maxDurationSec = isDeepCuts ? Math.floor(Math.random() * 26) + 60 : (isBalanced ? Math.floor(Math.random() * 21) + 45 : Math.floor(Math.random() * 16) + 35); // 35-51s
        if (this.randomOffsetEnabled && startSec === 0) startSec = Math.floor(Math.random() * 120) + 40;
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
    if (cat === 'gameshows') return Math.floor(Math.random() * 50) + 30; // 30-80s (jump straight into gameplay, buzzers & prizes)
    if (cat === 'music') return Math.floor(Math.random() * 55) + 25; // 25-80s
    if (cat === 'cartoons' || cat === 'kids') return Math.floor(Math.random() * 90) + 30; // 30-120s
    if (cat === 'sports') return Math.floor(Math.random() * 120) + 40; // 40-160s
    if (cat === 'comedy') return Math.floor(Math.random() * 80) + 30; // 30-110s
    return Math.floor(Math.random() * 90) + 35; // 35-125s
  }

  /**
   * Advance to next video in queue with CRT channel static glitch.
   * Guarantees the incoming background player has been actively PLAYING in the dark
   * for >= 6.0s before revealing it, so YouTube UI overlays are 100% impossible.
   */
  nextVideo(forceImmediateStatic = false) {
    if (!this.queue || this.queue.length === 0) return;
    if (this.isTransitioning) return;

    // Ensure background preloader has been started
    if (!this.hasPreloadedForCurrentClip) {
      this.hasPreloadedForCurrentClip = true;
      this.preloadNext();
    }

    // Fast path: background player has ALREADY played continuously for >= 6.0s in the dark!
    // Execute a crisp 160ms/240ms CRT static glitch and swap at peak static.
    if (this.isInactivePlayerBaked()) {
      this.isTransitioning = true;
      this.clearClipTimer();
      clearTimeout(this.bakePollTimer);

      const isRapidSurfing = this.isZapClip || this.currentSessionType === 'browse_flurry';
      this.advanceChannelNumber(isRapidSurfing);
      const staticDuration = isRapidSurfing ? 160 : 240;

      effectsEngine.triggerChannelSwitch(staticDuration, () => {
        this.completeChannelSwap();
      });
      return;
    }

    // If the active player is still playing normally and we aren't forced to cut away immediately,
    // let the active clip continue rolling smoothly on screen while the background player finishes baking.
    const activeState = this.playerStates[this.activePlayerId];
    if (!forceImmediateStatic && activeState === 1) {
      return;
    }

    // Forced transition (e.g. active video ended unexpectedly, errored, or manual skip)
    // while the background player is still buffering/baking:
    // Hold authentic CRT tuning static over the screen until the incoming player is 100% baked!
    this.isTransitioning = true;
    this.clearClipTimer();
    clearTimeout(this.bakePollTimer);

    const isRapidSurfing = this.isZapClip || this.currentSessionType === 'browse_flurry';
    this.advanceChannelNumber(isRapidSurfing);

    // Update OSD immediately so viewer sees channel tuning header over CRT static
    const incomingIdx = this.preloadedIndex !== null ? this.preloadedIndex : this.findNextLiveIndex((this.currentIndex + 1) % this.queue.length);
    this.updateOSD(this.queue[incomingIdx]);

    effectsEngine.startStaticHold();

    const waitForBake = () => {
      const inactiveId = this.activePlayerId === 'A' ? 'B' : 'A';
      const inactivePlayer = this.getInactivePlayer();

      // Poll live state in case a state event was missed
      try {
        if (inactivePlayer && typeof inactivePlayer.getPlayerState === 'function') {
          const st = inactivePlayer.getPlayerState();
          if (st === 1) {
            if (this.playerStates[inactiveId] !== 1 || this.playingSince[inactiveId] === 0) {
              this.playingSince[inactiveId] = Date.now();
            }
            this.playerStates[inactiveId] = 1;
          } else {
            this.playerStates[inactiveId] = st;
            this.playingSince[inactiveId] = 0;
          }
        }
      } catch (e) {}

      if (this.isInactivePlayerBaked()) {
        effectsEngine.stopStaticHold(() => {
          this.completeChannelSwap(false); // OSD already updated when static hold began
        }, 140);
        return;
      }

      // If the background preloader hasn't entered PLAYING within 5.5s, skip it and tune to the next clip
      const sincePreload = Date.now() - (this.preloadedAt || Date.now());
      if (this.playerStates[inactiveId] !== 1 && sincePreload >= 5500) {
        console.warn(`Background preloader (${inactiveId}) stalled in state ${this.playerStates[inactiveId]} during static hold. Advancing to next video...`);
        this.preloadNext();
        if (this.preloadedIndex !== null && this.queue[this.preloadedIndex]) {
          this.updateOSD(this.queue[this.preloadedIndex]);
        }
      }

      this.bakePollTimer = setTimeout(waitForBake, 150);
    };

    this.bakePollTimer = setTimeout(waitForBake, 150);
  }

  /**
   * Perform the actual A/B container swap and state transition while covered by CRT static.
   */
  completeChannelSwap(shouldUpdateOSD = true) {
    this.isTransitioning = false;
    clearTimeout(this.bakePollTimer);
    clearTimeout(this.postSwapPauseTimeout);

    // 1. Swap active player container focus (brings already-running background player to front)
    this.toggleActivePlayerFocus();

    // 2. Advance current index to match the newly revealed player
    const nextIndex = this.preloadedIndex !== null
      ? this.preloadedIndex
      : this.findNextLiveIndex((this.currentIndex + 1) % this.queue.length);
    this.currentIndex = nextIndex;
    this.preloadedIndex = null;
    this.currentVideoItem = this.queue[this.currentIndex];
    this.cuedItems[this.activePlayerId] = this.currentVideoItem;
    this.deliberatelyPaused[this.activePlayerId] = false;
    this.lastAdvanceAt = Date.now();

    // 3. Set cutoff duration for this newly active video
    const cached = this.consumePendingClip(this.currentVideoItem);
    const maxDurationSec = cached ? cached.maxDurationSec : this.calculateSmartClip(this.currentVideoItem).maxDurationSec;
    this.activeCutoffSec = maxDurationSec;
    this.elapsedSeconds = 0;
    this.stuckSeconds = 0;
    this.hasPreloadedForCurrentClip = false;

    // 4. Update OSD green HUD display
    if (shouldUpdateOSD) {
      this.updateOSD(this.currentVideoItem);
    }

    // 5. Start clip timing monitor
    this.startClipTimer();

    // 6. If clip is within the preload window, immediately start preloading the next video
    // on the now-hidden player. Note: we never call pauseVideo() on the outgoing player
    // because pausing a YouTube embed arms its center pause/play bezel on next resume.
    if (this.activeCutoffSec <= PRELOAD_LEAD_TIME_SEC + 3) {
      this.hasPreloadedForCurrentClip = true;
      this.preloadNext();
    }
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
    const state = event.data;
    const prevState = this.playerStates[playerId];
    this.playerStates[playerId] = state;
    const player = playerId === 'A' ? this.playerA : this.playerB;

    // YT.PlayerState.PLAYING = 1
    if (state === 1) {
      clearTimeout(this.resumeTimeouts[playerId]);
      if (prevState !== 1 || this.playingSince[playerId] === 0) {
        this.playingSince[playerId] = Date.now();
      }
      if (playerId === this.activePlayerId) {
        this.stuckSeconds = 0;
        this.consecutiveErrorCount = 0;
      }

      // Verify random seek offset didn't land too close to the end of a short video
      if (!this.seekVerified[playerId] && player) {
        try {
          const dur = typeof player.getDuration === 'function' ? player.getDuration() : 0;
          const cur = typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : 0;
          if (dur > 0) {
            this.seekVerified[playerId] = true;
            if (this.cuedStartSec[playerId] > 0 && (dur - cur) < 24) {
              if (playerId !== this.activePlayerId) {
                if (dur >= 18 && typeof player.loadVideoById === 'function' && this.cuedItems[playerId]) {
                  // Rewind short clip to 0s in the dark and reset bake timer cleanly
                  this.cuedStartSec[playerId] = 0;
                  this.playingSince[playerId] = 0;
                  this.preloadedAt = Date.now();
                  player.loadVideoById({ videoId: this.cuedItems[playerId].videoId, startSeconds: 0 });
                } else {
                  // Ultra-short snippet in background preloader: cue next video instead
                  this.preloadNext();
                }
              }
            }
          }
        } catch (e) {}
      }
      return;
    }

    // Any non-PLAYING state (-1 UNSTARTED, 0 ENDED, 2 PAUSED, 3 BUFFERING, 5 CUED)
    // resets the continuous-play bake timer so post-buffer/post-seek bezels never leak through.
    this.playingSince[playerId] = 0;

    // YT.PlayerState.ENDED = 0
    if (state === 0) {
      // If the hidden background preloader hit ENDED (e.g. random startSec overshot the
      // total duration of a short clip), either rewind to 0s or preload the next video so
      // an ENDED player with YouTube's "More Videos" grid is NEVER swapped onto the screen.
      if (playerId !== this.activePlayerId) {
        if (this.cuedStartSec[playerId] > 0 && !this.seekVerified[playerId]) {
          this.seekVerified[playerId] = true;
          this.cuedStartSec[playerId] = 0;
          this.preloadedAt = Date.now();
          const item = this.cuedItems[playerId];
          if (item && player && typeof player.loadVideoById === 'function') {
            try {
              player.loadVideoById({ videoId: item.videoId, startSeconds: 0 });
              return;
            } catch (e) {}
          }
        }
        this.preloadNext();
        return;
      }

      // Active player ended unexpectedly: switch immediately (using static hold if needed)
      this.nextVideo(true);
      return;
    }

    // YT.PlayerState.PAUSED = 2 or YT.PlayerState.CUED = 5
    // Only auto-invoke playVideo() on the HIDDEN background player (never on the visible
    // active player, where calling playVideo() would flash YouTube's center || modal).
    if ((state === 2 || state === 5) && !this.deliberatelyPaused[playerId]) {
      clearTimeout(this.resumeTimeouts[playerId]);
      if (playerId !== this.activePlayerId) {
        this.resumeTimeouts[playerId] = setTimeout(() => {
          if (this.deliberatelyPaused[playerId] || playerId === this.activePlayerId) return;
          try {
            if (!player || typeof player.getPlayerState !== 'function') return;
            const currentState = player.getPlayerState();
            if ((currentState === 2 || currentState === 5) && typeof player.playVideo === 'function') {
              this.playingSince[playerId] = 0;
              this.preloadedAt = Date.now();
              player.playVideo();
            }
          } catch (e) {}
        }, 1200);
      } else {
        // If the visible active player ever enters PAUSED/CUED, switch channels rather than
        // calling playVideo() on a visible player.
        this.resumeTimeouts[playerId] = setTimeout(() => {
          if (playerId === this.activePlayerId && this.playerStates[playerId] !== 1) {
            this.nextVideo(true);
          }
        }, 1000);
      }
    }
  }

  /**
   * Auto-skip unavailable, private, or non-embeddable YouTube videos.
   * Quarantines whichever video actually errored (active or preloading)
   * so it's excluded from the queue immediately.
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

    // Errors from the inactive background preloader: immediately load the next live
    // replacement in the dark without disrupting what is currently playing on screen.
    if (playerId !== this.activePlayerId) {
      console.warn(`Preloader player ${playerId} hit an unplayable video (${reason}): ${erroredItem?.videoId || 'unknown'}. Re-cueing replacement.`);
      this.preloadNext();
      return;
    }

    this.consecutiveErrorCount++;
    console.warn(`Active player error (${reason}): ${erroredItem?.videoId || 'unknown'}. Consecutive error count: ${this.consecutiveErrorCount}`);

    if (this.consecutiveErrorCount >= 3) {
      console.warn("Multiple consecutive video errors. Fast-forwarding queue...");
      this.consecutiveErrorCount = 0;
      const targetIndex = this.findNextLiveIndex((this.currentIndex + 5) % this.queue.length);
      this.hasPreloadedForCurrentClip = true;
      this.preloadNext(targetIndex);
      this.nextVideo(true);
      return;
    }

    this.nextVideo(true);
  }

  /**
   * Cleanly destroy YouTube players to prevent memory leaks
   */
  destroy() {
    this.clearClipTimer();
    clearTimeout(this.autoplayFallbackTimeout);
    clearTimeout(this.bakePollTimer);
    clearTimeout(this.postSwapPauseTimeout);
    clearTimeout(this.resumeTimeouts.A);
    clearTimeout(this.resumeTimeouts.B);

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

      // Query live player state, duration, and current position
      const activePlayer = this.getActivePlayer();
      let duration = 0;
      let currentTime = 0;
      let playerState = -1;
      try {
        if (activePlayer && typeof activePlayer.getPlayerState === 'function') {
          playerState = activePlayer.getPlayerState();
          this.playerStates[this.activePlayerId] = playerState;
        }
        if (activePlayer && typeof activePlayer.getDuration === 'function') {
          duration = activePlayer.getDuration();
        }
        if (activePlayer && typeof activePlayer.getCurrentTime === 'function') {
          currentTime = activePlayer.getCurrentTime();
        }
      } catch (e) {}

      // Dynamically clamp activeCutoffSec based on the video's actual remaining duration
      // minus an end-screen safety buffer (12s on longer videos, 3s on short commercials).
      // This ensures we:
      // 1) Never reach the final seconds where YouTube renders End Screen recommendation cards
      // 2) Trigger JIT background preloading well before the video's actual end!
      let isNearEnd = false;
      if (duration > 0 && currentTime > 0) {
        const endMarginSec = duration >= 60 ? 12 : (duration >= 35 ? 6 : 3);
        const safeRemainingSec = Math.floor(duration - currentTime - endMarginSec);
        if (safeRemainingSec <= 0) {
          isNearEnd = true;
        } else if (this.elapsedSeconds + safeRemainingSec < this.activeCutoffSec) {
          this.activeCutoffSec = Math.max(this.elapsedSeconds + 1, this.elapsedSeconds + safeRemainingSec);
        }
      }

      if (this.onProgressCallback) {
        this.onProgressCallback({
          elapsed: this.elapsedSeconds,
          cutoff: this.activeCutoffSec,
          currentVideo: this.currentVideoItem
        });
      }

      // Monitor for genuinely wedged active videos (never call playVideo() on a visible player,
      // which would flash YouTube's center pause/play modal; instead skip to the next channel)
      if (playerState !== 1 && playerState !== 3) {
        this.stuckSeconds = (this.stuckSeconds || 0) + 1;
        if (this.stuckSeconds >= 5) {
          console.warn(`Video ${this.currentVideoItem?.videoId} stuck in state ${playerState}. Skipping...`);
          this.stuckSeconds = 0;
          if (this.currentVideoItem) {
            catalogManager.markVideoDead(this.currentVideoItem.videoId, this.currentVideoItem.title);
          }
          this.nextVideo(true);
          return;
        }
      } else {
        this.stuckSeconds = 0;
      }

      // JIT background pre-loading: start background player 13s before channel switch
      // (or whenever <= 18s of total file duration remain) so YouTube's startup bezel
      // expires 100% in the background!
      const rawRemainingSec = duration > 0 && currentTime > 0 ? (duration - currentTime) : 999;
      if (
        !this.hasPreloadedForCurrentClip &&
        (this.elapsedSeconds >= Math.max(1, this.activeCutoffSec - PRELOAD_LEAD_TIME_SEC) || rawRemainingSec <= 18)
      ) {
        this.hasPreloadedForCurrentClip = true;
        this.preloadNext();
      }

      // Background preloader watchdog: if a preloading video hasn't entered PLAYING (1)
      // within 5.5s in the background, silently skip it and load the next queued video
      // while the current active clip keeps playing uninterrupted on screen.
      if (this.hasPreloadedForCurrentClip && !this.isTransitioning) {
        const inactiveId = this.activePlayerId === 'A' ? 'B' : 'A';
        const inactivePlayer = this.getInactivePlayer();
        try {
          if (inactivePlayer && typeof inactivePlayer.getPlayerState === 'function') {
            const st = inactivePlayer.getPlayerState();
            if (st === 1) {
              if (this.playerStates[inactiveId] !== 1 || this.playingSince[inactiveId] === 0) {
                this.playingSince[inactiveId] = Date.now();
              }
              this.playerStates[inactiveId] = 1;
            } else {
              this.playerStates[inactiveId] = st;
              this.playingSince[inactiveId] = 0;
            }
          }
        } catch (e) {}

        const sincePreload = Date.now() - (this.preloadedAt || Date.now());
        if (this.playerStates[inactiveId] !== 1 && sincePreload >= 5500) {
          console.warn(`Background preloader (${inactiveId}) did not start within 5.5s (state=${this.playerStates[inactiveId]}). Skipping to next background video...`);
          this.preloadNext();
        }
      }

      // Auto-next when elapsed reaches cutoff or video approaches end margin.
      // When isCutoff is reached and the active video is still playing normally (!isNearEnd),
      // we call nextVideo(false) so it NEVER cuts to a long static hold; instead it lets the
      // current clip roll until isInactivePlayerBaked() is true, then zaps cleanly!
      const isCutoff = this.activeCutoffSec > 0 && this.elapsedSeconds >= this.activeCutoffSec;

      if (isNearEnd) {
        this.nextVideo(true);
      } else if (isCutoff) {
        this.nextVideo(false);
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
