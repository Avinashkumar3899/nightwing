# Product Specification Document
Hazardous Area Surveillance Robot – Web Interface

Version: 1.0
Scope: Video, Audio, Hazard Monitoring, Recording
Excludes: Vehicle Control

---

# 1. Product Overview

This system provides a web-based interface for remotely:

- Viewing live HD video
- Communicating via 2-way audio
- Receiving gas/fire alerts in real time
- Recording live footage
- Viewing hazard logs

Target Users:
- Disaster response teams
- Industrial safety operators
- Research projects
- Educational institutions

---

# 2. Core Features

## 2.1 Live Video Streaming

- HD 720p minimum
- <500ms latency
- Fullscreen support
- Night compatibility (camera dependent)

---

## 2.2 Dual-Side Audio Communication

- Real-time microphone input from browser
- Robot speaker playback
- Robot mic streamed back to browser
- Echo suppression enabled

---

## 2.3 Gas Detection Monitoring

- Real-time sensor state display
- Visual alert banner
- Audio warning sound
- Timestamped event logging

Display Example:

STATUS: ✅ SAFE
OR
⚠ GAS DETECTED – 14:22:10

---

## 2.4 Fire Detection Monitoring

- Active low detection
- Flash warning screen
- Severity indicator (future expansion)

---

## 2.5 Video Recording

### Client Mode
User clicks "Record"
→ Browser saves .webm file locally

### Server Mode
User clicks "Start Recording"
→ Raspberry Pi stores .mp4 file

---

## 2.6 Dashboard Interface Layout

-------------------------------------------------
| Live Video Stream                            |
|-----------------------------------------------|
| Sensor Status Panel                          |
|  Gas: SAFE / ALERT                           |
|  Fire: SAFE / ALERT                          |
|-----------------------------------------------|
| Record Button | Fullscreen | Mute | Logs     |
-------------------------------------------------

---

# 3. Non-Functional Requirements

Reliability:
- Must run 2+ hours continuously

Latency:
- Video < 500ms
- Sensor updates < 300ms

Compatibility:
- Chrome
- Edge
- Firefox
- Android Chrome

---

# 4. User Flow

1. User connects to Raspberry Pi IP
2. Login (if enabled)
3. Live dashboard loads
4. WebRTC auto-connects
5. User sees video
6. If hazard detected → UI flashes alert
7. User may record session

---

# 5. Future Enhancements

- Cloud backup of recordings
- AI-based smoke detection (vision-based)
- Thermal camera integration
- Multi-user monitoring
- Mobile app version

---

# 6. Constraints

- Runs on Raspberry Pi 4
- Limited CPU resources
- Requires stable WiFi
- WebRTC requires modern browser

---

# 7. Success Criteria

✅ Stable live stream
✅ Clear 2-way audio
✅ Instant hazard alerts
✅ Reliable recording
✅ No system crashes

---

End of Product Document