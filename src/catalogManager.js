import Papa from 'papaparse';
import { DEFAULT_90S_CATALOG } from './catalogData.js';

class CatalogManager {
  constructor() {
    this.allVideos = [];
    this.categoriesMap = new Map(); // Category Name -> Array of Video Objects
    this.isLoaded = false;
    this.deadVideoIds = new Set();
    this.deadVideoDetails = new Map();

    this.loadDeadVideoFlags();
  }

  /**
   * Load stored dead video IDs from localStorage
   */
  loadDeadVideoFlags() {
    try {
      const raw = localStorage.getItem('bnsd_dead_video_ids');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.deadVideoIds = new Set(parsed.map(item => typeof item === 'string' ? item : item.videoId));
        }
      }
    } catch (e) {
      console.warn("Could not load dead video flags:", e);
    }
  }

  /**
   * Save dead video IDs to localStorage
   */
  saveDeadVideoFlags() {
    try {
      localStorage.setItem('bnsd_dead_video_ids', JSON.stringify(Array.from(this.deadVideoIds)));
    } catch (e) {
      console.warn("Could not save dead video flags:", e);
    }
  }

  /**
   * Flag a video as dead (quarantine without deleting from original CSV)
   */
  markVideoDead(videoId, title = '') {
    if (!videoId) return;
    this.deadVideoIds.add(videoId);
    this.deadVideoDetails.set(videoId, { videoId, title, timestamp: new Date().toISOString() });
    this.saveDeadVideoFlags();

    // Remove from active in-memory catalog so it never plays again
    this.allVideos = this.allVideos.filter(v => v.videoId !== videoId);
    for (const [cat, list] of this.categoriesMap.entries()) {
      this.categoriesMap.set(cat, list.filter(v => v.videoId !== videoId));
    }
    console.log(`Flagged video as dead/unavailable: ${videoId} (${title}). Remaining active catalog: ${this.allVideos.length} videos.`);
  }

  /**
   * Clear all dead video flags (restore quarantined videos)
   */
  clearDeadVideoFlags() {
    this.deadVideoIds.clear();
    this.deadVideoDetails.clear();
    localStorage.removeItem('bnsd_dead_video_ids');
    console.log("Cleared all dead video flags.");
  }

  /**
   * Export dead videos list to downloadable CSV
   */
  exportDeadVideosCSV() {
    let csv = "video_id,flagged_at\n";
    this.deadVideoIds.forEach(id => {
      csv += `"${id}","${new Date().toISOString()}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bnsd_dead_videos_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Load catalog from bundled JavaScript data array (cache-proof)
   */
  async loadCSV(csvUrlOrPath = '/90s_playlist.csv') {
    try {
      if (Array.isArray(DEFAULT_90S_CATALOG) && DEFAULT_90S_CATALOG.length > 0) {
        this.ingestArrayData(DEFAULT_90S_CATALOG);
        return true;
      }
      const response = await fetch(csvUrlOrPath + '?v=' + Date.now());
      const csvText = await response.text();
      return this.parseCSVText(csvText);
    } catch (err) {
      console.error("Failed to load CSV:", err);
      return false;
    }
  }

  /**
   * Ingest array of video records directly
   */
  ingestArrayData(dataArray) {
    this.allVideos = [];
    this.categoriesMap.clear();

    dataArray.forEach((row, idx) => {
      const videoId = row.video_id ? row.video_id.trim() : null;
      if (!videoId) return;

      const item = {
        id: idx + 1,
        decade: row.decade ? row.decade.trim() : '1990s',
        year: row.year ? row.year.trim() : '1995',
        category: row.channel ? row.channel.trim() : 'Commercials',
        videoId: videoId,
        title: row.title ? row.title.trim() : `90s Video ${idx + 1}`,
        startSec: parseInt(row.start_seconds) || 0,
        endSec: parseInt(row.end_seconds) || 0
      };

      this.allVideos.push(item);

      const catName = item.category.toUpperCase();
      if (!this.categoriesMap.has(catName)) {
        this.categoriesMap.set(catName, []);
      }
      this.categoriesMap.get(catName).push(item);
    });

    this.isLoaded = true;
    console.log(`Ingested ${this.allVideos.length} bundled videos across ${this.categoriesMap.size} categories.`);
  }

  /**
   * Parse CSV text content using PapaParse
   */
  parseCSVText(csvText) {
    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
    });

    if (parsed.errors && parsed.errors.length > 0) {
      console.warn("CSV parsing notices:", parsed.errors);
    }

    this.allVideos = [];
    this.categoriesMap.clear();

    parsed.data.forEach((row, idx) => {
      const videoId = row.video_id ? row.video_id.trim() : null;
      if (!videoId) return;

      const category = row.channel ? row.channel.trim() : 'Other';
      const decade = row.decade ? row.decade.trim() : '1990s';
      const year = row.year ? row.year.trim() : '';
      const title = row.title ? row.title.trim() : `${category} (${year || decade})`;
      const startSec = row.start_seconds ? parseInt(row.start_seconds, 10) : 0;
      const endSec = row.end_seconds ? parseInt(row.end_seconds, 10) : 0;

      const item = {
        id: idx,
        videoId,
        category,
        decade,
        year,
        title,
        startSec: isNaN(startSec) ? 0 : startSec,
        endSec: isNaN(endSec) ? 0 : endSec
      };

      this.allVideos.push(item);

      if (!this.categoriesMap.has(category)) {
        this.categoriesMap.set(category, []);
      }
      this.categoriesMap.get(category).push(item);
    });

    this.isLoaded = true;
    console.log(`Indexed ${this.allVideos.length} videos across ${this.categoriesMap.size} categories.`);
    return true;
  }

  /**
   * Get all unique categories with video counts
   */
  getCategories() {
    const list = [];
    for (const [name, items] of this.categoriesMap.entries()) {
      list.push({
        name,
        count: items.length
      });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Generate a desynchronized random shuffle queue for a given projector channel ID
   */
  generateChannelQueue(channelId, enabledCategories = []) {
    if (this.allVideos.length === 0) return [];

    const categoryList = enabledCategories.length > 0 ? enabledCategories : Array.from(this.categoriesMap.keys());
    const allowedUpper = new Set(categoryList.map(c => String(c).toUpperCase()));

    // Filter videos by enabled categories AND exclude dead flagged videos
    const pool = this.allVideos.filter(item => allowedUpper.has(String(item.category).toUpperCase()) && !this.deadVideoIds.has(item.videoId));
    console.log(`Generated queue for ${channelId}: ${pool.length} videos available in pool.`);

    if (pool.length === 0) return [];

    // Truly randomized Fisher-Yates shuffle per session
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled;
  }

  /**
   * Hash channel string to numerical seed
   */
  hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 33) ^ str.charCodeAt(i);
    }
    return Math.abs(hash);
  }
}

export const catalogManager = new CatalogManager();
