# CamRelay 📹

A lightweight, browser-based video relay application that turns any smartphone camera into a wireless desktop feed in real time.

---

## 📌 Overview

**CamRelay** bridges the gap between your mobile camera and your desktop display using standard web technologies. Instead of relying on proprietary third-party apps, desktop drivers, or physical USB cables, CamRelay captures live video directly from your mobile browser and mirrors the stream onto your PC screen over your local network.

---

## ✨ Features

- **Wireless Video Relay:** Stream video directly over your local Wi-Fi network.
- **Zero App Installations:** Runs completely inside modern web browsers on both phone and PC.
- **Secure Camera Access:** Configured for HTTPS to satisfy modern browser permission requirements for camera access.
- **Low Latency:** Fast live playback tailored for real-time monitoring.

---

## 🛠️ Tech Stack

- **Backend:** Node.js, Express
- **Frontend:** HTML5, CSS3, JavaScript (MediaDevices API)
- **Networking:** Local HTTPS server, WebSockets

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher)
- Both your PC and phone connected to the **same local Wi-Fi network**

### Installation

1. **Clone the repository:**
```bash
   git clone [https://github.com/Zohafatima01/CamRelay.git](https://github.com/Zohafatima01/CamRelay.git)
   cd CamRelay

Install project dependencies:

Bash
npm install
Generate local SSL certificates (if needed):

Modern mobile browsers require HTTPS to grant camera permissions. Place your local SSL certificate files (cert.pem and key.pem) into a certs/ folder in the project root:

Bash
mkdir certs
(Note: The certs/ folder is ignored by Git to keep your keys secure).

Start the server:

Bash
node server.js
📱 How to Use
Launch server.js on your PC. Note your local machine's IP address (e.g., https://192.168.x.x:3000).

Open that URL on your smartphone browser. Accept any self-signed certificate warnings and grant camera permissions.

Open the viewer page on your PC browser (https://localhost:3000).

Your PC screen will now show the live video feed captured by your phone.

📁 Project Structure
Plaintext
CamRelay/
├── public/              # Client-side web assets (HTML, CSS, JS)
├── .gitignore           # Excludes node_modules and certs
├── package.json         # Project metadata and dependencies
├── package-lock.json    # Exact dependency tree
├── server.js            # Node.js backend server
└── README.md            # Project documentation

👤 Author
Zoha Fatima – @Zohafatima01
   ```bash
   git clone [https://github.com/Zohafatima01/CamRelay.git](https://github.com/Zohafatima01/CamRelay.git)
   cd CamRelay
