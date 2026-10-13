// Mobile WebRTC Sender Logic

const localVideo = document.getElementById('localVideo');
const p2pStatusDot = document.getElementById('p2p-status-dot');
const p2pStatusText = document.getElementById('p2p-status-text');
const receiverPill = document.getElementById('receiver-pill');
const receiverCountNum = document.getElementById('receiver-count-num');
const btnTorch = document.getElementById('btn-torch');
const btnFlip = document.getElementById('btn-flip');
const btnStream = document.getElementById('btn-stream');
const btnStreamLabel = document.getElementById('btn-stream-label');
const btnMic = document.getElementById('btn-mic');
const micIcon = document.getElementById('mic-icon');
const selectResolution = document.getElementById('select-resolution');
const hudResolution = document.getElementById('hud-resolution');
const hudFps = document.getElementById('hud-fps');
const wakeLockItem = document.getElementById('wake-lock-item');
const errorModal = document.getElementById('error-modal');
const errorMessage = document.getElementById('error-message');
const focusRing = document.getElementById('focusRing');

// State
let localStream = null;
let currentFacingMode = 'environment'; // Default: rear camera
let isStreaming = false;
let isAudioEnabled = false;
let isTorchOn = false;
let wakeLock = null;
let peerConnections = new Map(); // receiverId -> RTCPeerConnection

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

// Request Screen Wake Lock so phone screen doesn't turn off
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLockItem.style.display = 'flex';
      wakeLock.addEventListener('release', () => {
        wakeLockItem.style.display = 'none';
      });
      console.log('[WakeLock] Screen wake lock acquired.');
    } catch (err) {
      console.warn('[WakeLock] Could not acquire screen wake lock:', err);
      wakeLockItem.style.display = 'none';
    }
  } else {
    wakeLockItem.style.display = 'none';
  }
}

// Re-acquire wake lock on app resume
document.addEventListener('visibilitychange', () => {
  if (wakeLock !== null && document.visibilityState === 'visible') {
    requestWakeLock();
  }
});

// Resolution constraints helper
function getResolutionConstraints(val) {
  if (val === '1080') {
    return { width: { ideal: 1920 }, height: { ideal: 1080 } };
  } else if (val === '480') {
    return { width: { ideal: 854 }, height: { ideal: 480 } };
  }
  // Default: 720p
  return { width: { ideal: 1280 }, height: { ideal: 720 } };
}

// Start camera stream
async function initCamera() {
  try {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }

    const resConstraints = getResolutionConstraints(selectResolution.value);

    const constraints = {
      video: {
        facingMode: { ideal: currentFacingMode },
        ...resConstraints,
        frameRate: { ideal: 30 }
      },
      audio: isAudioEnabled ? {
        echoCancellation: true,
        noiseSuppression: true
      } : false
    };

    console.log('[Camera] Requesting user media with constraints:', constraints);
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    localVideo.srcObject = localStream;

    // Apply mirror CSS if using front camera
    if (currentFacingMode === 'user') {
      localVideo.classList.add('mirrored');
    } else {
      localVideo.classList.remove('mirrored');
    }

    // Inspect capabilities for torch / flashlight support
    checkTorchSupport();

    // Start video telemetry
    setupStreamTelemetry();

    // If already streaming, replace tracks on all active peer connections
    if (isStreaming) {
      replacePeerTracks();
    }

    // Request wake lock
    requestWakeLock();

    errorModal.classList.remove('open');
  } catch (err) {
    console.error('[Camera] Error starting camera:', err);
    errorModal.classList.add('open');
    if (err.name === 'NotAllowedError') {
      errorMessage.textContent = 'Camera permission was denied. Please allow camera permissions in your browser address bar settings and reload.';
    } else if (err.name === 'OverconstrainedError') {
      errorMessage.textContent = 'Selected resolution is not supported by your camera. Reverting to default...';
      selectResolution.value = '720';
      setTimeout(initCamera, 1000);
    } else {
      errorMessage.textContent = `Camera error: ${err.message || err.name}. Make sure no other application is using the camera.`;
    }
  }
}

function retryCamera() {
  errorModal.classList.remove('open');
  initCamera();
}

let simulationCanvas = null;
let simulationAnimId = null;

function startSimulatedCamera() {
  errorModal.classList.remove('open');
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
  }
  if (simulationAnimId) {
    cancelAnimationFrame(simulationAnimId);
  }

  simulationCanvas = document.createElement('canvas');
  simulationCanvas.width = 1280;
  simulationCanvas.height = 720;
  const ctx = simulationCanvas.getContext('2d');

  let ballX = 200, ballY = 200, dx = 5, dy = 3;

  function renderSimFrame() {
    // Gradient dark background
    const grad = ctx.createLinearGradient(0, 0, 1280, 720);
    grad.addColorStop(0, '#0a0f1d');
    grad.addColorStop(1, '#020408');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1280, 720);

    // Matrix / Grid lines
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
    ctx.lineWidth = 1;
    for (let x = 0; x < 1280; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 720);
      ctx.stroke();
    }
    for (let y = 0; y < 720; y += 60) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1280, y);
      ctx.stroke();
    }

    // Dynamic moving orb
    ballX += dx;
    ballY += dy;
    if (ballX < 50 || ballX > 1230) dx = -dx;
    if (ballY < 50 || ballY > 670) dy = -dy;

    ctx.save();
    ctx.shadowColor = '#06b6d4';
    ctx.shadowBlur = 35;
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(ballX, ballY, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Center Crosshair
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(640 - 50, 360); ctx.lineTo(640 + 50, 360);
    ctx.moveTo(640, 360 - 50); ctx.lineTo(640, 360 + 50);
    ctx.stroke();

    // Live millisecond HUD text
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText('WEBRTC TEST CAMERA FEED', 60, 90);

    ctx.fillStyle = '#10b981';
    ctx.font = '22px monospace';
    ctx.fillText(`SIMULATED REAR LENS (${currentFacingMode.toUpperCase()})`, 60, 130);
    ctx.fillText(`TIME: ${timeStr}`, 60, 165);
    ctx.fillText('RES: 1280x720 @ 30 FPS', 60, 200);

    simulationAnimId = requestAnimationFrame(renderSimFrame);
  }
  renderSimFrame();

  localStream = simulationCanvas.captureStream(30);
  localVideo.srcObject = localStream;
  setupStreamTelemetry();
  replacePeerTracks();
  showToast('Virtual Test Camera Activated');
}

// Check Torch (Flashlight) support
function checkTorchSupport() {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (!videoTrack) return;

  const capabilities = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
  if (capabilities.torch) {
    btnTorch.classList.remove('disabled');
    btnTorch.title = 'Toggle Flashlight';
  } else {
    btnTorch.classList.add('disabled');
    btnTorch.title = 'Flashlight not supported on this lens';
    isTorchOn = false;
    btnTorch.classList.remove('torch-active');
  }
}

// Toggle Torch
async function toggleTorch() {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (!videoTrack) return;

  try {
    isTorchOn = !isTorchOn;
    await videoTrack.applyConstraints({
      advanced: [{ torch: isTorchOn }]
    });

    if (isTorchOn) {
      btnTorch.classList.add('torch-active');
      showToast('Flashlight ON');
    } else {
      btnTorch.classList.remove('torch-active');
      showToast('Flashlight OFF');
    }

    // Send meta update
    sendMetaUpdate();
  } catch (err) {
    console.warn('[Torch] Could not toggle torch:', err);
    isTorchOn = false;
    btnTorch.classList.remove('torch-active');
  }
}

// Flip Camera between rear (environment) and front (user)
function flipCamera() {
  currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
  showToast(`Switching to ${currentFacingMode === 'environment' ? 'Rear' : 'Front'} Camera`);
  initCamera();
}

// Telemetry & FPS measurement
let frameCount = 0;
let lastFpsTime = performance.now();

function setupStreamTelemetry() {
  localVideo.onloadedmetadata = () => {
    updateResolutionDisplay();
  };

  function measureFps() {
    frameCount++;
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
      const fps = Math.round((frameCount * 1000) / (now - lastFpsTime));
      hudFps.textContent = `${fps} FPS`;
      frameCount = 0;
      lastFpsTime = now;
      updateResolutionDisplay();
    }
    requestAnimationFrame(measureFps);
  }
  requestAnimationFrame(measureFps);
}

function updateResolutionDisplay() {
  if (localVideo.videoWidth && localVideo.videoHeight) {
    hudResolution.textContent = `${localVideo.videoWidth}x${localVideo.videoHeight}`;
  }
}

// Replace video/audio tracks in active WebRTC connections when camera changes
function replacePeerTracks() {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  const audioTrack = localStream.getAudioTracks()[0];

  peerConnections.forEach((pc) => {
    const senders = pc.getSenders();
    if (videoTrack) {
      const vSender = senders.find(s => s.track && s.track.kind === 'video');
      if (vSender) vSender.replaceTrack(videoTrack);
    }
    if (audioTrack) {
      const aSender = senders.find(s => s.track && s.track.kind === 'audio');
      if (aSender) aSender.replaceTrack(audioTrack);
    }
  });

  sendMetaUpdate();
}

// Socket.io Connection & Signaling
const socket = io();

socket.on('connect', () => {
  console.log('[Socket] Connected to signaling server as ID:', socket.id);
  p2pStatusDot.className = 'status-dot waiting';
  p2pStatusText.textContent = 'Registered';
  socket.emit('register-sender');
});

socket.on('registered', () => {
  console.log('[Socket] Registered as active Sender');
  sendMetaUpdate();
});

// Broadcast metadata (torch, resolution, stream status)
function sendMetaUpdate() {
  socket.emit('sender-meta-update', {
    isStreaming,
    facingMode: currentFacingMode,
    torchOn: isTorchOn,
    resolution: localVideo.videoWidth ? `${localVideo.videoWidth}x${localVideo.videoHeight}` : null,
    audioEnabled: isAudioEnabled
  });
}

// Receiver joined or is waiting for stream
socket.on('receiver-joined', async ({ receiverId }) => {
  console.log(`[Signaling] Receiver joined: ${receiverId}`);
  updateReceiverCount();

  if (isStreaming) {
    await createOfferForReceiver(receiverId);
  }
});

// Receiver disconnected
socket.on('receiver-left', ({ receiverId }) => {
  console.log(`[Signaling] Receiver left: ${receiverId}`);
  if (peerConnections.has(receiverId)) {
    peerConnections.get(receiverId).close();
    peerConnections.delete(receiverId);
  }
  updateReceiverCount();
});

// Update receiver count display
socket.on('receiver-count-update', ({ count }) => {
  receiverCountNum.textContent = count;
  receiverPill.style.display = count > 0 ? 'inline-flex' : 'none';
  if (count > 0 && !isStreaming) {
    p2pStatusText.textContent = `${count} Receiver${count > 1 ? 's' : ''} Ready`;
  }
});

function updateReceiverCount() {
  const count = peerConnections.size;
  if (count > 0 && isStreaming) {
    p2pStatusDot.className = 'status-dot active';
    p2pStatusText.textContent = `Streaming (${count})`;
  }
}

// Create WebRTC Offer for a specific Receiver
async function createOfferForReceiver(receiverId) {
  if (!localStream) {
    await initCamera();
  }

  console.log(`[WebRTC] Creating peer connection for receiver: ${receiverId}`);
  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections.set(receiverId, pc);

  // Add local media tracks
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  // ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal-to-receiver', {
        receiverId,
        data: {
          type: 'candidate',
          candidate: event.candidate
        }
      });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`[WebRTC] Receiver ${receiverId} state:`, pc.connectionState);
    if (pc.connectionState === 'connected') {
      p2pStatusDot.className = 'status-dot active';
      p2pStatusText.textContent = `Live (${peerConnections.size})`;
      showToast('Connected to desktop receiver!');
    } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      peerConnections.delete(receiverId);
      updateReceiverCount();
    }
  };

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit('signal-to-receiver', {
      receiverId,
      data: {
        type: 'offer',
        sdp: offer
      }
    });
    console.log(`[WebRTC] Sent SDP offer to receiver ${receiverId}`);
  } catch (err) {
    console.error(`[WebRTC] Error creating offer for ${receiverId}:`, err);
  }
}

// Receive Answer & ICE from Receiver
socket.on('signal-from-receiver', async ({ receiverId, data }) => {
  const pc = peerConnections.get(receiverId);
  if (!pc) {
    console.warn(`[WebRTC] Received signal for unknown receiver: ${receiverId}`);
    return;
  }

  try {
    if (data.type === 'answer') {
      console.log(`[WebRTC] Received SDP answer from receiver ${receiverId}`);
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } else if (data.type === 'candidate' && data.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  } catch (err) {
    console.error(`[WebRTC] Error handling signal from receiver ${receiverId}:`, err);
  }
});

// Toggle Stream Start / Stop
btnStream.addEventListener('click', async () => {
  if (!isStreaming) {
    // Start streaming
    isStreaming = true;
    btnStream.classList.add('streaming');
    btnStreamLabel.textContent = 'Stop Stream';
    p2pStatusDot.className = 'status-dot active';
    p2pStatusText.textContent = 'Broadcasting';
    showToast('Live stream started!');

    // Emit offer to any existing receivers
    socket.emit('register-sender');
    sendMetaUpdate();
  } else {
    // Stop streaming
    isStreaming = false;
    btnStream.classList.remove('streaming');
    btnStreamLabel.textContent = 'Start Stream';
    p2pStatusDot.className = 'status-dot waiting';
    p2pStatusText.textContent = 'Stream Paused';

    // Close all current peer connections
    peerConnections.forEach((pc) => pc.close());
    peerConnections.clear();
    sendMetaUpdate();
    showToast('Stream stopped');
  }
});

// Mic Toggle
btnMic.addEventListener('click', () => {
  isAudioEnabled = !isAudioEnabled;
  if (isAudioEnabled) {
    btnMic.classList.add('active');
    showToast('Microphone ON');
  } else {
    btnMic.classList.remove('active');
    showToast('Microphone Muted');
  }
  initCamera();
});

// Resolution Change
selectResolution.addEventListener('change', () => {
  showToast(`Switching to ${selectResolution.options[selectResolution.selectedIndex].text}`);
  initCamera();
});

// Torch toggle button
btnTorch.addEventListener('click', toggleTorch);

// Flip camera button
btnFlip.addEventListener('click', flipCamera);

// Tap on viewfinder visual feedback
localVideo.addEventListener('click', (e) => {
  const rect = localVideo.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  focusRing.style.left = `${x}px`;
  focusRing.style.top = `${y}px`;
  focusRing.classList.add('active');

  setTimeout(() => {
    focusRing.classList.remove('active');
  }, 600);
});

// Initialize camera immediately
initCamera();
