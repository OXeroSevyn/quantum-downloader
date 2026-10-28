(() => {
  // Prevent duplicate execution if content script is re-injected
  if (window.__QUANTUM_EXTENSION_INJECTED__) return;
  window.__QUANTUM_EXTENSION_INJECTED__ = true;

  let currentUrl = window.location.href;
  let lastProbedUrl = null;
  let cachedFormats = null;
  let cachedTitle = null;
  let isProbing = false;
  let isMinimized = false;
  let widgetContainer = null;
  let dropdownEl = null;

  // Check if current page is a video page
  function isVideoPage() {
    const url = window.location.href;
    if (/youtube\.com|youtu\.be/i.test(url)) {
      // On YouTube, only show when watching a video or shorts
      return /watch\?v=|\/shorts\/|\/embed\//i.test(url);
    }
    if (/vimeo\.com|dailymotion\.com|twitch\.tv/i.test(url)) {
      return true;
    }
    // Generic sites: check if a video tag exists and has a source
    const video = document.querySelector('video');
    return !!video;
  }

  // Get freshest title available from DOM or document
  function getCurrentVideoTitle() {
    if (cachedTitle) return cachedTitle;

    if (window.location.hostname.includes('youtube.com')) {
      const ytTitleEl = document.querySelector(
        'h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string, #above-the-fold #title h1, h1.ytd-video-primary-info-renderer'
      );
      if (ytTitleEl && ytTitleEl.textContent?.trim()) {
        return ytTitleEl.textContent.trim();
      }
    }

    const docTitle = (document.title || 'Video')
      .replace(/- YouTube$/i, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim();

    return docTitle || 'Active Video';
  }

  // Find YouTube insertion point (next to Subscribe button in owner info row)
  function findYouTubeAnchor() {
    if (!window.location.hostname.includes('youtube.com')) return null;

    // 1. Right next to Subscribe button in owner bar under the video
    const subscribeBtn = document.querySelector(
      'ytd-watch-metadata #owner #subscribe-button, #above-the-fold #owner #subscribe-button, #subscribe-button'
    );
    if (subscribeBtn && subscribeBtn.parentElement) {
      return { parent: subscribeBtn.parentElement, after: subscribeBtn };
    }

    // 2. In owner block
    const owner = document.querySelector('ytd-watch-metadata #owner, #above-the-fold #owner, #owner');
    if (owner) {
      return { parent: owner, after: null };
    }

    // 3. In top row under the video
    const topRow = document.querySelector('ytd-watch-metadata #top-row, #above-the-fold #top-row, #top-row');
    if (topRow) {
      return { parent: topRow, after: null };
    }

    return null;
  }

  // Ensure widget exists in the correct position
  function ensureWidget() {
    const ytAnchor = findYouTubeAnchor();

    if (ytAnchor) {
      if (widgetContainer && widgetContainer.parentElement === ytAnchor.parent && document.contains(widgetContainer)) {
        return widgetContainer;
      }

      if (widgetContainer) widgetContainer.remove();

      widgetContainer = document.createElement('div');
      widgetContainer.id = 'quantum-top-widget';
      widgetContainer.className = 'quantum-top-widget quantum-native-mode';

      if (ytAnchor.after && ytAnchor.after.nextSibling) {
        ytAnchor.parent.insertBefore(widgetContainer, ytAnchor.after.nextSibling);
      } else {
        ytAnchor.parent.appendChild(widgetContainer);
      }

      return widgetContainer;
    }

    // Fallback: floating mode for non-YouTube video sites
    if (!widgetContainer || !document.contains(widgetContainer) || widgetContainer.classList.contains('quantum-native-mode')) {
      const existing = document.getElementById('quantum-top-widget');
      if (existing) existing.remove();

      widgetContainer = document.createElement('div');
      widgetContainer.id = 'quantum-top-widget';
      widgetContainer.className = 'quantum-top-widget quantum-floating-mode';
      document.body.appendChild(widgetContainer);
    }
    return widgetContainer;
  }

  // Build the interface
  function renderWidget() {
    if (!isVideoPage()) {
      if (widgetContainer) {
        widgetContainer.style.display = 'none';
      }
      return;
    }

    const container = ensureWidget();
    container.style.display = 'inline-flex';

    const videoTitle = getCurrentVideoTitle();

    if (isMinimized) {
      container.innerHTML = `
        <div class="quantum-orb" title="Quantum Downloader • Click to expand (Active: ${videoTitle})">
          <span class="quantum-bolt">⚡</span>
        </div>
      `;
      container.querySelector('.quantum-orb')?.addEventListener('click', () => {
        isMinimized = false;
        renderWidget();
      });
      return;
    }

    container.innerHTML = `
      <div class="quantum-download-pill" id="quantum-download-pill" title="Click to view all download links and qualities">
        <div class="quantum-pill-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <polyline points="19 12 12 19 5 12"></polyline>
          </svg>
        </div>
        <span class="quantum-pill-text">Download</span>
      </div>

      <div class="quantum-dropdown" id="quantum-dropdown">
        <div class="quantum-dropdown-top">
          <div class="quantum-dropdown-status">
            <span class="quantum-live-dot ${isProbing ? 'loading' : ''}"></span>
            <span>Available Download Links</span>
          </div>
          <div class="quantum-dropdown-actions">
            <button class="quantum-refresh-btn" id="quantum-refresh-btn" title="Re-probe stream formats for this video">
              <span class="quantum-refresh-icon">🔄</span>
              <span>Refresh</span>
            </button>
            <button class="quantum-close-dropdown-btn" id="quantum-close-dropdown-btn" title="Close menu">✕</button>
          </div>
        </div>

        <div class="quantum-dropdown-title-box">
          <div class="quantum-dropdown-active-title" id="quantum-dropdown-title">${videoTitle}</div>
          <div class="quantum-dropdown-meta" id="quantum-dropdown-meta">${window.location.hostname} • Quantum Acceleration</div>
        </div>

        <div class="quantum-options-list" id="quantum-options-list">
          <!-- Populated dynamically -->
        </div>

        <div class="quantum-dropdown-footer">
          <button class="quantum-best-download-btn" id="quantum-best-download-btn">
            ⚡ Download Best Available Quality (MP4)
          </button>
        </div>
      </div>
    `;

    dropdownEl = container.querySelector('#quantum-dropdown');
    const pillBtn = container.querySelector('#quantum-download-pill');
    const closeBtn = container.querySelector('#quantum-close-dropdown-btn');
    const refreshBtn = container.querySelector('#quantum-refresh-btn');
    const bestBtn = container.querySelector('#quantum-best-download-btn');

    // Toggle dropdown on pill click
    pillBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dropdownEl?.classList.contains('open');
      if (isOpen) {
        closeDropdown();
      } else {
        openDropdown();
      }
    });

    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeDropdown();
    });

    bestBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      executeDownload('Best', 'bestvideo+bestaudio/best', 'mp4');
      closeDropdown();
    });

    // Refresh button
    refreshBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      refreshBtn.classList.add('spinning');
      cachedFormats = null;
      lastProbedUrl = null;
      probeAvailableFormats(true, () => {
        refreshBtn.classList.remove('spinning');
      });
    });

    // Close when clicking anywhere outside
    document.addEventListener('click', (e) => {
      if (dropdownEl?.classList.contains('open') && !container.contains(e.target)) {
        closeDropdown();
      }
    });

    // Handle format selection in dropdown
    dropdownEl?.addEventListener('click', (e) => {
      const item = e.target.closest('.quantum-option-item');
      if (!item) return;
      e.stopPropagation();

      const res = item.dataset.res || '1080p';
      const formatId = item.dataset.format || '';
      const ext = item.dataset.ext || 'mp4';
      executeDownload(res, formatId, ext);
      closeDropdown();
    });
  }

  function openDropdown() {
    if (!dropdownEl) return;
    dropdownEl.classList.add('open');
    const pillBtn = widgetContainer?.querySelector('#quantum-download-pill');
    pillBtn?.classList.add('active');

    // Dynamic alignment relative to viewport
    if (widgetContainer) {
      const rect = widgetContainer.getBoundingClientRect();
      const spaceRight = window.innerWidth - rect.left;
      if (spaceRight < 390) {
        dropdownEl.classList.add('align-right');
        dropdownEl.classList.remove('align-left');
      } else {
        dropdownEl.classList.add('align-left');
        dropdownEl.classList.remove('align-right');
      }
    }

    // Probe formats if not already loaded for the current video
    if (!cachedFormats || lastProbedUrl !== window.location.href) {
      probeAvailableFormats();
    } else {
      renderFormatsList(cachedFormats);
    }
  }

  function closeDropdown() {
    if (!dropdownEl) return;
    dropdownEl.classList.remove('open');
    const pillBtn = widgetContainer?.querySelector('#quantum-download-pill');
    pillBtn?.classList.remove('active');
  }

  // Ask Quantum backend to extract formats via yt-dlp for the CURRENT url
  function probeAvailableFormats(force = false, onDone = null) {
    const targetUrl = window.location.href;
    const listEl = widgetContainer?.querySelector('#quantum-options-list');
    const liveDot = widgetContainer?.querySelector('.quantum-live-dot');
    if (!listEl) return;

    if (!force && cachedFormats && lastProbedUrl === targetUrl) {
      renderFormatsList(cachedFormats);
      if (onDone) onDone();
      return;
    }

    lastProbedUrl = targetUrl;
    isProbing = true;
    if (liveDot) liveDot.classList.add('loading');

    listEl.innerHTML = `
      <div class="quantum-loading-box">
        <div class="quantum-loading-spinner"></div>
        <div>Analyzing available resolutions with Quantum Engine...</div>
      </div>
    `;

    chrome.runtime.sendMessage({
      type: 'EXTRACT_FORMATS',
      url: targetUrl,
    }, (res) => {
      isProbing = false;
      if (liveDot) liveDot.classList.remove('loading');

      // Verify the response is still for the current URL (in case user quickly navigated again)
      if (window.location.href !== targetUrl) {
        if (onDone) onDone();
        return;
      }

      if (res?.formats && res.formats.length > 0) {
        cachedFormats = res.formats;
        if (res.title) {
          cachedTitle = res.title;
          updateTitles(res.title);
        }
        renderFormatsList(res.formats);
      } else {
        renderFallbackFormats();
      }

      if (onDone) onDone();
    });
  }

  function updateTitles(title) {
    const titleText = widgetContainer?.querySelector('#quantum-title-text');
    const titlePill = widgetContainer?.querySelector('#quantum-title-pill');
    const dropdownTitle = widgetContainer?.querySelector('#quantum-dropdown-title');

    if (titleText) titleText.textContent = title;
    if (titlePill) titlePill.title = title;
    if (dropdownTitle) dropdownTitle.textContent = title;
  }

  function renderFormatsList(formats) {
    const listEl = widgetContainer?.querySelector('#quantum-options-list');
    if (!listEl) return;

    listEl.innerHTML = '';
    formats.forEach(fmt => {
      const item = document.createElement('div');
      item.className = 'quantum-option-item';
      item.dataset.res = fmt.resolution;
      item.dataset.format = fmt.formatId;
      item.dataset.ext = fmt.ext;

      const isAudio = fmt.resolution === 'Audio' || fmt.ext === 'mp3';
      const is4k = fmt.resolution.includes('2160') || fmt.resolution.includes('4K');
      const badgeClass = isAudio ? 'badge-audio' : (is4k ? 'badge-4k' : '');

      item.innerHTML = `
        <div class="quantum-option-info">
          <div class="quantum-option-label">${fmt.label || fmt.quality || fmt.resolution}</div>
          <div class="quantum-option-size">${fmt.filesize ? (fmt.filesize / 1024 / 1024).toFixed(1) + ' MB' : fmt.ext.toUpperCase()} • Direct Stream</div>
        </div>
        <div class="quantum-option-action">
          <span class="quantum-badge-res ${badgeClass}">${fmt.resolution}</span>
          <span class="quantum-download-icon">⬇</span>
        </div>
      `;

      listEl.appendChild(item);
    });
  }

  function renderFallbackFormats() {
    const fallbackList = [
      { formatId: 'bestvideo+bestaudio/best', resolution: 'Best', quality: 'Best Available Quality', ext: 'mp4', label: 'Best Available Quality (MP4)' },
      { formatId: 'bv*[height<=2160]+ba/b', resolution: '4K', quality: '4K Ultra HD', ext: 'mp4', label: '2160p 4K UHD (MP4)' },
      { formatId: 'bv*[height<=1440]+ba/b', resolution: '2K', quality: '2K QHD', ext: 'mp4', label: '1440p 2K QHD (MP4)' },
      { formatId: 'bv*[height<=1080]+ba/b', resolution: '1080p', quality: '1080p Full HD', ext: 'mp4', label: '1080p Full HD (MP4)' },
      { formatId: 'bv*[height<=720]+ba/b', resolution: '720p', quality: '720p HD', ext: 'mp4', label: '720p HD (MP4)' },
      { formatId: 'bv*[height<=480]+ba/b', resolution: '480p', quality: '480p Standard', ext: 'mp4', label: '480p Standard (MP4)' },
      { formatId: 'bv*[height<=360]+ba/b', resolution: '360p', quality: '360p', ext: 'mp4', label: '360p (MP4)' },
      { formatId: 'ba/b', resolution: 'Audio', quality: 'Audio Only (MP3)', ext: 'mp3', label: 'Audio Only (MP3 / High Quality)' },
    ];
    renderFormatsList(fallbackList);
  }

  function executeDownload(res, formatId, ext) {
    // ALWAYS resolve the fresh target URL and fresh title at the moment of download!
    const targetUrl = window.location.href;
    const activeTitle = getCurrentVideoTitle();

    showToast(`⚡ Sending ${res} download to Quantum...`);

    chrome.runtime.sendMessage({
      type: 'START_DOWNLOAD',
      url: targetUrl,
      filename: `${activeTitle.replace(/[\\/:*?"<>|]/g, '_')}.${ext}`,
      category: res === 'Audio' || ext === 'mp3' ? 'audio' : 'video',
      quality: res,
      formatId: formatId,
      headers: {
        Referer: window.location.href,
      },
    }, (response) => {
      if (response?.success) {
        showToast(`✅ ${res} download queued in Quantum Downloader!`);
      } else {
        showToast('⚠️ Could not connect to Quantum. Ensure the app is open.');
      }
    });
  }

  function showToast(text) {
    const existing = document.querySelector('.quantum-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'quantum-toast';
    toast.textContent = text;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(12px) scale(0.95)';
      setTimeout(() => toast.remove(), 350);
    }, 3800);
  }

  // Handle video/page navigation (Single Page App on YouTube, etc.)
  function handleNavigation(force = false) {
    const newUrl = window.location.href;
    if (!force && newUrl === currentUrl) return;

    currentUrl = newUrl;
    cachedFormats = null;
    cachedTitle = null;
    lastProbedUrl = null;

    // Small delay to allow YouTube to update DOM metadata
    setTimeout(() => {
      renderWidget();
    }, 250);
  }

  // Navigation listeners
  window.addEventListener('yt-navigate-finish', () => handleNavigation(true));
  window.addEventListener('yt-page-data-updated', () => handleNavigation(true));
  window.addEventListener('popstate', () => handleNavigation(true));

  // Intercept HTML5 History API for SPAs
  const wrapHistory = (type) => {
    const orig = history[type];
    return function (...args) {
      const res = orig.apply(this, args);
      handleNavigation(true);
      return res;
    };
  };
  history.pushState = wrapHistory('pushState');
  history.replaceState = wrapHistory('replaceState');

  // Background message listener (e.g. TAB_NAVIGATED)
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TAB_NAVIGATED') {
      handleNavigation(true);
    } else if (message.type === 'MEDIA_DETECTED') {
      if (isVideoPage() && (!widgetContainer || widgetContainer.style.display === 'none')) {
        renderWidget();
      }
    }
  });

  // Polling fallback to guarantee no SPA transition or DOM re-render is missed
  setInterval(() => {
    if (window.location.href !== currentUrl) {
      handleNavigation(true);
      return;
    }
    if (isVideoPage() && window.location.hostname.includes('youtube.com')) {
      const ytAnchor = findYouTubeAnchor();
      if (ytAnchor && (!widgetContainer || !document.contains(widgetContainer) || widgetContainer.parentElement !== ytAnchor.parent)) {
        renderWidget();
      }
    }
  }, 750);

  // Close dropdown on click outside
  document.addEventListener('click', (e) => {
    if (widgetContainer && !widgetContainer.contains(e.target)) {
      closeDropdown();
    }
  });

  // Automatically hide during full-screen playback
  const handleFullscreenChange = () => {
    if (!widgetContainer) return;
    if (document.fullscreenElement) {
      widgetContainer.classList.add('quantum-hidden-fullscreen');
    } else {
      widgetContainer.classList.remove('quantum-hidden-fullscreen');
    }
  };
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

  // Initial mount
  setTimeout(renderWidget, 800);
})();
