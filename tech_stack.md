# Tech Stack – Hazardous Area Surveillance Robot (Web Interface)

This document defines the complete technology stack for the web-based interface
responsible for:

- Live HD Video Streaming
- Dual-Side Audio Communication (WebRTC)
- Gas/Fire Detection Live Alerts
- Video Recording (Client + Server Side)
- Real-Time Sensor Data Dashboard
- WebSocket-based Live Updates

Vehicle/motor control logic is intentionally excluded.

---

# 1. System Architecture Overview

Browser (User)
   ↕ WebRTC (Audio/Video)
   ↕ WebSocket (Sensor Data)
   ↕ HTTPS REST (Recording, Status)
Raspberry Pi 4 (Server)
   ↕
Camera + Mic + Speaker + Sensors

---

# 2. Frontend Stack

## Core
- HTML5
- CSS3 (TailwindCSS recommended)
- JavaScript (ES6+)

## Framework (Recommended)
- React.js (Vite) OR
- Vanilla JS (for lightweight deployment)

## Real-Time Communication
- WebRTC (for video + 2-way audio)
- Socket.IO Client (real-time alerts)

## Recording (Client Side)
- MediaRecorder API

## UI Enhancements
- Chart.js (sensor graphs)
- Toast notifications (for alerts)
- Fullscreen API

---

# 3. Backend Stack (Raspberry Pi 4)

## Runtime
- Python 3.10+

## Web Framework
- Flask (Lightweight & sufficient)
  OR
- FastAPI (Recommended for scalability)

## Real-Time Communication
- Flask-SocketIO (WebSockets)

## Video & Audio Streaming
Option A (Recommended):
- WebRTC using:
  - aiortc (Python WebRTC)
  OR
  - UV4L (Raspberry Pi optimized WebRTC driver)

Option B:
- GStreamer pipeline
- OpenCV (fallback streaming)

## Sensor Interface
- RPi.GPIO OR gpiozero

## Video Recording
- picamera2 (Bookworm)
OR
- picamera (Legacy OS)

---

# 4. Communication Protocols

| Feature              | Protocol Used |
|----------------------|---------------|
| Video + Audio        | WebRTC        |
| Sensor Live Alerts   | WebSocket     |
| Recording Trigger    | REST API      |
| Status Fetch         | REST/WS       |

---

# 5. Database (Optional)

If storing logs:

- SQLite (default lightweight DB)
OR
- PostgreSQL (if scaling multi-device)

Used For:
- Gas detection logs
- Fire detection logs
- Recording metadata
- Event timestamps

---

# 6. Deployment

## On Raspberry Pi
- Gunicorn (WSGI server)
- Nginx (Reverse proxy)
- systemd service for auto-start

## Network
- Local WiFi
OR
- Raspberry Pi Hotspot Mode

---

# 7. Security Layer

- HTTPS (self-signed or Let's Encrypt)
- Basic authentication login
- CSRF protection
- WebRTC secured channel (DTLS/SRTP)

---

# 8. Folder Structure

project-root/
│
├── backend/
│   ├── app.py
│   ├── webrtc.py
│   ├── sensors.py
│   ├── recording.py
│   └── templates/
│
├── frontend/
│   ├── index.html
│   ├── main.js
│   ├── styles.css
│
├── static/
│
├── recordings/
│
└── techstack.md

---

# 9. Recommended Final Stack (Balanced)

Frontend:
- React + Tailwind + WebRTC

Backend:
- FastAPI + Socket.IO
- aiortc (WebRTC)
- picamera2
- RPi.GPIO

Deployment:
- Gunicorn + Nginx

---

This stack ensures:
✅ Low latency video
✅ Stable 2-way audio
✅ Real-time hazard alerts
✅ On-device recording
✅ Scalable architecture