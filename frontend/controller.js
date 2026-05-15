// ═══════════════════════════════════════════════════
//  Nightwing — Mobile Robot Controller (controller.js)
//  Open on phone: http://<pi-ip>/controller
// ═══════════════════════════════════════════════════

// Connect through Nginx (port 80) instead of direct backend port 8000
// This ensures mobile browsers can reach the socket without being blocked.
const socket = io(); 
socket.on('connect', () => {
    console.log('[Socket] Connected to Pi');
    const badge = document.getElementById('conn-badge');
    if (badge) {
        badge.textContent = '● Connected';
        badge.className = 'conn-badge connected';
    }
});
socket.on('connect_error', (err) => {
    console.error('[Socket] Connection Error:', err);
});
socket.on('disconnect', () => {
    console.warn('[Socket] Disconnected from Pi');
    const badge = document.getElementById('conn-badge');
    if (badge) {
        badge.textContent = '● Disconnected';
        badge.className = 'conn-badge disconnected';
    }
});
const API_BASE = `${location.protocol}//${location.hostname}`; // Use standard port for fetch too

// ── State ──
let currentSpeed   = 75;
let currentDir     = 'stop';
let activeBtn      = null;
let holdInterval   = null;  // Sends repeated move commands while held

// ── DOM ──
const connBadge   = document.getElementById('conn-badge');
const dirDisplay  = document.getElementById('dir-display');
const spdDisplay  = document.getElementById('spd-display');
const gasMini     = document.getElementById('gas-mini');
const fireMini    = document.getElementById('fire-mini');
const speedSlider = document.getElementById('speed-slider');
const speedVal    = document.getElementById('speed-val');
const hazardBar      = document.getElementById('hazard-bar');
const hazardOverlay  = document.getElementById('hazard-overlay');
const video          = document.getElementById('remote-video');
const videoPlaceholder = document.getElementById('video-placeholder');

// ══════════════════════════════════════════════════
//  SOCKET.IO — Connection & Sensor Events
// ══════════════════════════════════════════════════
socket.on('connect', () => {
    connBadge.textContent = '● Online';
    connBadge.className   = 'conn-badge connected';
});

socket.on('disconnect', () => {
    connBadge.textContent = '● Offline';
    connBadge.className   = 'conn-badge disconnected';
    // Safety: stop motors if connection drops
    sendCommand('stop');
});

// Sensor status updates from server
socket.on('hazard_status', (data) => {
    updateMiniSensor('gas',  data.gas);
    updateMiniSensor('fire', data.fire);
});

socket.on('hazard_alert', (data) => {
    updateMiniSensor(data.sensor, data.value);
    if (data.value === 1) showHazardBar(data.sensor);
});

// Motor status echo from server
socket.on('motor_status', (data) => {
    currentDir = data.direction;
    dirDisplay.textContent = data.direction.toUpperCase();
    spdDisplay.textContent = `${data.speed}%`;
});

// Fullscreen hazard handling
socket.on('hazard_alert', (data) => {
    if (data.value === 1) {
        showHazardOverlay(data.sensor);
    }
});

// ══════════════════════════════════════════════════
//  SENSOR MINI DISPLAY
// ══════════════════════════════════════════════════
function updateMiniSensor(type, value) {
    const el = type === 'gas' ? gasMini : fireMini;
    if (value === 1) {
        el.textContent  = 'ALERT';
        el.className    = 'status-val alert';
    } else {
        el.textContent  = 'SAFE';
        el.className    = 'status-val safe';
    }
}

let hazardTimer = null;
function showHazardBar(sensor) {
    hazardBar.textContent = sensor === 'gas'
        ? '🚨 GAS DETECTED!'
        : '🔥 FLAME DETECTED!';
    hazardBar.className = `hazard-bar ${sensor === 'gas' ? 'gas-alert' : 'fire-alert'}`;
    hazardBar.classList.remove('hidden');
    if (hazardTimer) clearTimeout(hazardTimer);
    hazardTimer = setTimeout(() => hazardBar.classList.add('hidden'), 6000);

    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}

function showHazardOverlay(sensor) {
    document.getElementById('hazard-title').textContent = sensor.toUpperCase() + ' DETECTED';
    document.getElementById('hazard-msg').textContent = sensor === 'gas' 
        ? 'Dangerous gas levels detected. Evacuate or check robot surroundings!' 
        : 'Fire detected in the immediate vicinity!';
    hazardOverlay.classList.remove('hidden');
    if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);
}

function dismissHazard() {
    hazardOverlay.classList.add('hidden');
}

// ══════════════════════════════════════════════════
//  MOTOR COMMANDS
// ══════════════════════════════════════════════════
function sendCommand(direction) {
    socket.emit('motor_move', {
        direction,
        speed: currentSpeed
    });
}

// Called on button press (touch/mouse down)
function startMove(direction) {
    clearInterval(holdInterval);

    // Highlight active button
    if (activeBtn) activeBtn.classList.remove('active-press');
    activeBtn = document.getElementById(`btn-${dirToId(direction)}`);
    if (activeBtn) activeBtn.classList.add('active-press');

    // Send immediately
    sendCommand(direction);

    // Keep sending while held (every 200ms) to handle server-side timeouts
    holdInterval = setInterval(() => sendCommand(direction), 200);
}

// Called on button release (touch/mouse up)
function stopMove() {
    clearInterval(holdInterval);
    sendCommand('stop');
    if (activeBtn) {
        activeBtn.classList.remove('active-press');
        activeBtn = null;
    }
}

// Called on center stop button click
function sendStop() {
    clearInterval(holdInterval);
    sendCommand('stop');
    if (activeBtn) {
        activeBtn.classList.remove('active-press');
        activeBtn = null;
    }
    if (navigator.vibrate) navigator.vibrate(50);
}

// Emergency brake — hard stop
function emergencyBrake() {
    clearInterval(holdInterval);
    sendCommand('brake');
    if (activeBtn) {
        activeBtn.classList.remove('active-press');
        activeBtn = null;
    }
    // Strong haptic for emergency
    if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 300]);
}

function dirToId(dir) {
    return { forward: 'fwd', backward: 'bwd', left: 'left', right: 'right' }[dir] || dir;
}

// ══════════════════════════════════════════════════
//  SPEED SLIDER
// ══════════════════════════════════════════════════
speedSlider.addEventListener('input', () => {
    currentSpeed = parseInt(speedSlider.value);
    speedVal.textContent = currentSpeed;
    spdDisplay.textContent = `${currentSpeed}%`;

    // Update slider gradient fill dynamically
    const pct = ((currentSpeed - 20) / 80) * 100;
    speedSlider.style.setProperty('--pct', `${pct}%`);
});

// ══════════════════════════════════════════════════
//  PAN + TILT SERVO CONTROLS
// ══════════════════════════════════════════════════
let servoTimeout = null;

const panSlider      = document.getElementById('pan-slider');
const panVal         = document.getElementById('pan-val');
const ctrlTiltSlider = document.getElementById('tilt-slider');
const ctrlTiltVal    = document.getElementById('ctrl-tilt-val');

if (panSlider) {
    panSlider.addEventListener('input', () => {
        const angle = parseInt(panSlider.value);
        if (panVal) panVal.textContent = angle;
        if (servoTimeout) clearTimeout(servoTimeout);
        servoTimeout = setTimeout(() => {
            socket.emit('servo_control', { angle });
        }, 50);
    });
}

if (ctrlTiltSlider) {
    ctrlTiltSlider.addEventListener('input', () => {
        const angle = parseInt(ctrlTiltSlider.value);
        if (ctrlTiltVal) ctrlTiltVal.textContent = angle;
        if (servoTimeout) clearTimeout(servoTimeout);
        servoTimeout = setTimeout(() => {
            socket.emit('tilt_control', { angle });
        }, 50);
    });
}

function quickTilt(angle) {
    if (ctrlTiltSlider) ctrlTiltSlider.value = angle;
    if (ctrlTiltVal) ctrlTiltVal.textContent = angle;
    socket.emit('tilt_control', { angle });
}

// Sync tilt feedback from server
socket.on('servo_moved', (data) => {
    if (panSlider) panSlider.value = data.angle;
    if (panVal) panVal.textContent = data.angle;
});

socket.on('tilt_moved', (data) => {
    if (ctrlTiltSlider) ctrlTiltSlider.value = data.angle;
    if (ctrlTiltVal) ctrlTiltVal.textContent = data.angle;
});

// ══════════════════════════════════════════════════
//  KEYBOARD SUPPORT (for testing on PC)
// ══════════════════════════════════════════════════
const keyMap = {
    ArrowUp:    'forward',  w: 'forward',  W: 'forward',
    ArrowDown:  'backward', s: 'backward', S: 'backward',
    ArrowLeft:  'left',     a: 'left',     A: 'left',
    ArrowRight: 'right',    d: 'right',    D: 'right',
    ' ':        'stop',
    'b':        'brake',    B: 'brake',
};

const heldKeys = new Set();

document.addEventListener('keydown', (e) => {
    // Ignore if typing in an input field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (keyMap[e.key]) {
        e.preventDefault(); // Block scrolling (ArrowUp, ArrowDown, Space)
        if (!heldKeys.has(e.key)) {
            heldKeys.add(e.key);
            const dir = keyMap[e.key];
            if (dir === 'brake') emergencyBrake();
            else if (dir === 'stop') sendStop();
            else startMove(dir);
        }
    }
});

document.addEventListener('keyup', (e) => {
    if (keyMap[e.key] && keyMap[e.key] !== 'stop' && keyMap[e.key] !== 'brake') {
        heldKeys.delete(e.key);
        stopMove();
    }
});

// ══════════════════════════════════════════════════
//  SAFETY — Auto-stop if page loses focus
// ══════════════════════════════════════════════════
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        clearInterval(holdInterval);
        sendCommand('stop');
    }
});

window.addEventListener('blur', () => {
    clearInterval(holdInterval);
    sendCommand('stop');
});

// ══════════════════════════════════════════════════
//  WEBRTC — Mobile Surveillance Feed
// ══════════════════════════════════════════════════
let pc = null;

async function startWebRTC() {
    console.log('[WebRTC] Initiating Mobile Surveillance Handshake...');
    
    // Cleanup if existing
    if (pc) {
        pc.close();
        pc = null;
    }

    pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.ontrack = (event) => {
        console.log('[WebRTC] Video Track Received');
        if (event.track.kind === 'video') {
            video.srcObject = new MediaStream([event.track]);
            videoPlaceholder.style.display = 'none';
            video.play().catch(e => console.warn('[WebRTC] Autoplay prevented:', e));
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log('[WebRTC] State:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'disconnected') {
            videoPlaceholder.style.display = 'flex';
        }
    };

    // Add a transceiver for video only (recvonly)
    pc.addTransceiver('video', { direction: 'recvonly' });

    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const res = await fetch(`${API_BASE}/webrtc/offer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sdp: pc.localDescription.sdp, type: pc.localDescription.type })
        });

        if (res.ok) {
            const answer = await res.json();
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
            console.log('[WebRTC] Mobile Connection Established.');
        } else {
            console.error('[WebRTC] Connection Failed. Status:', res.status);
            videoPlaceholder.innerHTML = `<p>Connect failed (${res.status})</p>`;
        }
    } catch (err) {
        console.error('[WebRTC] CRASH:', err);
        videoPlaceholder.innerHTML = `<p>WebRTC Error: Check Network</p>`;
    }
}

// Initializing background video and connection delay
window.addEventListener('load', () => {
    setTimeout(startWebRTC, 1000);
});
