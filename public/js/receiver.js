// Desktop WebRTC Receiver Logic

const remoteVideo = document.getElementById('remoteVideo');
const receiverViewport = document.getElementById('receiver-viewport');
const standbyScreen = document.getElementById('standby-screen');
const standbyQrImgBox = document.getElementById('standby-qr-img-box');
const standbySenderUrl = document.getElementById('standby-sender-url');
const topHud = document.getElementById('top-hud');
const bottomToolbar = document.getElementById('bottom-toolbar');
const streamDot = document.getElementById('stream-dot');
const streamStatusText = document.getElementById('stream-status-text');
const feedMetaPill = document.getElementById('feed-meta-pill');
const feedMetaText = document.getElementById('feed-meta-text');
const unmuteBanner = document.getElementById('unmute-banner');

// Diagnostics Elements
const diagPanel = document.getElementById('diag-panel');
const btnToggleDiag = document.getElementById('btn-toggle-diag');
const diagConnectionState = document.getElementById('diag-connection-state');
const diagBitrate = document.getElementById('diag-bitrate');
const diagRtt = document.getElementById('diag-rtt');
const diagRes = document.getElementById('diag-res');
const diagFps = document.getElementById('diag-fps');
const diagLost = document.getElementById('diag-lost');
const diagJitter = document.getElementById('diag-jitter');
const diagCodec = document.getElementById('diag-codec');

// Bottom Toolbar Controls
const btnFit = document.getElementById('btn-fit');
const btnSnapshot = document.getElementById('btn-snapshot');
const btnVolume = document.getElementById('btn-volume');
const volSlider = document.getElementById('vol-slider');
const volIcon = document.getElementById('vol-icon');
const btnPip = document.getElementById('btn-pip');
const btnFullscreen = document.getElementById('btn-fullscreen');
const fsIcon = document.getElementById('fs-icon');

// QR Modal
const qrModal = document.getElementById('qr-modal');
const btnShowQr = document.getElementById('btn-show-qr');
const modalQrImg = document.getElementById('modal-qr-img');
const modalSenderUrl = document.getElementById('modal-sender-url');

// Canvas
const snapshotCanvas = document.getElementById('snapshot-canvas');

// State
let peerConnection = null;
let currentSenderId = null;
let hasAudio = false;
let isFitCover = false;
let statsInterval = null;
let prevBytesReceived = 0;
let prevStatsTimestamp = 0;
let idleTimer = null;

// WebRTC Configuration
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 10
};

// Toast helper
function showToast(message) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <svg class="icon" style="color: #38bdf8;" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
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

// Fetch QR Code for Standby Screen
async function fetchStandbyInfo() {
  try {
    const res = await fetch('/api/info');
    if (!res.ok) return;
    const data = await res.json();
    if (data.qrCodeDataUrl) {
      standbyQrImgBox.innerHTML = `<img src="${data.qrCodeDataUrl}" alt="Sender QR">`;
      modalQrImg.src = data.qrCodeDataUrl;
    }
    standbySenderUrl.textContent = data.senderUrl;
    modalSenderUrl.textContent = data.senderUrl;
  } catch (err) {
    console.error('Error fetching standby info:', err);
  }
}

// Socket.io Connection & WebRTC Signaling
const socket = io();

socket.on('connect', () => {
  console.log('[Receiver] Connected to signaling server as ID:', socket.id);
  socket.emit('register-receiver');
  fetchStandbyInfo();
});

socket.on('registered', ({ hasSender }) => {
  console.log('[Receiver] Registered. Has active sender:', hasSender);
  if (!hasSender) {
    showStandby(true);
  }
});

socket.on('sender-available', () => {
  console.log('[Receiver] Sender came online, requesting stream');
  socket.emit('register-receiver');
});

// Sender Status Updates
socket.on('sender-status', (data) => {
  if (data.connected) {
    streamDot.className = 'status-dot waiting';
    streamStatusText.textContent = 'Phone Ready';
  } else {
    streamDot.className = 'status-dot offline';
    streamStatusText.textContent = 'Disconnected';
    showStandby(true);
  }
});

// Sender Left
socket.on('sender-left', () => {
  console.log('[Receiver] Sender disconnected');
  showToast('Phone disconnected');
  streamDot.className = 'status-dot offline';
  streamStatusText.textContent = 'Disconnected';
  showStandby(true);
  closePeerConnection();
});

// Receive SDP Offer or Candidate from Sender
socket.on('signal-from-sender', async ({ senderId, data }) => {
  currentSenderId = senderId;

  if (data.type === 'offer') {
    console.log('[WebRTC] Received SDP offer from sender:', senderId);
    await handleOffer(data.sdp);
  } else if (data.type === 'candidate' && data.candidate) {
    if (peerConnection) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (err) {
        console.error('[WebRTC] Error adding ICE candidate:', err);
      }
    }
  }
});

// Handle SDP Offer
async function handleOffer(offer) {
  closePeerConnection();

  // Set up the WebRTC connection solely as a receiver
  peerConnection = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

  peerConnection.ontrack = (event) => {
    const remoteVideoEl = document.getElementById('remoteVideo') || document.querySelector('video');
    if (remoteVideoEl && remoteVideoEl.srcObject !== event.streams[0]) {
      remoteVideoEl.srcObject = event.streams[0];
      remoteVideoEl.play().catch(e => console.log('Autoplay handled:', e));
    }

    if (event.track.kind === 'audio') {
      hasAudio = true;
      if (remoteVideo.muted) {
        unmuteBanner.style.display = 'flex';
      }
    }

    showStandby(false);
    updateStreamMetadata();
  };

  // ICE candidates generated by receiver
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal-to-sender', {
        data: {
          type: 'candidate',
          candidate: event.candidate
        }
      });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log('[WebRTC] Connection state:', peerConnection.connectionState);
    diagConnectionState.textContent = peerConnection.connectionState.toUpperCase();

    if (peerConnection.connectionState === 'connected') {
      streamDot.className = 'status-dot active';
      streamStatusText.textContent = 'LIVE';
      diagConnectionState.style.color = '#10b981';
      showStandby(false);
      showToast('Live connection established!');
      startStatsMonitor();
    } else if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
      streamDot.className = 'status-dot offline';
      streamStatusText.textContent = 'Connection Lost';
      diagConnectionState.style.color = '#ef4444';
      showStandby(true);
      stopStatsMonitor();
    }
  };

  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit('signal-to-sender', {
      data: {
        type: 'answer',
        sdp: answer
      }
    });
    console.log('[WebRTC] Sent SDP answer to sender');
  } catch (err) {
    console.error('[WebRTC] Error handling SDP offer:', err);
  }
}

function closePeerConnection() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  remoteVideo.srcObject = null;
  stopStatsMonitor();
}

function showStandby(show) {
  if (show) {
    standbyScreen.classList.remove('hidden');
    feedMetaPill.style.display = 'none';
    unmuteBanner.style.display = 'none';
  } else {
    standbyScreen.classList.add('hidden');
    feedMetaPill.style.display = 'inline-flex';
  }
}

// Update Resolution / FPS text badge
function updateStreamMetadata() {
  if (remoteVideo.videoWidth && remoteVideo.videoHeight) {
    feedMetaText.textContent = `${remoteVideo.videoWidth}x${remoteVideo.videoHeight}`;
    diagRes.textContent = `${remoteVideo.videoWidth} x ${remoteVideo.videoHeight}`;
  }
}
remoteVideo.addEventListener('loadedmetadata', updateStreamMetadata);
remoteVideo.addEventListener('resize', updateStreamMetadata);

// WebRTC getStats Monitor
function startStatsMonitor() {
  stopStatsMonitor();
  prevBytesReceived = 0;
  prevStatsTimestamp = performance.now();

  statsInterval = setInterval(async () => {
    if (!peerConnection) return;
    try {
      const stats = await peerConnection.getStats();
      let inboundVideo = null;
      let selectedCandidatePair = null;

      stats.forEach(report => {
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          inboundVideo = report;
        } else if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          selectedCandidatePair = report;
        }
      });

      if (inboundVideo) {
        const now = performance.now();
        const deltaSeconds = (now - prevStatsTimestamp) / 1000;
        if (deltaSeconds > 0 && prevBytesReceived > 0) {
          const bytesDiff = inboundVideo.bytesReceived - prevBytesReceived;
          const bitrateBps = (bytesDiff * 8) / deltaSeconds;
          if (bitrateBps > 1000000) {
            diagBitrate.textContent = `${(bitrateBps / 1000000).toFixed(2)} Mbps`;
          } else {
            diagBitrate.textContent = `${Math.round(bitrateBps / 1000)} kbps`;
          }
        }
        prevBytesReceived = inboundVideo.bytesReceived;
        prevStatsTimestamp = now;

        if (inboundVideo.framesPerSecond !== undefined) {
          diagFps.textContent = `${Math.round(inboundVideo.framesPerSecond)} FPS`;
          if (feedMetaText) {
            feedMetaText.textContent = `${remoteVideo.videoWidth}x${remoteVideo.videoHeight} @ ${Math.round(inboundVideo.framesPerSecond)}fps`;
          }
        }

        if (inboundVideo.packetsLost !== undefined) {
          diagLost.textContent = `${inboundVideo.packetsLost}`;
          diagLost.className = `diag-val ${inboundVideo.packetsLost > 50 ? 'warning' : 'good'}`;
        }

        if (inboundVideo.jitter !== undefined) {
          diagJitter.textContent = `${(inboundVideo.jitter * 1000).toFixed(1)} ms`;
        }

        if (inboundVideo.codecId) {
          const codecReport = stats.get(inboundVideo.codecId);
          if (codecReport && codecReport.mimeType) {
            diagCodec.textContent = codecReport.mimeType.replace('video/', '');
          }
        }
      }

      if (selectedCandidatePair && selectedCandidatePair.currentRoundTripTime !== undefined) {
        const rttMs = Math.round(selectedCandidatePair.currentRoundTripTime * 1000);
        diagRtt.textContent = `${rttMs} ms`;
        diagRtt.className = `diag-val ${rttMs < 50 ? 'good' : 'warning'}`;
      }

      updateStreamMetadata();
    } catch (err) {
      console.warn('[WebRTC Stats] Error polling stats:', err);
    }
  }, 1000);
}

function stopStatsMonitor() {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
}

// Auto-hide Controls on Inactivity (3 seconds)
function resetIdleTimer() {
  topHud.classList.remove('idle-hidden');
  bottomToolbar.classList.remove('idle-hidden');
  receiverViewport.style.cursor = 'default';

  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    // Only auto-hide if stream is active and not hovering diagnostics
    if (peerConnection && peerConnection.connectionState === 'connected' && diagPanel.classList.contains('hidden') && qrModal.style.display !== 'flex') {
      topHud.classList.add('idle-hidden');
      bottomToolbar.classList.add('idle-hidden');
      receiverViewport.style.cursor = 'none';
    }
  }, 3000);
}

document.addEventListener('mousemove', resetIdleTimer);
document.addEventListener('touchstart', resetIdleTimer);

// Aspect Ratio (Contain / Cover)
btnFit.addEventListener('click', () => {
  isFitCover = !isFitCover;
  if (isFitCover) {
    remoteVideo.classList.add('fit-cover');
    btnFit.classList.add('active');
    showToast('Mode: Fill Screen');
  } else {
    remoteVideo.classList.remove('fit-cover');
    btnFit.classList.remove('active');
    showToast('Mode: Fit Screen (Original Aspect)');
  }
});

// Snapshot Capture Feature
btnSnapshot.addEventListener('click', () => {
  if (!remoteVideo.videoWidth || !remoteVideo.videoHeight) {
    showToast('No active video stream to capture');
    return;
  }

  snapshotCanvas.width = remoteVideo.videoWidth;
  snapshotCanvas.height = remoteVideo.videoHeight;
  const ctx = snapshotCanvas.getContext('2d');
  ctx.drawImage(remoteVideo, 0, 0, snapshotCanvas.width, snapshotCanvas.height);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dataUrl = snapshotCanvas.toDataURL('image/png');

  const link = document.createElement('a');
  link.download = `stream-snapshot-${timestamp}.png`;
  link.href = dataUrl;
  link.click();

  showToast('Snapshot captured & downloaded!');
});

// Volume & Mute Controls
function updateVolumeIcon() {
  if (remoteVideo.muted || remoteVideo.volume === 0) {
    volIcon.innerHTML = `
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <line x1="23" y1="9" x2="17" y2="15"/>
      <line x1="17" y1="9" x2="23" y2="15"/>
    `;
    btnVolume.classList.remove('active');
  } else {
    volIcon.innerHTML = `
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
    `;
    btnVolume.classList.add('active');
  }
}

btnVolume.addEventListener('click', () => {
  remoteVideo.muted = !remoteVideo.muted;
  if (!remoteVideo.muted && remoteVideo.volume === 0) {
    remoteVideo.volume = 0.5;
    volSlider.value = 0.5;
  }
  updateVolumeIcon();
  unmuteBanner.style.display = 'none';
});

volSlider.addEventListener('input', (e) => {
  remoteVideo.volume = parseFloat(e.target.value);
  remoteVideo.muted = remoteVideo.volume === 0;
  updateVolumeIcon();
});

unmuteBanner.addEventListener('click', () => {
  remoteVideo.muted = false;
  remoteVideo.volume = 1;
  volSlider.value = 1;
  updateVolumeIcon();
  unmuteBanner.style.display = 'none';
  showToast('Audio unmuted');
});

// Picture in Picture
btnPip.addEventListener('click', async () => {
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else {
      await remoteVideo.requestPictureInPicture();
    }
  } catch (err) {
    console.warn('PiP error:', err);
    showToast('Picture-in-Picture not supported');
  }
});

// Fullscreen
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    receiverViewport.requestFullscreen().catch(err => console.warn(err));
    btnFullscreen.classList.add('active');
  } else {
    document.exitFullscreen().catch(err => console.warn(err));
    btnFullscreen.classList.remove('active');
  }
}

btnFullscreen.addEventListener('click', toggleFullscreen);

// Fullscreen change handler
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement) {
    btnFullscreen.classList.add('active');
    fsIcon.innerHTML = `
      <polyline points="4 14 10 14 10 20"/><line x1="10" y1="14" x2="3" y2="21"/>
      <polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/>
    `;
  } else {
    btnFullscreen.classList.remove('active');
    fsIcon.innerHTML = `
      <polyline points="15 3 21 3 21 9"/><line x1="21" y1="3" x2="14" y2="10"/>
      <polyline points="9 21 3 21 3 15"/><line x1="3" y1="21" x2="10" y2="14"/>
    `;
  }
});

// Diagnostics Toggle
function toggleDiagnostics() {
  diagPanel.classList.toggle('hidden');
  btnToggleDiag.classList.toggle('btn-primary');
}
btnToggleDiag.addEventListener('click', toggleDiagnostics);

// QR Modal
function openQrModal() {
  qrModal.style.display = 'flex';
  qrModal.classList.add('open');
}
function closeQrModal() {
  qrModal.style.display = 'none';
  qrModal.classList.remove('open');
}
btnShowQr.addEventListener('click', openQrModal);

// Keyboard Shortcuts: F = Fullscreen, D = Diagnostics, M = Mute
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  
  if (e.key === 'f' || e.key === 'F') {
    toggleFullscreen();
  } else if (e.key === 'd' || e.key === 'D') {
    toggleDiagnostics();
  } else if (e.key === 'm' || e.key === 'M') {
    remoteVideo.muted = !remoteVideo.muted;
    updateVolumeIcon();
  } else if (e.key === 's' || e.key === 'S') {
    btnSnapshot.click();
  }
});

// Initial volume state
updateVolumeIcon();
resetIdleTimer();
