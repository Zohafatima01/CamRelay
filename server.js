const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const os = require('os');
const express = require('express');
const { Server } = require('socket.io');
const selfsigned = require('selfsigned');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 8443;
const HTTP_PORT = process.env.HTTP_PORT || 8080;

// Directory for certs
const CERTS_DIR = path.join(__dirname, 'certs');
const CERT_PATH = path.join(CERTS_DIR, 'cert.pem');
const KEY_PATH = path.join(CERTS_DIR, 'key.pem');

// Gather local network IPv4 addresses
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Filter out internal and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({
          interface: name,
          address: iface.address
        });
      }
    }
  }

  // Fallback to localhost if no LAN IP is found
  if (addresses.length === 0) {
    addresses.push({ interface: 'Loopback', address: '127.0.0.1' });
  }

  // Prioritize Wi-Fi and common private LAN subnets
  addresses.sort((a, b) => {
    const isAWiFi = /wi-?fi|wlan/i.test(a.interface);
    const isBWiFi = /wi-?fi|wlan/i.test(b.interface);
    if (isAWiFi && !isBWiFi) return -1;
    if (!isAWiFi && isBWiFi) return 1;

    const isAPrivate = a.address.startsWith('192.168.') || a.address.startsWith('10.') || a.address.startsWith('172.');
    const isBPrivate = b.address.startsWith('192.168.') || b.address.startsWith('10.') || b.address.startsWith('172.');
    if (isAPrivate && !isBPrivate) return -1;
    if (!isAPrivate && isBPrivate) return 1;
    return a.interface.localeCompare(b.interface);
  });

  return addresses;
}

// Ensure SSL/TLS certificates exist, or auto-generate with selfsigned
async function getOrGenerateCertificates() {
  if (!fs.existsSync(CERTS_DIR)) {
    fs.mkdirSync(CERTS_DIR, { recursive: true });
  }

  if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
    console.log('[SSL] Found existing certificates in certs/ directory.');
    return {
      cert: fs.readFileSync(CERT_PATH, 'utf8'),
      key: fs.readFileSync(KEY_PATH, 'utf8')
    };
  }

  console.log('[SSL] Generating new self-signed certificate with LAN IP altnames...');
  const localIps = getLocalIpAddresses().map(item => item.address);

  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' }
  ];

  localIps.forEach(ip => {
    altNames.push({ type: 7, ip: ip });
  });

  const attrs = [
    { name: 'commonName', value: 'WebRTC Local Streamer' },
    { name: 'organizationName', value: 'Local Streamer' },
    { name: 'countryName', value: 'US' }
  ];

  const pems = await selfsigned.generate(attrs, {
    keySize: 2048,
    days: 365,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'basicConstraints',
        cA: true
      },
      {
        name: 'keyUsage',
        keyCertSign: true,
        digitalSignature: true,
        nonRepudiation: true,
        keyEncipherment: true,
        dataEncipherment: true
      },
      {
        name: 'subjectAltName',
        altNames: altNames
      }
    ]
  });

  fs.writeFileSync(CERT_PATH, pems.cert, 'utf8');
  fs.writeFileSync(KEY_PATH, pems.private, 'utf8');
  console.log('[SSL] Successfully generated and stored cert.pem and key.pem.');

  return {
    cert: pems.cert,
    key: pems.private
  };
}

async function startServer() {
  const credentials = await getOrGenerateCertificates();

  // Serve static assets
  app.use(express.static(path.join(__dirname, 'public')));

  // API endpoint to retrieve server network info and dynamic QR code
  app.get('/api/info', async (req, res) => {
    const ips = getLocalIpAddresses();
    const selectedIp = req.query.ip || ips[0].address;
    const senderUrl = `https://${selectedIp}:${PORT}/sender`;
    const receiverUrl = `https://${selectedIp}:${PORT}/receiver`;
    
    let qrCodeDataUrl = '';
    try {
      qrCodeDataUrl = await QRCode.toDataURL(senderUrl, {
        width: 340,
        margin: 2,
        color: {
          dark: '#030712',
          light: '#ffffff'
        },
        errorCorrectionLevel: 'M'
      });
    } catch (err) {
      console.error('Error generating QR code:', err);
    }

    res.json({
      port: PORT,
      httpPort: HTTP_PORT,
      addresses: ips,
      primaryIp: ips[0].address,
      currentIp: selectedIp,
      senderUrl,
      receiverUrl,
      qrCodeDataUrl,
      hasCert: true
    });
  });

  // Certificate download route
  app.get('/cert.pem', (req, res) => {
    res.setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.setHeader('Content-Disposition', 'attachment; filename="webrtc-streamer-cert.pem"');
    res.sendFile(CERT_PATH);
  });

  // Main routes
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.get('/sender', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'sender.html'));
  });

  app.get('/receiver', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'receiver.html'));
  });

  // Create HTTPS server
  const httpsServer = https.createServer(credentials, app);

  // Setup Socket.io
  const io = new Server(httpsServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  // State tracking
  let activeSenderId = null;
  let senderMetadata = {
    isStreaming: false,
    facingMode: 'environment',
    torchSupported: false,
    torchOn: false,
    resolution: null,
    fps: null
  };
  const connectedReceivers = new Set();

  io.on('connection', (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    // Register Sender
    socket.on('register-sender', () => {
      activeSenderId = socket.id;
      console.log(`[Sender] Active sender registered: ${socket.id}`);
      socket.emit('registered', { role: 'sender' });
      
      io.emit('sender-status', {
        connected: true,
        metadata: senderMetadata,
        receiverCount: connectedReceivers.size
      });

      // Notify sender about all currently connected receivers
      connectedReceivers.forEach((receiverId) => {
        socket.emit('receiver-joined', { receiverId });
      });

      // Notify all connected receivers that sender is ready
      io.emit('sender-available', { senderId: socket.id });
    });

    // Register Receiver
    socket.on('register-receiver', () => {
      connectedReceivers.add(socket.id);
      console.log(`[Receiver] Registered: ${socket.id} (Receivers count: ${connectedReceivers.size})`);
      socket.emit('registered', { role: 'receiver', hasSender: !!activeSenderId });

      io.emit('receiver-count-update', { count: connectedReceivers.size });

      // If sender is already connected, prompt sender to start WebRTC offer to this receiver
      if (activeSenderId) {
        io.to(activeSenderId).emit('receiver-joined', { receiverId: socket.id });
        socket.emit('sender-status', {
          connected: true,
          metadata: senderMetadata,
          receiverCount: connectedReceivers.size
        });
      } else {
        socket.emit('sender-status', {
          connected: false,
          metadata: null,
          receiverCount: connectedReceivers.size
        });
      }
    });

    // Signaling: WebRTC Offer / ICE from Sender -> Target Receiver
    socket.on('signal-to-receiver', ({ receiverId, data }) => {
      io.to(receiverId).emit('signal-from-sender', {
        senderId: socket.id,
        data
      });
    });

    // Signaling: WebRTC Answer / ICE from Receiver -> Sender
    socket.on('signal-to-sender', ({ data }) => {
      if (activeSenderId) {
        io.to(activeSenderId).emit('signal-from-receiver', {
          receiverId: socket.id,
          data
        });
      }
    });

    // Sender metadata update (battery, torch, resolution, etc.)
    socket.on('sender-meta-update', (meta) => {
      if (socket.id === activeSenderId) {
        senderMetadata = { ...senderMetadata, ...meta };
        io.emit('sender-status', {
          connected: true,
          metadata: senderMetadata,
          receiverCount: connectedReceivers.size
        });
      }
    });

    // Disconnection
    socket.on('disconnect', () => {
      if (socket.id === activeSenderId) {
        console.log(`[Sender] Active sender disconnected: ${socket.id}`);
        activeSenderId = null;
        senderMetadata.isStreaming = false;
        io.emit('sender-status', {
          connected: false,
          metadata: null,
          receiverCount: connectedReceivers.size
        });
        io.emit('sender-left');
      } else if (connectedReceivers.has(socket.id)) {
        connectedReceivers.delete(socket.id);
        console.log(`[Receiver] Disconnected: ${socket.id} (Remaining: ${connectedReceivers.size})`);
        if (activeSenderId) {
          io.to(activeSenderId).emit('receiver-left', { receiverId: socket.id });
        }
        io.emit('receiver-count-update', { count: connectedReceivers.size });
      }
    });
  });

  // Optional HTTP redirect server
  const httpApp = express();
  httpApp.use((req, res) => {
    const host = req.headers.host ? req.headers.host.split(':')[0] : 'localhost';
    res.redirect(`https://${host}:${PORT}${req.url}`);
  });
  const httpServer = http.createServer(httpApp);

  // Start listening
  httpsServer.listen(PORT, '0.0.0.0', () => {
    const ips = getLocalIpAddresses();
    console.log('\n=============================================================');
    console.log('  🎥 WebRTC Video Streaming Server (HTTPS) is RUNNING!');
    console.log('=============================================================');
    console.log(`  Localhost:     https://localhost:${PORT}`);
    ips.forEach(ip => {
      console.log(`  LAN Network:   https://${ip.address}:${PORT}  (${ip.interface})`);
    });
    console.log('-------------------------------------------------------------');
    console.log(`  📲 Mobile Sender:   https://${ips[0].address}:${PORT}/sender`);
    console.log(`  🖥️ Desktop Receiver: https://localhost:${PORT}/receiver`);
    console.log(`  🔗 Hub & QR Code:   https://${ips[0].address}:${PORT}/`);
    console.log('=============================================================\n');
  });

  httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`[HTTP Redirect] Listening on port ${HTTP_PORT} (auto-redirects to HTTPS ${PORT})`);
  }).on('error', (err) => {
    console.log(`[HTTP Redirect] Note: port ${HTTP_PORT} in use (${err.message}). HTTPS on ${PORT} is active.`);
  });
}

startServer().catch(err => {
  console.error('[FATAL] Failed to start server:', err);
  process.exit(1);
});
