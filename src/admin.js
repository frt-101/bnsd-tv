import { catalogManager } from './catalogManager.js';
import { playerEngine } from './playerEngine.js';
import { effectsEngine } from './effectsEngine.js';
import { saveChannelConfig } from './firebase.js';

class AdminController {
  constructor() {
    this.currentChannelId = 'projector-bar';
    this.enabledCategories = [];
    this.commercialMaxSec = 45;
    this.generalClipMaxSec = 90;
    this.randomOffsetEnabled = true;

    this.contrast = 75;
    this.brightness = 110;
    this.opacity = 90;
    this.scanlinesEnabled = true;
    this.staticFXEnabled = true;
    this.washoutEnabled = true;
  }

  init() {
    this.bindEvents();
    this.renderCategoryGrid();

    // Set initial values
    const selectChannel = document.getElementById('select-channel');
    if (selectChannel) selectChannel.value = this.currentChannelId;
  }

  bindEvents() {
    // Open/Close Modal
    const btnOpen = document.getElementById('btn-open-admin');
    const btnClose = document.getElementById('btn-close-admin');
    const modal = document.getElementById('admin-modal');

    if (btnOpen && modal) {
      btnOpen.addEventListener('click', () => modal.classList.remove('hidden'));
    }
    if (btnClose && modal) {
      btnClose.addEventListener('click', () => modal.classList.add('hidden'));
    }

    // Tab Navigation
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        const targetTab = e.target.getAttribute('data-tab');
        tabs.forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        e.target.classList.add('active');
        const content = document.getElementById(targetTab);
        if (content) content.classList.add('active');
      });
    });

    // Quick Controls Bar
    document.getElementById('btn-next-video')?.addEventListener('click', () => {
      playerEngine.nextVideo();
    });

    document.getElementById('btn-toggle-osd')?.addEventListener('click', () => {
      const hud = document.getElementById('osd-hud');
      if (hud) hud.classList.toggle('hidden');
    });

    document.getElementById('btn-toggle-washout')?.addEventListener('click', () => {
      this.washoutEnabled = !this.washoutEnabled;
      const chkWashout = document.getElementById('chk-enable-washout');
      if (chkWashout) chkWashout.checked = this.washoutEnabled;
      effectsEngine.updateWashoutSettings(this.contrast, this.brightness, this.opacity, this.washoutEnabled);
    });

    // Keyboard Shortcuts (N = Next, O = OSD, W = Washout, A = Admin)
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      if (e.key === 'n' || e.key === 'N') playerEngine.nextVideo();
      if (e.key === 'o' || e.key === 'O') document.getElementById('osd-hud')?.classList.toggle('hidden');
      if (e.key === 'w' || e.key === 'W') document.getElementById('btn-toggle-washout')?.click();
      if (e.key === 'a' || e.key === 'A') modal?.classList.toggle('hidden');
    });

    // Range Sliders Input Sync
    this.bindRange('range-contrast', 'val-contrast', (val) => {
      this.contrast = parseInt(val, 10);
      effectsEngine.updateWashoutSettings(this.contrast, this.brightness, this.opacity, this.washoutEnabled);
    });

    this.bindRange('range-brightness', 'val-brightness', (val) => {
      this.brightness = parseInt(val, 10);
      effectsEngine.updateWashoutSettings(this.contrast, this.brightness, this.opacity, this.washoutEnabled);
    });

    this.bindRange('range-opacity', 'val-opacity', (val) => {
      this.opacity = parseInt(val, 10);
      effectsEngine.updateWashoutSettings(this.contrast, this.brightness, this.opacity, this.washoutEnabled);
    });

    // Checkboxes
    document.getElementById('chk-enable-washout')?.addEventListener('change', (e) => {
      this.washoutEnabled = e.target.checked;
      effectsEngine.updateWashoutSettings(this.contrast, this.brightness, this.opacity, this.washoutEnabled);
    });

    document.getElementById('chk-enable-scanlines')?.addEventListener('change', (e) => {
      this.scanlinesEnabled = e.target.checked;
      effectsEngine.toggleScanlines(this.scanlinesEnabled);
    });

    document.getElementById('chk-enable-static-fx')?.addEventListener('change', (e) => {
      this.staticFXEnabled = e.target.checked;
      effectsEngine.staticFXEnabled = this.staticFXEnabled;
    });

    // Category Toolbar
    document.getElementById('btn-select-all-cats')?.addEventListener('click', () => {
      document.querySelectorAll('.cat-checkbox').forEach(cb => {
        cb.checked = true;
        cb.closest('.cat-card').classList.add('active');
      });
    });

    document.getElementById('btn-deselect-all-cats')?.addEventListener('click', () => {
      document.querySelectorAll('.cat-checkbox').forEach(cb => {
        cb.checked = false;
        cb.closest('.cat-card').classList.remove('active');
      });
    });

    // Direct YouTube Video Tester
    document.getElementById('btn-play-test-url')?.addEventListener('click', () => {
      const input = document.getElementById('input-test-url');
      const val = input ? input.value.trim() : '';
      if (!val) return;

      let vid = val;
      const match = val.match(/(?:v=|\/embed\/|\/watch\?v=||youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      if (match && match[1]) {
        vid = match[1];
      }

      const testItem = {
        id: 99999,
        videoId: vid,
        category: 'Test Stream',
        decade: '1990s',
        year: '1995',
        title: `Custom Test Video (${vid})`,
        startSec: 0,
        endSec: 0
      };

      playerEngine.startStream([testItem], 0);
      document.getElementById('admin-modal')?.classList.add('hidden');
    });

    // Channel Selection Dropdown Change
    document.getElementById('select-channel')?.addEventListener('change', (e) => {
      this.currentChannelId = e.target.value;
      document.getElementById('tel-channel-id').textContent = this.currentChannelId;
      document.getElementById('osd-channel-label').textContent = `CH ${this.getChannelNum(this.currentChannelId)} • BNSD TV`;
      this.applyAndRefreshStream();
    });

    // Dead Video Quarantine Controls
    document.getElementById('btn-export-dead')?.addEventListener('click', () => {
      catalogManager.exportDeadVideosCSV();
    });

    document.getElementById('btn-clear-dead')?.addEventListener('click', () => {
      if (confirm("Are you sure you want to clear all dead video flags and restore them to active streams?")) {
        catalogManager.clearDeadVideoFlags();
        this.updateDeadCountUI();
        this.applyAndRefreshStream();
        alert("Cleared all dead video flags!");
      }
    });

    // CSV File Re-upload
    document.getElementById('input-csv-file')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const text = await file.text();
      if (catalogManager.parseCSVText(text)) {
        this.renderCategoryGrid();
        document.getElementById('cat-total-count').textContent = catalogManager.allVideos.length;
        alert(`Successfully ingested CSV file! Indexed ${catalogManager.allVideos.length} videos.`);
        this.applyAndRefreshStream();
      }
    });

    // Save & Apply Settings Button
    document.getElementById('btn-save-settings')?.addEventListener('click', () => {
      this.applyAndRefreshStream();
      modal?.classList.add('hidden');
    });

    // Telemetry Progress Listener
    playerEngine.onProgressCallback = (data) => {
      const elCurrent = document.getElementById('tel-current-video');
      const elCat = document.getElementById('tel-current-cat');
      const elTime = document.getElementById('tel-time-info');

      if (elCurrent && data.currentVideo) elCurrent.textContent = data.currentVideo.title;
      if (elCat && data.currentVideo) elCat.textContent = data.currentVideo.category;
      if (elTime) elTime.textContent = `${data.elapsed}s / ${data.cutoff}s`;

      this.updateDeadCountUI();
    };
  }

  updateDeadCountUI() {
    const elDead = document.getElementById('cat-dead-count');
    if (elDead) {
      elDead.textContent = catalogManager.deadVideoIds.size;
    }
  }

  bindRange(rangeId, labelId, onChange) {
    const range = document.getElementById(rangeId);
    const label = document.getElementById(labelId);
    if (range && label) {
      range.addEventListener('input', (e) => {
        label.textContent = e.target.value;
        onChange(e.target.value);
      });
    }
  }

  getChannelNum(str) {
    if (str.includes('bar')) return '01';
    if (str.includes('dining')) return '02';
    if (str.includes('lounge')) return '03';
    if (str.includes('patio')) return '04';
    return '05';
  }

  renderCategoryGrid() {
    const grid = document.getElementById('categories-grid');
    if (!grid) return;

    const categories = catalogManager.getCategories();
    grid.innerHTML = '';

    categories.forEach(cat => {
      const isChecked = this.enabledCategories.length === 0 || this.enabledCategories.includes(cat.name);

      const card = document.createElement('label');
      card.className = `cat-card ${isChecked ? 'active' : ''}`;
      card.innerHTML = `
        <input type="checkbox" value="${cat.name}" class="cat-checkbox" ${isChecked ? 'checked' : ''}>
        <span class="cat-name">${cat.name}</span>
        <span class="cat-count">(${cat.count})</span>
      `;

      const cb = card.querySelector('.cat-checkbox');
      cb.addEventListener('change', (e) => {
        if (e.target.checked) {
          card.classList.add('active');
        } else {
          card.classList.remove('active');
        }
      });

      grid.appendChild(card);
    });

    const totalEl = document.getElementById('cat-total-count');
    if (totalEl) totalEl.textContent = catalogManager.allVideos.length;

    this.updateDeadCountUI();
  }

  /**
   * Apply settings, save to Firestore/LocalStorage, and regenerate channel queue
   */
  applyAndRefreshStream() {
    // Read category checkboxes
    const checkedCats = [];
    document.querySelectorAll('.cat-checkbox:checked').forEach(cb => {
      checkedCats.push(cb.value);
    });
    this.enabledCategories = checkedCats;

    // Read pacing inputs
    const commInput = document.getElementById('input-commercial-max');
    const genInput = document.getElementById('input-general-clip-max');
    const offsetChk = document.getElementById('chk-random-offset');

    if (commInput) this.commercialMaxSec = parseInt(commInput.value, 10) || 45;
    if (genInput) this.generalClipMaxSec = parseInt(genInput.value, 10) || 90;
    if (offsetChk) this.randomOffsetEnabled = offsetChk.checked;

    playerEngine.updatePacingRules(this.commercialMaxSec, this.generalClipMaxSec, this.randomOffsetEnabled);

    // Save channel configuration
    const configData = {
      channelId: this.currentChannelId,
      enabledCategories: this.enabledCategories,
      commercialMaxSec: this.commercialMaxSec,
      generalClipMaxSec: this.generalClipMaxSec,
      randomOffsetEnabled: this.randomOffsetEnabled,
      contrast: this.contrast,
      brightness: this.brightness,
      opacity: this.opacity,
      scanlinesEnabled: this.scanlinesEnabled,
      staticFXEnabled: this.staticFXEnabled,
      washoutEnabled: this.washoutEnabled
    };

    saveChannelConfig(this.currentChannelId, configData);

    // Generate new desynchronized channel queue
    const queue = catalogManager.generateChannelQueue(this.currentChannelId, this.enabledCategories);
    document.getElementById('tel-queue-count').textContent = `${queue.length} videos`;
    document.getElementById('tel-channel-id').textContent = this.currentChannelId;

    playerEngine.startStream(queue, 0);
  }
}

export const adminController = new AdminController();
