class EffectsEngine {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.animationFrameId = null;
    this.isStaticActive = false;
    this.scanlinesEnabled = true;
    this.staticFXEnabled = true;
    this.washoutEnabled = true;

    // Washout levels
    this.contrast = 75;
    this.brightness = 110;
    this.opacity = 90;

    // Pre-allocated noise frame cache for smooth, low-CPU CRT glitches
    this.noiseFrames = [];
    this.noiseFrameIndex = 0;
  }

  init() {
    this.canvas = document.getElementById('crt-static-canvas');
    if (!this.canvas) return;

    this.ctx = this.canvas.getContext('2d');
    this.resizeCanvas();
    this.initNoiseCache();

    window.addEventListener('resize', () => {
      this.resizeCanvas();
      this.initNoiseCache();
    });
  }

  resizeCanvas() {
    if (!this.canvas) return;
    this.canvas.width = Math.floor(window.innerWidth / 2);
    this.canvas.height = Math.floor(window.innerHeight / 2);
  }

  /**
   * Pre-render a pool of authentic CRT static noise frames
   * to eliminate memory allocation and CPU load during 60fps rendering.
   */
  initNoiseCache() {
    if (!this.ctx || !this.canvas) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w <= 0 || h <= 0) return;

    this.noiseFrames = [];
    this.noiseFrameIndex = 0;
    const numFrames = 8;

    for (let f = 0; f < numFrames; f++) {
      const imgData = this.ctx.createImageData(w, h);
      const buffer = new Uint32Array(imgData.data.buffer);
      const len = buffer.length;
      for (let i = 0; i < len; i++) {
        const color = Math.floor(Math.random() * 255);
        buffer[i] = (255 << 24) | (color << 16) | (color << 8) | color;
      }
      this.noiseFrames.push(imgData);
    }
  }

  /**
   * Render noise frame on canvas by cycling pre-computed buffers
   */
  renderNoiseFrame() {
    if (!this.ctx || !this.isStaticActive) return;

    if (this.noiseFrames.length > 0) {
      const frame = this.noiseFrames[this.noiseFrameIndex];
      this.ctx.putImageData(frame, 0, 0);
      this.noiseFrameIndex = (this.noiseFrameIndex + 1) % this.noiseFrames.length;
    }

    if (this.isStaticActive) {
      this.animationFrameId = requestAnimationFrame(() => this.renderNoiseFrame());
    }
  }

  /**
   * Trigger CRT channel switch static glitch (duration: 150ms - 300ms)
   */
  triggerChannelSwitch(durationMs = 250, onPeak = null) {
    if (!this.staticFXEnabled) {
      if (onPeak) onPeak();
      return;
    }

    // Clear any active static timeouts/frames to prevent overlapping animations or canvas lockup
    clearTimeout(this.staticPeakTimeout);
    clearTimeout(this.staticEndTimeout);
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.isStaticActive = true;
    if (this.canvas) {
      this.canvas.classList.add('active');
    }

    this.renderNoiseFrame();

    // Execute video switch callback halfway through static burst
    this.staticPeakTimeout = setTimeout(() => {
      if (onPeak) onPeak();
    }, Math.floor(durationMs / 2));

    // Hide static canvas and stop noise animation frame
    this.staticEndTimeout = setTimeout(() => {
      this.isStaticActive = false;
      if (this.canvas) {
        this.canvas.classList.remove('active');
      }
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
      }
    }, durationMs);
  }

  /**
   * Trigger CRT Power-On Warmup & Tuning Sequence (Initial Boot / Refresh)
   * Displays centered BNSD TV header, vintage cathode ray turn-on beam & deep blue screen with glowing phosphor green OSD.
   */
  triggerWarmup(durationMs = 5800, channelNum = '03', onComplete = null) {
    const poweronOverlay = document.getElementById('crt-poweron-overlay');
    const subLabel = document.getElementById('poweron-channel-sub');
    const statusMsg = document.getElementById('poweron-status-msg');
    const meterEl = document.getElementById('poweron-meter');

    if (subLabel) {
      subLabel.textContent = `CH ${channelNum} • STEREO • VIDEO 1`;
    }

    if (statusMsg) {
      statusMsg.textContent = 'WARMING UP CATHODE TUBE...';
    }

    if (meterEl) {
      meterEl.textContent = '[ ■■■■□□□□□□□□ ]';
    }

    if (poweronOverlay) {
      poweronOverlay.classList.add('active');
    }

    // Step 2: 2.0s - Acquiring Signal
    const t1 = setTimeout(() => {
      if (statusMsg) statusMsg.textContent = 'ACQUIRING BROADCAST SIGNAL...';
      if (meterEl) meterEl.textContent = '[ ■■■■■■■■□□□□ ]';
    }, 2000);

    // Step 3: 3.9s - Taking You Back
    const t2 = setTimeout(() => {
      if (statusMsg) statusMsg.textContent = 'TAKING YOU BACK...';
      if (meterEl) meterEl.textContent = '[ ■■■■■■■■■■■■ ]';
    }, 3900);

    // After warmup duration, smoothly dissolve the power-on screen and reveal running stream
    setTimeout(() => {
      clearTimeout(t1);
      clearTimeout(t2);
      if (poweronOverlay) {
        poweronOverlay.classList.remove('active');
      }
      if (onComplete) onComplete();
    }, durationMs);
  }

  /**
   * Update Projection Washout Filter
   */
  updateWashoutSettings(contrast, brightness, opacity, enabled = true) {
    this.contrast = contrast;
    this.brightness = brightness;
    this.opacity = opacity;
    this.washoutEnabled = enabled;

    const container = document.getElementById('projection-container');
    if (!container) return;

    if (!enabled) {
      container.classList.add('disabled');
      return;
    }

    container.classList.remove('disabled');
    container.style.setProperty('--washout-contrast', `${contrast}%`);
    container.style.setProperty('--washout-brightness', `${brightness}%`);
    container.style.setProperty('--washout-opacity', opacity / 100);
  }

  /**
   * Toggle scanlines
   */
  toggleScanlines(enabled) {
    this.scanlinesEnabled = enabled;
    const scanlines = document.querySelector('.crt-scanlines');
    if (scanlines) {
      if (enabled) {
        scanlines.classList.remove('hidden');
      } else {
        scanlines.classList.add('hidden');
      }
    }
  }
}

export const effectsEngine = new EffectsEngine();
