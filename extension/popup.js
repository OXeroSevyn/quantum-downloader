document.addEventListener('DOMContentLoaded', async () => {
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const activeTitle = document.getElementById('active-title');
  const activeUrl = document.getElementById('active-url');
  const activeTagText = document.getElementById('active-tag-text');
  const refreshBtn = document.getElementById('refresh-btn');
  const formatCount = document.getElementById('format-count');
  const mediaContainer = document.getElementById('media-container');

  // Check connection to Quantum Downloader backend
  chrome.runtime.sendMessage({ type: 'CHECK_STATUS' }, (res) => {
    if (res?.online) {
      statusDot.classList.add('online');
      const speedMB = res.data?.totalSpeed ? (res.data.totalSpeed / (1024 * 1024)).toFixed(1) : '0';
      statusText.textContent = `Online (${speedMB} MB/s)`;
    } else {
      statusDot.classList.remove('online');
      statusText.textContent = 'App Offline';
    }
  });

  // Get active tab info
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    mediaContainer.innerHTML = '<div class="empty-msg">No active tab detected.</div>';
    return;
  }

  // Populate active tab banner
  const cleanTitle = (tab.title || 'Active Page').replace(/- YouTube$/i, '').trim();
  activeTitle.textContent = cleanTitle;
  activeTitle.title = cleanTitle;
  try {
    const parsed = new URL(tab.url);
    activeUrl.textContent = parsed.hostname;
    activeTagText.textContent = parsed.hostname.includes('youtube.com') ? 'YouTube Stream' : 'Active Tab';
  } catch {
    activeUrl.textContent = tab.url;
  }

  const isVideoPage = /youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv/i.test(tab.url);

  async function loadFormats(force = false) {
    mediaContainer.innerHTML = `
      <div class="empty-msg">
        <div class="loading-spinner"></div>
        <div>Probing stream formats with Quantum Engine...</div>
      </div>
    `;

    if (isVideoPage) {
      chrome.runtime.sendMessage({
        type: 'EXTRACT_FORMATS',
        url: tab.url,
      }, (res) => {
        if (res?.formats && res.formats.length > 0) {
          renderFormats(res.formats, res.title || cleanTitle);
        } else {
          showSniffedMediaFallback();
        }
      });
    } else {
      showSniffedMediaFallback();
    }
  }

  function renderFormats(formats, videoTitle) {
    mediaContainer.innerHTML = '';
    formatCount.textContent = formats.length;
    activeTitle.textContent = videoTitle;
    activeTitle.title = videoTitle;

    formats.forEach((fmt) => {
      const div = document.createElement('div');
      div.className = 'media-item';

      const isAudio = fmt.resolution === 'Audio' || fmt.ext === 'mp3';
      const badgeClass = isAudio ? 'badge-audio' : '';
      const btnClass = isAudio ? 'btn-dl btn-dl-audio' : 'btn-dl';
      const sizeText = fmt.filesize ? `${(fmt.filesize / 1024 / 1024).toFixed(1)} MB` : fmt.ext.toUpperCase();

      div.innerHTML = `
        <div class="media-info">
          <div class="media-res-row">
            <span class="media-quality">${fmt.label || fmt.quality || fmt.resolution}</span>
            <span class="media-badge ${badgeClass}">${fmt.resolution}</span>
          </div>
          <div class="media-meta">${sizeText} • Direct Multi-Stream</div>
        </div>
        <button class="${btnClass}">⬇ Download</button>
      `;

      div.querySelector('button').addEventListener('click', (e) => {
        const btn = e.target;
        btn.textContent = 'Sending...';
        btn.disabled = true;

        chrome.runtime.sendMessage({
          type: 'START_DOWNLOAD',
          url: tab.url,
          filename: `${videoTitle.replace(/[\\/:*?"<>|]/g, '_')}.${fmt.ext}`,
          category: isAudio ? 'audio' : 'video',
          quality: fmt.resolution,
          formatId: fmt.formatId,
          headers: { Referer: tab.url },
        }, (startRes) => {
          if (startRes?.success) {
            btn.textContent = 'Added! ⚡';
            setTimeout(() => {
              btn.textContent = '⬇ Download';
              btn.disabled = false;
            }, 2500);
          } else {
            btn.textContent = 'Failed';
            btn.disabled = false;
          }
        });
      });

      mediaContainer.appendChild(div);
    });
  }

  async function showSniffedMediaFallback() {
    if (!tab?.id) {
      mediaContainer.innerHTML = '<div class="empty-msg">No streaming media detected.</div>';
      return;
    }

    const key = `media_tab_${tab.id}`;
    const stored = await chrome.storage.local.get(key);
    const mediaList = stored[key] || [];

    if (mediaList.length > 0) {
      mediaContainer.innerHTML = '';
      formatCount.textContent = mediaList.length;

      mediaList.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'media-item';
        const isHls = item.isHls || item.url.includes('.m3u8');

        div.innerHTML = `
          <div class="media-info">
            <div class="media-res-row">
              <span class="media-quality">${isHls ? 'HLS Stream (.m3u8)' : 'Video Stream'}</span>
              <span class="media-badge">${isHls ? 'M3U8' : 'MEDIA'}</span>
            </div>
            <div class="media-meta" title="${item.url}" style="max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.url}</div>
          </div>
          <button class="btn-dl">⬇ Download</button>
        `;

        div.querySelector('button').addEventListener('click', (e) => {
          const btn = e.target;
          btn.textContent = 'Sending...';
          btn.disabled = true;

          chrome.runtime.sendMessage({
            type: 'START_DOWNLOAD',
            url: item.url,
            filename: `${cleanTitle}_${index + 1}.mp4`,
            category: 'video',
            headers: { Referer: tab.url || '' },
          }, (res) => {
            if (res?.success) {
              btn.textContent = 'Added! ⚡';
            } else {
              btn.textContent = 'Failed';
              btn.disabled = false;
            }
          });
        });

        mediaContainer.appendChild(div);
      });
    } else {
      formatCount.textContent = '0';
      mediaContainer.innerHTML = '<div class="empty-msg">No streaming media detected. Play a video to sniff streams!</div>';
    }
  }

  refreshBtn?.addEventListener('click', () => {
    loadFormats(true);
  });

  // Initial load
  loadFormats();
});
