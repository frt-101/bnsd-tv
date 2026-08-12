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

    this.playerA = new window.YT.Player('player-a', {
      events: {
        onReady: checkReady,
        onStateChange: (e) => this.handlePlayerStateChange('A', e),
        onError: (e) => this.handlePlayerError('A', e)
      }
    });

    this.playerB = new window.YT.Player('player-b', {
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

    this.currentVideoItem = this.queue[this.currentIndex];
    const activePlayer = this.getActivePlayer();
    const inactivePlayer = this.getInactivePlayer();

    // Determine smart clip duration and start offset
    const { startSec, maxDurationSec } = this.calculateSmartClip(this.currentVideoItem);
    this.activeCutoffSec = maxDurationSec;
    this.elapsedSeconds = 0;

    // Load active video on active player
    if (activePlayer && typeof activePlayer.loadVideoById === 'function') {
      try {
        activePlayer.loadVideoById(this.currentVideoItem.videoId, startSec);
        activePlayer.mute();
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
    const nextIndex = (this.currentIndex + 1) % this.queue.length;
    const nextItem = this.queue[nextIndex];
    if (nextItem) {
      const nextClip = this.calculateSmartClip(nextItem);
      if (inactivePlayer && typeof inactivePlayer.cueVideoById === 'function') {
        try {
          inactivePlayer.cueVideoById(nextItem.videoId, nextClip.startSec);
          inactivePlayer.mute();
        } catch (e) {}
      } else {
        const inactiveId = this.activePlayerId === 'A' ? 'player-b' : 'player-a';
        const nextIframe = document.getElementById(inactiveId);
        if (nextIframe) {
          nextIframe.src = `https://www.youtube.com/embed/${nextItem.videoId}?enablejsapi=1&autoplay=1&mute=1&controls=0&playsinline=1&cc_load_policy=0&iv_load_policy=3&modestbranding=1&rel=0&start=${nextClip.startSec}`;
        }
      }
    }

    // Start clip timing monitor
    this.startClipTimer();
  }

  /**
   * Calculate smart clip duration and start offset based on category
   */
  calculateSmartClip(videoItem) {
    if (!videoItem) return { startSec: 0, maxDurationSec: 90 };

    const isCommercial = videoItem.category.toLowerCase() === 'commercials';
    let maxDurationSec = isCommercial ? this.commercialMaxSec : this.generalClipMaxSec;
    let startSec = videoItem.startSec || 0;

    // Random highlights jump for non-commercials if enabled
    if (!isCommercial && this.randomOffsetEnabled && startSec === 0) {
      // Pick random start offset between 10s and 60s
      startSec = Math.floor(Math.random() * 50) + 10;
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

      // Increment queue index
      this.currentIndex = (this.currentIndex + 1) % this.queue.length;

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
   * Auto-skip unavailable, private, or non-embeddable YouTube videos
   */
  handlePlayerError(playerId, event) {
    // IGNORE errors from inactive background preloader
    if (playerId !== this.activePlayerId) {
      console.warn(`Inactive background player ${playerId} notice (error ${event.data}). Ignoring.`);
      console.log(`Preloader Player ${playerId} hit unplayable video. Preloading replacement video...`);
      const replacementIndex = (this.currentIndex + 2) % this.queue.length;
      const replacementItem = this.queue[replacementIndex];
      if (replacementItem) {
        const inactivePlayer = this.getInactivePlayer();
        const clip = this.calculateSmartClip(replacementItem);
        if (inactivePlayer && typeof inactivePlayer.cueVideoById === 'function') {
          try {
            inactivePlayer.cueVideoById(replacementItem.videoId, clip.startSec);
            inactivePlayer.mute();
          } catch (e) {}
        }
      }
      return;
    }

    // Flag current active video as dead/quarantined in localStorage
    if (this.currentVideoItem) {
      catalogManager.markVideoDead(this.currentVideoItem.videoId, this.currentVideoItem.title);
    }

    this.consecutiveErrorCount = (this.consecutiveErrorCount || 0) + 1;
    console.warn(`Active player error (${event.data}). Consecutive error count: ${this.consecutiveErrorCount}`);

    // If 3 consecutive errors occur, fast-forward 5 steps ahead in queue without static glitch
    if (this.consecutiveErrorCount >= 3) {
      console.warn("Multiple consecutive video errors. Fast-forwarding queue...");
      this.consecutiveErrorCount = 0;
      this.currentIndex = (this.currentIndex + 5) % this.queue.length;
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
  updateOSD(videoItem) {
    const catLabel = document.getElementById('osd-category-label');
    const titleLabel = document.getElementById('osd-title-label');
    const eraLabel = document.getElementById('osd-era-badge');

    if (catLabel) catLabel.textContent = (videoItem.category || 'VINTAGE STREAM').toUpperCase();
    if (titleLabel) titleLabel.textContent = videoItem.title || 'BNSD TV Stream';
    if (eraLabel) eraLabel.textContent = videoItem.decade || '1990s';

    // Pulse OSD visible for 5 seconds when video changes
    const hud = document.getElementById('osd-hud');
    if (hud) {
      hud.classList.remove('hidden');
      clearTimeout(this.osdHideTimeout);
      this.osdHideTimeout = setTimeout(() => {
        hud.classList.add('hidden');
      }, 5000);
    }
  }

  updatePacingRules(commercialMax, generalMax, randomOffset) {
    this.commercialMaxSec = commercialMax;
    this.generalClipMaxSec = generalMax;
    this.randomOffsetEnabled = randomOffset;
  }
}

export const playerEngine = new PlayerEngine();
