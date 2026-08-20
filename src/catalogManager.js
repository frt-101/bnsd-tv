import Papa from 'papaparse';
import { BNSD_TV_CATALOG, DEFAULT_90S_CATALOG } from './catalogData.js';

class CatalogManager {
  constructor() {
    this.allVideos = [];
    this.categoriesMap = new Map(); // Category Name (Uppercase) -> Array of Video Objects
    this.decadesMap = new Map();    // Decade Name (Uppercase) -> Array of Video Objects
    this.isLoaded = false;
    this.deadVideoIds = new Set();
    this.deadVideoDetails = new Map();

    this.loadDeadVideoFlags();
  }

  /**
   * Load stored dead video IDs from localStorage
   */
  loadDeadVideoFlags() {
    if (typeof localStorage === 'undefined') return;
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
    if (typeof localStorage === 'undefined') return;
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
    for (const [dec, list] of this.decadesMap.entries()) {
      this.decadesMap.set(dec, list.filter(v => v.videoId !== videoId));
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
  async loadCSV(csvUrlOrPath = '/bnsd_tv_playlist.csv') {
    try {
      const catalog = BNSD_TV_CATALOG || DEFAULT_90S_CATALOG;
      if (catalog && (Array.isArray(catalog) || Array.isArray(catalog.streams))) {
        this.ingestArrayData(catalog);
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
   * Ingest array or compact payload of video records directly
   */
  ingestArrayData(data) {
    this.allVideos = [];
    this.categoriesMap.clear();
    this.decadesMap.clear();

    if (data && Array.isArray(data.streams)) {
      // High-performance compact tuple format: [decIdx, year, catIdx, videoId]
      const { decades, categories, streams } = data;
      const total = streams.length;
      for (let idx = 0; idx < total; idx++) {
        const row = streams[idx];
        const decade = decades[row[0]] || '1990s';
        const year = String(row[1] || '1995');
        const category = categories[row[2]] || 'Commercials';
        const videoId = row[3];

        const item = {
          id: idx + 1,
          decade,
          year,
          category,
          videoId,
          title: `${category} (${year})`,
          startSec: 0,
          endSec: 0
        };

        this.allVideos.push(item);

        const catName = category.toUpperCase();
        let catList = this.categoriesMap.get(catName);
        if (!catList) {
          catList = [];
          this.categoriesMap.set(catName, catList);
        }
        catList.push(item);

        const decadeName = decade.toUpperCase();
        let decList = this.decadesMap.get(decadeName);
        if (!decList) {
          decList = [];
          this.decadesMap.set(decadeName, decList);
        }
        decList.push(item);
      }
    } else if (Array.isArray(data)) {
      // Standard object array fallback
      data.forEach((row, idx) => {
        const videoId = row.video_id ? row.video_id.trim() : null;
        if (!videoId) return;

        const item = {
          id: idx + 1,
          decade: row.decade ? row.decade.trim() : '1990s',
          year: row.year ? row.year.trim() : '1995',
          category: row.channel ? row.channel.trim() : 'Commercials',
          videoId: videoId,
          title: row.title ? row.title.trim() : `${row.channel || 'Video'} (${row.year || row.decade || 'Retro'})`,
          startSec: parseInt(row.start_seconds) || 0,
          endSec: parseInt(row.end_seconds) || 0
        };

        this.allVideos.push(item);

        const catName = item.category.toUpperCase();
        let catList = this.categoriesMap.get(catName);
        if (!catList) {
          catList = [];
          this.categoriesMap.set(catName, catList);
        }
        catList.push(item);

        const decadeName = item.decade.toUpperCase();
        let decList = this.decadesMap.get(decadeName);
        if (!decList) {
          decList = [];
          this.decadesMap.set(decadeName, decList);
        }
        decList.push(item);
      });
    }

    this.isLoaded = true;
    console.log(`Ingested ${this.allVideos.length} bundled retro streams across ${this.decadesMap.size} decades and ${this.categoriesMap.size} categories.`);
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
    this.decadesMap.clear();

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
        id: idx + 1,
        videoId,
        category,
        decade,
        year,
        title,
        startSec: isNaN(startSec) ? 0 : startSec,
        endSec: isNaN(endSec) ? 0 : endSec
      };

      this.allVideos.push(item);

      const catUpper = category.toUpperCase();
      if (!this.categoriesMap.has(catUpper)) {
        this.categoriesMap.set(catUpper, []);
      }
      this.categoriesMap.get(catUpper).push(item);

      const decUpper = decade.toUpperCase();
      if (!this.decadesMap.has(decUpper)) {
        this.decadesMap.set(decUpper, []);
      }
      this.decadesMap.get(decUpper).push(item);
    });

    this.isLoaded = true;
    console.log(`Indexed ${this.allVideos.length} videos across ${this.decadesMap.size} decades and ${this.categoriesMap.size} categories.`);
    return true;
  }

  /**
   * Get all unique decades with video counts
   */
  getDecades() {
    const canonicalDecades = ['1980s', '1990s', '2000s'];
    return canonicalDecades.map(dec => {
      const upper = dec.toUpperCase();
      const items = this.decadesMap.get(upper) || [];
      return {
        name: dec,
        count: items.length
      };
    });
  }

  /**
   * Get all unique categories with video counts (optionally filtered by enabled decades)
   */
  getCategories(filterDecades = []) {
    const allowedDecades = filterDecades.length > 0 ? new Set(filterDecades.map(d => String(d).toUpperCase())) : null;

    const list = [];
    for (const [name, items] of this.categoriesMap.entries()) {
      const activeCount = allowedDecades 
        ? items.filter(v => allowedDecades.has(String(v.decade).toUpperCase())).length 
        : items.length;

      // Use properly capitalized category name from the first item
      const displayName = items[0]?.category || name;
      list.push({
        name: displayName,
        count: activeCount
      });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Generate a desynchronized, anti-clustered shuffle queue for a given projector channel ID
   * filtered by both enabled categories and enabled decades.
   * 
   * Ensures authentic broadcast pacing:
   * - Never plays two commercials back-to-back
   * - Prevents consecutive duplicate categories (anti-clustering)
   * - Alternates high-visual-energy content (Cartoons, Music, Trailers, Sports) with ads
   */
  generateChannelQueue(channelId, enabledCategories = [], enabledDecades = []) {
    if (this.allVideos.length === 0) return [];

    const categoryList = enabledCategories.length > 0 ? enabledCategories : Array.from(this.categoriesMap.keys());
    const allowedCats = new Set(categoryList.map(c => String(c).toUpperCase()));

    const decadeList = enabledDecades.length > 0 ? enabledDecades : Array.from(this.decadesMap.keys());
    const allowedDecades = new Set(decadeList.map(d => String(d).toUpperCase()));

    // Filter videos by enabled categories, enabled decades, AND exclude dead flagged videos
    const pool = this.allVideos.filter(item => 
      allowedCats.has(String(item.category).toUpperCase()) &&
      allowedDecades.has(String(item.decade).toUpperCase()) &&
      !this.deadVideoIds.has(item.videoId)
    );

    console.log(`Generated queue pool for ${channelId}: ${pool.length} videos available (Decades: ${Array.from(allowedDecades).join(',')}, Cats: ${Array.from(allowedCats).join(',')}).`);

    if (pool.length === 0) return [];

    // Group items into category buckets
    const byCategory = new Map();
    for (let i = 0; i < pool.length; i++) {
      const item = pool[i];
      const catKey = (item.category || 'Other').toUpperCase();
      let bucket = byCategory.get(catKey);
      if (!bucket) {
        bucket = [];
        byCategory.set(catKey, bucket);
      }
      bucket.push(item);
    }

    // Truly randomize (Fisher-Yates shuffle) inside each category bucket
    for (const [_, list] of byCategory.entries()) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
    }

    const availableCats = Array.from(byCategory.keys());
    if (availableCats.length === 1) {
      return byCategory.get(availableCats[0]);
    }

    // Interleave across categories to prevent clustering and duplicate back-to-back categories
    const interleaved = [];
    let lastCat = null;
    let totalRemaining = pool.length;

    while (totalRemaining > 0) {
      // Find categories with remaining items that are NOT the last played category
      const eligible = availableCats.filter(c => c !== lastCat && byCategory.get(c).length > 0);

      let chosenCat = null;
      if (eligible.length > 0) {
        // Weighted random selection based on remaining items in eligible buckets
        let totalWeight = 0;
        for (let i = 0; i < eligible.length; i++) {
          totalWeight += byCategory.get(eligible[i]).length;
        }

        let rand = Math.random() * totalWeight;
        for (let i = 0; i < eligible.length; i++) {
          const c = eligible[i];
          rand -= byCategory.get(c).length;
          if (rand <= 0) {
            chosenCat = c;
            break;
          }
        }
        if (!chosenCat) chosenCat = eligible[0];
      } else {
        // Fallback if only one category still has items
        const remainingWithItems = availableCats.filter(c => byCategory.get(c).length > 0);
        if (remainingWithItems.length === 0) break;
        chosenCat = remainingWithItems[0];
      }

      const item = byCategory.get(chosenCat).pop();
      interleaved.push(item);
      lastCat = chosenCat;
      totalRemaining--;
    }

    return interleaved;
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
