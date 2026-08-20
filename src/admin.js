import { catalogManager } from './catalogManager.js';
import { playerEngine } from './playerEngine.js';
import { effectsEngine } from './effectsEngine.js';
import { saveChannelConfig } from './firebase.js';

class AdminController {
  constructor() {
    this.currentChannelId = 'projector-bar';
    this.enabledDecades = ['1980s', '1990s', '2000s'];
    this.enabledCategories = [];
    this.pacingMode = 'channel-surfer';
    this.zapBurstEnabled = true;
    this.commercialMaxSec = 30;
    this.generalClipMaxSec = 60;
    this.randomOffsetEnabled = true;

    this.contrast = 75;
    this.brightness = 110;
    this.opacity = 90;
    this.scanlinesEnabled = true;
    this.staticFXEnabled = true;
    this.washoutEnabled = true;
    this.osdMode = localStorage.getItem('bnsd_osd_mode') || 'crt-header';
    this.tvFrameEnabled = localStorage.getItem('bnsd_tv_frame') === 'true';
  }

  init() {
    window.adminController = this;
    this.bindEvents();
    this.renderDecadeGrid();
    this.renderCategoryGrid();

    // Set initial values
    const selectChannel = document.getElementById('select-channel');
    if (selectChannel) selectChannel.value = this.currentChannelId;

    const selectPacingMode = document.getElementById('select-pacing-mode');
    if (selectPacingMode) selectPacingMode.value = this.pacingMode;

    const chkZapBursts = document.getElementById('chk-zap-bursts');
    if (chkZapBursts) chkZapBursts.checked = this.zapBurstEnabled;

    const chkOffset = document.getElementById('chk-random-offset');
    if (chkOffset) chkOffset.checked = this.randomOffsetEnabled;

    const commInput = document.getElementById('input-commercial-max');
    if (commInput) commInput.value = this.commercialMaxSec;

    const genInput = document.getElementById('input-general-clip-max');
    if (genInput) genInput.value = this.generalClipMaxSec;

    const selectOsdMode = document.getElementById('select-osd-mode');
    if (selectOsdMode) selectOsdMode.value = this.osdMode;

    const chkTvFrame = document.getElementById('chk-enable-tv-frame');
    if (chkTvFrame) chkTvFrame.checked = document.body.classList.contains('trinitron-mode');
  }

  bindEvents() {
    // Close Modal. The projected video screen is intentionally button-free
    // (it's just a wall projection with no input device) — the admin panel
    // is only ever opened via the ?admin=true URL or the 'A' key shortcut
    // below, from a laptop/tablet/keyboard, never from an on-screen control.
    const btnClose = document.getElementById('btn-close-admin');
    const modal = document.getElementById('admin-modal');

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

    // Keyboard Shortcuts (N = Next, O = OSD, W = Washout, A = Admin).
    // No on-screen equivalents by design — see the button-free note above.
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      if (e.key === 'n' || e.key === 'N') playerEngine.nextVideo();
      if (e.key === 'o' || e.key === 'O') document.getElementById('osd-hud')?.classList.toggle('hidden');
      if (e.key === 'w' || e.key === 'W') {
        this.washoutEnabled = !this.washoutEnabled;
        const chkWashout = document.getElementById('chk-enable-washout');
        if (chkWashout) chkWashout.checked = this.washoutEnabled;
        effectsEngine.updateWashoutSettings(this.contrast, this.brightness, this.opacity, this.washoutEnabled);
      }
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

    document.getElementById('select-osd-mode')?.addEventListener('change', (e) => {
      this.osdMode = e.target.value;
      localStorage.setItem('bnsd_osd_mode', this.osdMode);
      if (playerEngine.currentVideoItem) {
        playerEngine.updateOSD(playerEngine.currentVideoItem);
      }
    });

    document.getElementById('chk-enable-tv-frame')?.addEventListener('change', (e) => {
      this.tvFrameEnabled = e.target.checked;
      localStorage.setItem('bnsd_tv_frame', this.tvFrameEnabled ? 'true' : 'false');
      document.body.classList.toggle('trinitron-mode', this.tvFrameEnabled);
    });

    // Pacing Mode Preset Quick Switcher
    document.getElementById('select-pacing-mode')?.addEventListener('change', (e) => {
      this.pacingMode = e.target.value;
      const commInput = document.getElementById('input-commercial-max');
      const genInput = document.getElementById('input-general-clip-max');
      if (this.pacingMode === 'channel-surfer') {
        if (commInput) commInput.value = '25';
        if (genInput) genInput.value = '45';
      } else if (this.pacingMode === 'balanced') {
        if (commInput) commInput.value = '30';
        if (genInput) genInput.value = '60';
      } else if (this.pacingMode === 'deep-cuts') {
        if (commInput) commInput.value = '45';
        if (genInput) genInput.value = '90';
      }
    });

    document.getElementById('chk-zap-bursts')?.addEventListener('change', (e) => {
      this.zapBurstEnabled = e.target.checked;
    });

    // Decade Toolbar Quick Selectors
    document.getElementById('btn-decades-all')?.addEventListener('click', () => {
      document.querySelectorAll('.decade-checkbox').forEach(cb => {
        cb.checked = true;
        cb.closest('.decade-card')?.classList.add('active');
      });
      this.syncDecadeSelection();
    });

    document.getElementById('btn-decades-80s')?.addEventListener('click', () => {
      document.querySelectorAll('.decade-checkbox').forEach(cb => {
        const is80 = cb.value === '1980s';
        cb.checked = is80;
        cb.closest('.decade-card')?.classList.toggle('active', is80);
      });
      this.syncDecadeSelection();
    });

    document.getElementById('btn-decades-90s')?.addEventListener('click', () => {
      document.querySelectorAll('.decade-checkbox').forEach(cb => {
        const is90 = cb.value === '1990s';
        cb.checked = is90;
        cb.closest('.decade-card')?.classList.toggle('active', is90);
      });
      this.syncDecadeSelection();
    });

    document.getElementById('btn-decades-00s')?.addEventListener('click', () => {
      document.querySelectorAll('.decade-checkbox').forEach(cb => {
        const is00 = cb.value === '2000s';
        cb.checked = is00;
        cb.closest('.decade-card')?.classList.toggle('active', is00);
      });
      this.syncDecadeSelection();
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
      const match = val.match(/(?:[?&]v=|\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
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
        this.renderDecadeGrid();
        this.renderCategoryGrid();
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
      if (elCat && data.currentVideo) elCat.textContent = `${data.currentVideo.category} (${data.currentVideo.decade || 'Retro'})`;
      if (elTime) elTime.textContent = `${data.elapsed}s / ${data.cutoff}s`;

      this.updateDeadCountUI();
    };
  }

  syncDecadeSelection() {
    const checkedDecades = [];
    document.querySelectorAll('.decade-checkbox:checked').forEach(cb => {
      checkedDecades.push(cb.value);
    });
    this.enabledDecades = checkedDecades.length > 0 ? checkedDecades : ['1980s', '1990s', '2000s'];
    this.renderCategoryGrid();
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

  renderDecadeGrid() {
    const grid = document.getElementById('decades-grid');
    if (!grid) return;

    const decades = catalogManager.getDecades();
    const yearSubtitles = {
      '1980s': '1980 – 1989',
      '1990s': '1990 – 1999',
      '2000s': '2000 – 2009'
    };

    grid.innerHTML = '';

    decades.forEach(dec => {
      const isChecked = this.enabledDecades.includes(dec.name);

      const card = document.createElement('label');
      card.className = `decade-card ${isChecked ? 'active' : ''}`;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = dec.name;
      cb.className = 'decade-checkbox';
      cb.checked = isChecked;

      const group = document.createElement('div');
      group.className = 'decade-label-group';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'decade-name';
      nameSpan.textContent = dec.name;

      const yearsSpan = document.createElement('span');
      yearsSpan.className = 'decade-years';
      yearsSpan.textContent = yearSubtitles[dec.name] || 'Retro Era';

      group.append(nameSpan, yearsSpan);

      const countSpan = document.createElement('span');
      countSpan.className = 'decade-count';
      countSpan.textContent = `${dec.count.toLocaleString()} streams`;

      card.append(cb, group, countSpan);

      cb.addEventListener('change', (e) => {
        card.classList.toggle('active', e.target.checked);
        this.syncDecadeSelection();
      });

      grid.appendChild(card);
    });
  }

  renderCategoryGrid() {
    const grid = document.getElementById('categories-grid');
    if (!grid) return;

    // Read active decade filters to show accurate stream counts
    const categories = catalogManager.getCategories(this.enabledDecades);
    grid.innerHTML = '';

    categories.forEach(cat => {
      const isChecked = this.enabledCategories.length === 0 || this.enabledCategories.includes(cat.name);

      const card = document.createElement('label');
      card.className = `cat-card ${isChecked ? 'active' : ''}`;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = cat.name;
      cb.className = 'cat-checkbox';
      cb.checked = isChecked;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'cat-name';
      nameSpan.textContent = cat.name;

      const countSpan = document.createElement('span');
      countSpan.className = 'cat-count';
      countSpan.textContent = `(${cat.count.toLocaleString()})`;

      card.append(cb, nameSpan, countSpan);

      cb.addEventListener('change', (e) => {
        card.classList.toggle('active', e.target.checked);
      });

      grid.appendChild(card);
    });

    const totalEl = document.getElementById('cat-total-count');
    if (totalEl) totalEl.textContent = catalogManager.allVideos.length.toLocaleString();

    this.updateDeadCountUI();
  }

  /**
   * Apply settings, save to Firestore/LocalStorage, and regenerate channel queue
   */
  applyAndRefreshStream() {
    // Read decade checkboxes
    const checkedDecades = [];
    document.querySelectorAll('.decade-checkbox:checked').forEach(cb => {
      checkedDecades.push(cb.value);
    });
    this.enabledDecades = checkedDecades.length > 0 ? checkedDecades : ['1980s', '1990s', '2000s'];

    // Read category checkboxes
    const checkedCats = [];
    document.querySelectorAll('.cat-checkbox:checked').forEach(cb => {
      checkedCats.push(cb.value);
    });
    this.enabledCategories = checkedCats;

    // Read pacing inputs
    const pacingSelect = document.getElementById('select-pacing-mode');
    const zapChk = document.getElementById('chk-zap-bursts');
    const commInput = document.getElementById('input-commercial-max');
    const genInput = document.getElementById('input-general-clip-max');
    const offsetChk = document.getElementById('chk-random-offset');

    if (pacingSelect) this.pacingMode = pacingSelect.value;
    if (zapChk) this.zapBurstEnabled = zapChk.checked;
    if (commInput) this.commercialMaxSec = parseInt(commInput.value, 10) || 30;
    if (genInput) this.generalClipMaxSec = parseInt(genInput.value, 10) || 60;
    if (offsetChk) this.randomOffsetEnabled = offsetChk.checked;

    playerEngine.updatePacingRules(
      this.commercialMaxSec,
      this.generalClipMaxSec,
      this.randomOffsetEnabled,
      this.pacingMode,
      this.zapBurstEnabled
    );

    // Save channel configuration
    const configData = {
      channelId: this.currentChannelId,
      enabledDecades: this.enabledDecades,
      enabledCategories: this.enabledCategories,
      pacingMode: this.pacingMode,
      zapBurstEnabled: this.zapBurstEnabled,
      commercialMaxSec: this.commercialMaxSec,
      generalClipMaxSec: this.generalClipMaxSec,
      randomOffsetEnabled: this.randomOffsetEnabled,
      contrast: this.contrast,
      brightness: this.brightness,
      opacity: this.opacity,
      scanlinesEnabled: this.scanlinesEnabled,
      staticFXEnabled: this.staticFXEnabled,
      washoutEnabled: this.washoutEnabled,
      osdMode: this.osdMode
    };

    saveChannelConfig(this.currentChannelId, configData);

    // Generate new desynchronized channel queue filtered by decades AND categories
    const queue = catalogManager.generateChannelQueue(this.currentChannelId, this.enabledCategories, this.enabledDecades);
    document.getElementById('tel-queue-count').textContent = `${queue.length.toLocaleString()} videos`;
    document.getElementById('tel-channel-id').textContent = this.currentChannelId;

    playerEngine.startStream(queue, 0);
  }
}

export const adminController = new AdminController();
