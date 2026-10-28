const API_BASE = 'http://127.0.0.1:52345';

// Setup Context Menus
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'quantum-download-single',
    title: 'Download with Quantum',
    contexts: ['link', 'video', 'audio', 'image', 'page', 'selection']
  });

  chrome.contextMenus.create({
    id: 'quantum-download-all',
    title: 'Download all links with Quantum',
    contexts: ['page', 'frame']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'quantum-download-single') {
    const targetUrl = info.linkUrl || info.srcUrl || info.selectionText || info.pageUrl;
    if (!targetUrl) return;

    await sendToQuantum(targetUrl.trim(), {
      Referer: tab?.url || '',
    });
  } else if (info.menuItemId === 'quantum-download-all') {
    if (!tab?.id) return;
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const links = Array.from(document.querySelectorAll('a[href]'))
            .map(a => a.href)
            .filter(href => href && href.startsWith('http'));
          return Array.from(new Set(links));
        }
      });

      if (res?.result && res.result.length > 0) {
        await fetch(`${API_BASE}/api/download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: res.result })
        });
      }
    } catch (err) {
      console.warn('Error downloading all links:', err);
    }
  }
});

// Intercept browser file downloads
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  (async () => {
    try {
      const statusRes = await fetch(`${API_BASE}/api/status`, { method: 'GET' });
      if (!statusRes.ok) {
        suggest();
        return;
      }

      // CRITICAL: Sites like AnkerGames/DataNodes use a one-time token URL (item.url)
      // which redirects to the actual CDN link (item.finalUrl). If we request item.url again,
      // the server returns an error because the single-use token expired.
      // item.finalUrl holds the resolved direct download mirror!
      const targetUrl = (item.finalUrl && item.finalUrl.startsWith('http')) ? item.finalUrl : item.url;

      // Fetch cookies for targetUrl, item.url, and referrer so Cloudflare & mirror auth tokens pass through
      const cookieMap = new Map();
      const urlsToCheck = [targetUrl, item.url, item.referrer].filter(u => u && u.startsWith('http'));
      for (const u of urlsToCheck) {
        try {
          const cookies = await chrome.cookies.getAll({ url: u });
          if (cookies && cookies.length > 0) {
            for (const c of cookies) {
              cookieMap.set(c.name, c.value);
            }
          }
        } catch (e) {}
      }

      const cookieHeader = Array.from(cookieMap.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');

      const headers = {
        'Referer': item.referrer || item.url || '',
        'User-Agent': navigator.userAgent,
      };
      if (cookieHeader) {
        headers['Cookie'] = cookieHeader;
      }

      const sent = await sendToQuantum(
        targetUrl,
        headers,
        item.filename,
        undefined,
        undefined,
        undefined,
        true // showDialog = true for any intercepted file download!
      );

      if (sent) {
        chrome.downloads.cancel(item.id);
      } else {
        suggest();
      }
    } catch {
      suggest();
    }
  })();
  return true;
});

// Sniff media streams in the background
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId <= 0) return;

    const url = details.url;
    let isMedia = false;
    let mime = '';

    const headers = details.responseHeaders || [];
    for (const h of headers) {
      if (h.name.toLowerCase() === 'content-type') {
        mime = h.value || '';
        if (
          mime.includes('video/') ||
          mime.includes('audio/') ||
          mime.includes('application/vnd.apple.mpegurl') ||
          mime.includes('application/x-mpegurl') ||
          mime.includes('application/dash+xml')
        ) {
          isMedia = true;
          break;
        }
      }
    }

    if (!isMedia) {
      if (/\.(mp4|m3u8|webm|ts|m4s|mpd)($|\?)/i.test(url)) {
        isMedia = true;
      }
    }

    if (isMedia) {
      (async () => {
        const storageKey = `media_tab_${details.tabId}`;
        const stored = await chrome.storage.local.get(storageKey);
        const list = stored[storageKey] || [];

        if (!list.some((m) => m.url === url)) {
          const item = {
            url,
            mime,
            isHls: url.includes('.m3u8') || mime.includes('mpegurl'),
            timestamp: Date.now(),
          };
          list.push(item);
          await chrome.storage.local.set({ [storageKey]: list });

          try {
            await chrome.tabs.sendMessage(details.tabId, {
              type: 'MEDIA_DETECTED',
              media: item,
            });
          } catch {}
        }
      })();
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// Clear stored media when tab closes or navigates to a new URL
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    await chrome.storage.local.remove(`media_tab_${tabId}`);
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'TAB_NAVIGATED',
        url: changeInfo.url,
      });
    } catch {}
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await chrome.storage.local.remove(`media_tab_${tabId}`);
});

// Message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === 'START_DOWNLOAD') {
      let cookieHeader = '';
      try {
        const cookies = await chrome.cookies.getAll({ url: message.url });
        if (cookies && cookies.length > 0) {
          cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        }
      } catch (e) {}

      const mergedHeaders = {
        ...(message.headers || {}),
      };
      if (cookieHeader && !mergedHeaders['Cookie']) {
        mergedHeaders['Cookie'] = cookieHeader;
      }

      const ok = await sendToQuantum(
        message.url,
        mergedHeaders,
        message.filename,
        message.category,
        message.quality,
        message.formatId,
        true // Open standalone download dialog
      );
      sendResponse({ success: ok });
    } else if (message.type === 'EXTRACT_FORMATS') {
      try {
        const res = await fetch(`${API_BASE}/api/extract-formats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: message.url }),
        });
        const json = await res.json();
        sendResponse(json);
      } catch (err) {
        sendResponse({ success: false, formats: [] });
      }
    } else if (message.type === 'CHECK_STATUS') {
      try {
        const res = await fetch(`${API_BASE}/api/status`);
        const json = await res.json();
        sendResponse({ online: true, data: json });
      } catch {
        sendResponse({ online: false });
      }
    }
  })();
  return true;
});

async function sendToQuantum(url, headers = {}, filename = '', category = '', quality = '', formatId = '', showDialog = false) {
  try {
    const finalHeaders = {
      'User-Agent': navigator.userAgent,
      ...(headers || {}),
    };

    const res = await fetch(`${API_BASE}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        headers: finalHeaders,
        filename,
        category: category || (url.includes('.m3u8') ? 'video' : undefined),
        quality,
        formatId,
        showDialog,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error('Failed to communicate with Quantum Downloader:', err);
    return false;
  }
}
