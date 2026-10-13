// Index Hub JavaScript

const networkSelect = document.getElementById('network-ip-select');
const senderUrlText = document.getElementById('sender-url-text');
const qrBox = document.getElementById('qr-box');
const copyBtn = document.getElementById('copy-sender-url');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const sslGuideToggle = document.getElementById('ssl-guide-toggle');
const sslGuideBody = document.getElementById('ssl-guide-body');
const guideChevron = document.getElementById('guide-chevron');

let currentSenderUrl = '';
let serverInfo = null;

// Toast notification helper
function showToast(message) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <svg class="icon" style="color: #10b981;" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// Fetch network & QR code information
async function fetchServerInfo(selectedIp = null) {
  try {
    const url = selectedIp ? `/api/info?ip=${encodeURIComponent(selectedIp)}` : '/api/info';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch info');
    
    serverInfo = await res.json();
    currentSenderUrl = serverInfo.senderUrl;
    senderUrlText.textContent = serverInfo.senderUrl;

    // Render QR Code image
    if (serverInfo.qrCodeDataUrl) {
      qrBox.innerHTML = `<img src="${serverInfo.qrCodeDataUrl}" alt="Sender QR Code" />`;
    }

    // Populate dropdown if empty
    if (networkSelect.options.length === 0 && serverInfo.addresses) {
      serverInfo.addresses.forEach(addr => {
        const opt = document.createElement('option');
        opt.value = addr.address;
        opt.textContent = `${addr.address} (${addr.interface})`;
        if (addr.address === serverInfo.currentIp) {
          opt.selected = true;
        }
        networkSelect.appendChild(opt);
      });
    }
  } catch (err) {
    console.error('Error fetching server info:', err);
    qrBox.innerHTML = `<span style="color: #ef4444; font-size: 0.85rem;">Failed to load QR code.</span>`;
  }
}

// Handle network interface dropdown change
networkSelect.addEventListener('change', (e) => {
  fetchServerInfo(e.target.value);
});

// Copy sender URL to clipboard
copyBtn.addEventListener('click', async () => {
  if (!currentSenderUrl) return;
  try {
    await navigator.clipboard.writeText(currentSenderUrl);
    showToast('Copied sender URL to clipboard!');
  } catch (err) {
    // Fallback for older browsers
    const tempInput = document.createElement('input');
    tempInput.value = currentSenderUrl;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand('copy');
    document.body.removeChild(tempInput);
    showToast('Copied sender URL to clipboard!');
  }
});

// SSL Guide toggle
let isGuideOpen = true;
sslGuideToggle.addEventListener('click', () => {
  isGuideOpen = !isGuideOpen;
  sslGuideBody.style.display = isGuideOpen ? 'grid' : 'none';
  guideChevron.style.transform = isGuideOpen ? 'rotate(0deg)' : 'rotate(-90deg)';
});

// Socket.io for live status updates
const socket = io();

socket.on('connect', () => {
  console.log('[Hub] Connected to signaling server');
});

socket.on('sender-status', (data) => {
  if (data.connected) {
    statusDot.className = 'status-dot active';
    statusText.textContent = 'Phone Camera is ONLINE & Connected';
    statusText.style.color = 'var(--accent-emerald)';
  } else {
    statusDot.className = 'status-dot waiting';
    statusText.textContent = 'Waiting for phone to connect...';
    statusText.style.color = 'var(--text-muted)';
  }
});

socket.on('sender-left', () => {
  statusDot.className = 'status-dot waiting';
  statusText.textContent = 'Phone disconnected. Waiting for connection...';
  statusText.style.color = 'var(--text-muted)';
});

// Initial load
fetchServerInfo();
