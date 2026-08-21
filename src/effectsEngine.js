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
  }

  init() {
    this.canvas = document.getElementById('crt-static-canvas');
    if (!this.canvas) return;

    this.ctx = this.canvas.getContext('2d');
    this.resizeCanvas();

    window.addEventListener('resize', () => this.resizeCanvas());
  }

  resizeCanvas() {
    if (!this.canvas) return;
    this.canvas.width = Math.floor(window.innerWidth / 2);
    this.canvas.height = Math.floor(window.innerHeight / 2);
  }

  /**
   * Render noise frame on canvas
   */
  renderNoiseFrame() {
    if (!this.ctx || !this.isStaticActive) return;

    const w = this.canvas.width;
    const h = this.canvas.height;
    const imgData = this.ctx.createImageData(w, h);
    const buffer = new Uint32Array(imgData.data.buffer);

    const len = buffer.length;
    for (let i = 0; i < len; i++) {
      // Generate random white/gray static noise pixel
      const color = Math.floor(Math.random() * 255);
      // Format 0xAABBGGRR
      buffer[i] = (255 << 24) | (color << 16) | (color << 8) | color;
    }

    this.ctx.putImageData(imgData, 0, 0);

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
   * Displays vintage cathode ray tube static noise while initial YouTube player connects & buffers in the dark.
   */
  triggerWarmup(durationMs = 4200, onComplete = null) {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.isStaticActive = true;
    if (this.canvas) {
      this.canvas.classList.add('active');
    }

    this.renderNoiseFrame();

    // After warmup duration, snap static off and reveal running broadcast
    setTimeout(() => {
      this.isStaticActive = false;
      if (this.canvas) {
        this.canvas.classList.remove('active');
      }
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
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
