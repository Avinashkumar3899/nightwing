# 🦇 NIGHTWING — Hazardous Area Surveillance Robot

> A remotely operated, AI-assisted surveillance robot designed for hazardous environments. Real-time HD video, 2-way audio intercom, autonomous obstacle braking, gas/flame detection, and full pan+tilt camera control — all accessible from a browser on any device.

---

## 📌 Project Goal

To build a remotely controlled surveillance robot capable of safely operating in **hazardous areas** (smoke-filled rooms, industrial sites, fire zones) where human presence is dangerous. The operator monitors the environment in real time from a safe distance using a laptop or smartphone, with instant alerts for gas leaks and fire detection.

---

## ✨ Features

| Feature | Description |
|---|---|
| **Live HD Video** | 1280×720 @ 22fps streamed via WebRTC with near-zero latency |
| **Multi-Viewer** | Laptop and phone can watch the live feed simultaneously |
| **Motor Control** | Full D-Pad drive control (forward, backward, left, right, brake) |
| **Camera Pan** | Horizontal 0°–180° rotation via SG90 servo |
| **Camera Tilt** | Vertical 30°–150° tilt via second SG90 servo |
| **Gas Detection** | MQ-2 sensor with analog + digital threshold, debounced alerts |
| **Flame Detection** | IR flame sensor with audio/visual alert on dashboard |
| **Ultrasonic Radar** | HC-SR04 reads every 200ms, auto-stops robot if obstacle < 20cm |
| **Obstacle Auto-Brake** | Robot halts automatically and locks until operator resumes |
| **2-Way Intercom** | Operator mic → robot speakers; robot USB mic → browser |
| **AI Sentinel** | SSD MobileNet V2 person detection with auto-recording trigger |
| **Motion Detection** | Software frame-diff motion alert with video recording |
| **Mission Memory** | Record a drive path and replay it autonomously |
| **Server Recording** | Pi-side H.264 video recording with hazard metadata |
| **Browser Recording** | WebM video download directly to operator's computer |
| **Digital Zoom** | 1× to 4× software zoom (5 steps) |
| **Storage Monitor** | SD card usage broadcast to dashboard every 5 minutes |
| **Battery Monitor** | ESP32 reports battery percentage to dashboard |
| **Mobile Controller** | Dedicated touch-optimized D-Pad UI for smartphones |
| **Hazard Logging** | All events logged to SQLite with CSV export |
| **Dark Dashboard** | Glassmorphism UI with real-time sensor cards and radar display |

---

## 🔩 Hardware Components

### Main Computing
| Component | Model | Role |
|---|---|---|
| Single-Board Computer | Raspberry Pi 4 (4GB) | Main brain — runs backend, WebRTC, motors |
| Microcontroller | ESP32 (30-pin) | Sensor node — gas, flame, servo PWM |

### Camera
| Component | Spec | Role |
|---|---|---|
| Pi Camera | Raspberry Pi Camera Module v2 | Live surveillance feed |
| Pan Servo | SG90 (9g) | Horizontal camera rotation (0°–180°) |
| Tilt Servo | SG90 (9g) | Vertical camera tilt (30°–150°) |
| Pan+Tilt Mount | 2-axis SG90 bracket | Physical camera gimbal |

### Drive System
| Component | Spec | Role |
|---|---|---|
| Motor Driver | L298N Dual H-Bridge | Controls 4 DC motors via PWM |
| DC Motors | TT Gear Motors × 4 | Robot wheel drive |
| Chassis | 4WD robot car platform | Frame |

### Sensors
| Component | Model | Measures |
|---|---|---|
| Gas Sensor | MQ-2 | Smoke, LPG, methane (analog + digital) |
| Flame Sensor | IR Flame Module | Fire / IR radiation (digital) |
| Ultrasonic | HC-SR04 | Distance 2cm–400cm (obstacle detection) |

### Audio
| Component | Role |
|---|---|
| USB Microphone | Robot-side audio captured → sent to operator browser |
| Pi Speaker (3.5mm) | Plays operator voice received via WebRTC intercom |

### Power
| Component | Role |
|---|---|
| LiPo 7.4V 2200mAh | Powers motors via L298N |
| Power bank (5V USB) | Powers Raspberry Pi 4 |
| USB (5V) | Powers ESP32 |

---

## 🔌 Hardware Connections

### Pi GPIO → L298N Motor Driver
```
Pi GPIO 12 ──► ENA  (Left motor PWM speed)
Pi GPIO 13 ──► ENB  (Right motor PWM speed)
Pi GPIO 17 ──► IN1  (Left motor forward)
Pi GPIO 27 ──► IN2  (Left motor backward)
Pi GPIO 22 ──► IN3  (Right motor forward)
Pi GPIO 23 ──► IN4  (Right motor backward)
Pi GND     ──► GND
```

### Pi GPIO → HC-SR04 Ultrasonic
```
Pi GPIO 5  ──► TRIG
Pi GPIO 6  ◄── ECHO  (use voltage divider: 1kΩ + 2kΩ — Pi is 3.3V only)
Pi 3.3V    ──► VCC
Pi GND     ──► GND
```

### Pi UART → ESP32 UART
```
Pi GPIO 14 (TX) ──► ESP32 GPIO 16 (RX)
Pi GPIO 15 (RX) ◄── ESP32 GPIO 17 (TX)
Pi GND          ──► ESP32 GND  (shared common ground)
```

### ESP32 → MQ-2 Gas Sensor
```
ESP32 GPIO 35 ◄── MQ-2 AO  (Analog — 12-bit ADC)
ESP32 GPIO 34 ◄── MQ-2 DO  (Digital — active low)
ESP32 3.3V    ──► VCC
ESP32 GND     ──► GND
```

### ESP32 → Flame Sensor
```
ESP32 GPIO 32 ◄── Flame DO (Digital — active low)
ESP32 3.3V    ──► VCC
ESP32 GND     ──► GND
```

### ESP32 → Pan + Tilt Servos (SG90)
```
ESP32 GPIO 25 ──► Pan Servo Signal  (horizontal, 0°–180°)
ESP32 GPIO 26 ──► Tilt Servo Signal (vertical, 30°–150°)
ESP32 5V      ──► Both Servo VCC
ESP32 GND     ──► Both Servo GND
```

---

## 🗂️ Software Stack

### Raspberry Pi Backend
| Library | Purpose |
|---|---|
| FastAPI | REST API framework |
| uvicorn | ASGI server |
| python-socketio | Real-time WebSocket events |
| aiortc | WebRTC peer connection |
| picamera2 (apt) | Camera capture |
| RPi.GPIO | L298N motor PWM |
| pyserial | UART to ESP32 |
| aiosqlite | Async SQLite |
| opencv-python-headless | Motion detection, zoom, AI |
| numpy | Frame array processing |
| av | Audio/video frame encoding |
| pyaudio | USB microphone capture |

### ESP32 Firmware (Arduino IDE)
| Library | Purpose |
|---|---|
| ESP32Servo | PWM servo control |
| ArduinoJson | JSON serialization |

### Frontend (Browser)
| Library | Purpose |
|---|---|
| Socket.IO 4.5.4 | Real-time events |
| Font Awesome 6.4 | Icons |
| Google Fonts | Typography (Inter, JetBrains Mono) |

### Infrastructure
| Tool | Role |
|---|---|
| Nginx | Reverse proxy (port 80 → port 8000) |
| systemd | Auto-start on Pi boot |
| SQLite | Local hazard + mission log database |

---

## 🏗️ System Architecture

```
┌──────────────────────────────────────────────────────┐
│              OPERATOR DEVICES                        │
│  💻 Laptop (index.html)   📱 Phone (controller.html) │
└──────────────┬──────────────────────┬────────────────┘
               │     WiFi (port 80)   │
               ▼                      ▼
┌─────────────────────────────────────────────────────┐
│               NGINX REVERSE PROXY                   │
│  /           → index.html                           │
│  /controller → controller.html                      │
│  /socket.io/ → FastAPI:8000 (WebSocket)             │
│  /api/       → FastAPI:8000                         │
│  /webrtc/    → FastAPI:8000                         │
└──────────────────────┬──────────────────────────────┘
                       │ localhost:8000
                       ▼
┌─────────────────────────────────────────────────────┐
│      FASTAPI BACKEND  (backend/app.py)              │
│                                                     │
│  webrtc.py    Camera + WebRTC + Audio tracks        │
│  motors.py    L298N GPIO PWM motor control          │
│  sensors.py   UART reader + pan/tilt commands       │
│  ultrasonic.py HC-SR04 radar + obstacle auto-brake  │
│  database.py  SQLite logs                           │
│  recording.py H.264 Pi-side recording               │
│  ai.py        SSD MobileNet V2 person detection     │
└──────────────────────┬──────────────────────────────┘
                       │ UART (GPIO 14/15, 115200 baud)
                       ▼
┌─────────────────────────────────────────────────────┐
│                ESP32 FIRMWARE                       │
│  GPIO 35: MQ-2 Analog    GPIO 25: Pan Servo         │
│  GPIO 34: MQ-2 Digital   GPIO 26: Tilt Servo        │
│  GPIO 32: Flame Sensor   GPIO 16/17: UART           │
└─────────────────────────────────────────────────────┘
```

---

## ⚙️ Working Flow — All Subsystems

### 1. Live Video
```
Picamera2 → GlobalCamera thread (22fps)
  → Apply zoom / motion detection / record if active
    → PiCamera2Track.recv() → aiortc WebRTC
      → Browser <video> element displays live feed
```

### 2. Sensor Data
```
ESP32 reads sensors every 200ms
  → JSON via UART → Pi HazardMonitor thread
    → Debounce (3 consecutive hits = confirmed alert)
      → On state change: log to SQLite + emit Socket.IO alert
        → Dashboard flashes + beeps; mobile vibrates
```

### 3. Motor Control
```
User holds D-Pad → socket.emit('motor_move') every 300ms
  → clear_obstacle_lock() + set motor direction via GPIO
    → L298N drives 4 motors
      → motor_status echoed back to update UI
```

### 4. Obstacle Auto-Brake
```
HC-SR04 polled every 200ms
  → distance < 20cm AND robot moving:
      → motor_controller.stop()
      → obstacle_locked = True (blocks forward/left/right)
        → Unlocked when operator sends any new command
```

### 5. Camera Pan + Tilt
```
Pan slider → socket.emit('servo_control', {angle})
  → UART: {"cmd":"servo","angle":X} → ESP32 panServo.write()

Tilt slider → socket.emit('tilt_control', {angle})
  → UART: {"cmd":"tilt","angle":X} → ESP32 tiltServo.write()

Both emit ACK → sio.emit("servo_moved"/"tilt_moved") syncs all UIs
```

### 6. 2-Way Audio Intercom
```
Robot → Operator:
  PyAudio USB mic → MicrophoneTrack → WebRTC audio track
    → Browser <audio> element plays robot-side sound

Operator → Robot:
  Browser getUserMedia() → WebRTC track → player_audio_track()
    → aplay subprocess plays PCM on Pi speakers
      (aplay avoids ALSA/PyAudio segfault)
```

### 7. AI Sentinel
```
SSD MobileNet V2 inference on every frame (300×300)
  → Person detected (confidence > 50%):
      → sio.emit("person_detected") → browser
        → Auto-recording starts, 60s countdown
          → Recording stops when countdown expires
```

### 8. Mission Memory (Autonomous Patrol)
```
Record: Every motor + servo command stored with timestamp offset
  → Operator drives desired path → clicks Stop

Playback: run_patrol() replays all events with exact delays
  → Auto-records video → saves to operator PC on completion
```

---

## 🌐 UART Protocol Reference

| Direction | Purpose | JSON |
|---|---|---|
| ESP32 → Pi | Sensor data | `{"type":"sensor","gas_a":1024,"gas_d":1,"flame_d":1}` |
| ESP32 → Pi | Pan ACK | `{"type":"servo_ack","angle":90}` |
| ESP32 → Pi | Tilt ACK | `{"type":"tilt_ack","angle":90}` |
| Pi → ESP32 | Pan command | `{"cmd":"servo","angle":90}` |
| Pi → ESP32 | Tilt command | `{"cmd":"tilt","angle":90}` |

---

## 🔗 Key API Endpoints

| Method | URL | Action |
|---|---|---|
| POST | `/webrtc/offer` | WebRTC SDP handshake |
| POST | `/api/motor` | Motor command |
| POST | `/api/servo` | Pan servo angle |
| POST | `/api/tilt` | Tilt servo angle |
| POST | `/recording/start` | Start Pi recording |
| GET | `/api/status` | Current sensor status |
| GET | `/api/export/mission` | Download telemetry CSV |
| POST | `/api/mission/patrol/start` | Start autonomous patrol |
| GET | `/controller` | Mobile controller page |

---

## 📁 File Structure

```
nightwing/
├── backend/
│   ├── app.py           FastAPI routes + Socket.IO events
│   ├── webrtc.py        Camera, WebRTC, audio tracks
│   ├── motors.py        L298N motor driver
│   ├── ultrasonic.py    HC-SR04 radar + auto-brake
│   ├── sensors.py       ESP32 UART + pan/tilt commands
│   ├── recording.py     Pi-side H.264 recording
│   ├── database.py      SQLite hazard + mission logs
│   └── ai.py            SSD MobileNet V2 person detection
├── frontend/
│   ├── index.html       Main operator dashboard
│   ├── main.js          Dashboard logic
│   ├── styles.css       Dark glassmorphism UI
│   ├── controller.html  Mobile D-Pad controller
│   ├── controller.js    Mobile logic
│   └── controller.css   Mobile styles
├── esp32_firmware/
│   └── nightwing_esp32.ino  Sensor reads + servo PWM
├── nginx.conf           Reverse proxy config
├── robot-interface.service  systemd auto-start
└── requirements.txt     Python dependencies
```

---

## 🚀 Deployment

```bash
# 1. Install system packages on Pi
sudo apt install -y python3-picamera2 nginx

# 2. Set up Python environment
cd /home/pi/nightwing
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# 3. Configure Nginx
sudo cp nginx.conf /etc/nginx/sites-available/nightwing
sudo ln -s /etc/nginx/sites-available/nightwing /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo systemctl restart nginx

# 4. Enable auto-start service
sudo cp robot-interface.service /etc/systemd/system/
sudo systemctl enable --now robot-interface

# 5. Flash ESP32 via Arduino IDE
# Libraries needed: ESP32Servo, ArduinoJson
```

**Access:** `http://raspberrypi.local` (laptop) | `http://raspberrypi.local/controller` (phone)

---

## 📊 Performance

| Metric | Value |
|---|---|
| Video | 1280×720 @ ~22fps, ~150–300ms latency |
| Sensor polling | 200ms (5Hz) |
| Obstacle brake threshold | 20 cm |
| Pan range | 0° – 180° |
| Tilt range | 30° – 150° |
| AI confidence threshold | 50% |
| Database | SQLite (local, no cloud) |

---

*Built with FastAPI · aiortc · Socket.IO · Picamera2 · RPi.GPIO · ESP32 · ArduinoJson*
