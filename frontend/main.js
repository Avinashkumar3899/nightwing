// ═══════════════════════════════════════════════════
//  Nightwing Surveillance Dashboard — main.js
//  Updated for: ESP32 UART sensors + SG90 servo
// ═══════════════════════════════════════════════════

const API_BASE = '';
const socket   = io(API_BASE);

// ── State ──
let pc               = null;
let mediaRecorder    = null;
let recordedChunks   = [];
let isServerRecording = false;
let isMuted          = false;
let currentAngle     = 90;
let currentTiltAngle = 90;

// Sentinel (AI) State
let isSentinelActive  = false;
let sentinelTimer     = null;
let sentinelCooldown  = 0;
let isManualRecording = false;
let isPatrollingLocal = false;
let isIntercomActive  = false;

// ── DOM ──
const remoteVideo       = document.getElementById('remote-video');
const videoPlaceholder  = document.getElementById('video-placeholder');
const gasStatus         = document.getElementById('gas-status');
const gasAnalogEl       = document.getElementById('gas-analog');
const fireStatus        = document.getElementById('fire-status');
const gasCard           = document.getElementById('gas-card');
const fireCard          = document.getElementById('fire-card');
const gasIndicator      = document.getElementById('gas-indicator');
const fireIndicator     = document.getElementById('fire-indicator');
const logList           = document.getElementById('log-list');
const connStatus        = document.getElementById('conn-status');
const alertBanner       = document.getElementById('alert-banner');
const recIndicator      = document.getElementById('recording-indicator');
const sliderVal         = document.getElementById('slider-val');
const servoBadge        = document.getElementById('servo-angle-badge');
const servoSlider       = document.getElementById('servo-slider');
const tiltBadge         = document.getElementById('tilt-angle-badge');
const tiltSlider        = document.getElementById('tilt-slider');
const tiltSliderVal     = document.getElementById('tilt-slider-val');
const battIcon          = document.getElementById('batt-icon');
const battText          = document.getElementById('batt-text');
const battCard          = document.getElementById('battery-indicator');
const storageText       = document.getElementById('storage-text');
const storageCard       = document.getElementById('storage-indicator');
const btnServoMove      = document.getElementById('btn-servo-move');
const btnRecordClient   = document.getElementById('btn-record-client');
const btnRecordServer   = document.getElementById('btn-record-server');
const btnMute           = document.getElementById('btn-mute');
const btnFullscreen     = document.getElementById('btn-fullscreen');
const btnClearLogs      = document.getElementById('btn-clear-logs');
const btnExportCsv      = document.getElementById('btn-export-csv');
const btnClearMission    = document.getElementById('btn-clear-mission');

// Mission Memory DOM
const btnRecordMission   = document.getElementById('btn-record-mission');
const btnStopMissionRec  = document.getElementById('btn-stop-mission-record');
const btnStartPatrol     = document.getElementById('btn-start-patrol');
const patrolRepeats      = document.getElementById('patrol-repeats');
const missionDot         = document.getElementById('mission-status-dot');
const missionProgress    = document.getElementById('mission-progress');
const patrolRoundText    = document.getElementById('patrol-round-text');
const btnIntercom        = document.getElementById('btn-intercom');
const robotAudio         = document.getElementById('robot-audio');

const btnMotorModal     = document.getElementById('btn-motor-modal');

// Vision Enhancement DOM
const btnNightVision    = document.getElementById('btn-night-vision');
const btnMotionDetect   = document.getElementById('btn-motion-detect');
const motionIndicator   = document.getElementById('motion-indicator');
const btnZoomIn         = document.getElementById('btn-zoom-in');
const btnZoomOut        = document.getElementById('btn-zoom-out');
const zoomLevelBadge    = document.getElementById('zoom-level-badge');
let   currentZoom       = 1.0;

// Modal & Draggable elements
const motorModal        = document.getElementById('motor-modal');
const btnCloseModal     = document.getElementById('btn-close-motor-modal');
// modalHeader removed in Stealth Strip mode — dragging uses motorModal itself

// Motor specifics
const speedSlider       = document.getElementById('speed-slider');
const speedVal          = document.getElementById('speed-val'); // May be null in Stealth Strip
const dirDisplay        = document.getElementById('dir-display');
const spdDisplay        = document.getElementById('spd-display');
let moveInterval        = null;
let currentDirection    = 'stop';

// Shared hazard state for fullscreen tracking
const hazards = { gas: 0, fire: 0, radar: 0, radarDist: 0 };

// ══════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════
async function init() {
    updateClock();
    setInterval(updateClock, 1000);
    setupSocketHandlers();
    setupServoControls();
    setupRecordingControls();
    setupUtilityButtons();
    setupMotorModal();
    setupMotorControls();
    setupDraggableModal();
    setupMissionControls();
    setupFullscreenControls();
    setupVisionControls();
    setupIntercomControls();
    loadInitialLogs();
    
    // WebRTC is now started automatically by the Socket.IO 'connect' event
    // This ensures it also restarts cleanly on reconnections
}

// ══════════════════════════════════════════════════
//  CLOCK
// ══════════════════════════════════════════════════
function updateClock() {
    const el = document.getElementById('current-time');
    if (el) el.textContent = new Date().toLocaleTimeString('en-IN', { hour12: false });
}

// ══════════════════════════════════════════════════
//  WEBRTC
// ══════════════════════════════════════════════════
async function startWebRTC() {
    try {
        // Always clean up old connection first
        if (pc) {
            try { pc.close(); } catch(e) {}
            pc = null;
        }

        pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        pc.addTransceiver('video', {direction: 'recvonly'});
        // Always include audio in the offer so we can receive robot mic
        pc.addTransceiver('audio', {direction: 'recvonly'});

        pc.ontrack = (event) => {
            console.log('[WebRTC] Track detected:', event.track.kind);
            if (event.track.kind === 'video') {
                if (event.streams && event.streams[0]) {
                    remoteVideo.srcObject = event.streams[0];
                } else {
                    remoteVideo.srcObject = new MediaStream([event.track]);
                }
                
                // Critical: ensure playback starts
                remoteVideo.onloadedmetadata = () => {
                    console.log(`[WebRTC] Video started: ${remoteVideo.videoWidth}x${remoteVideo.videoHeight}`);
                    remoteVideo.play()
                        .then(() => console.log('[WebRTC] Playback OK'))
                        .catch(e => console.error('[WebRTC] Playback failed:', e));
                };
                videoPlaceholder.style.display = 'none';
            }
            
            if (event.track.kind === 'audio') {
                console.log('[WebRTC] Receiving Robot Voice...');
                if (event.streams && event.streams[0]) {
                    robotAudio.srcObject = event.streams[0];
                } else {
                    robotAudio.srcObject = new MediaStream([event.track]);
                }
            }
        };

        pc.onconnectionstatechange = () => {
            console.log('[WebRTC] State:', pc.connectionState);
        };

        // Add local microphone (2-way) - ONLY if intercom is active
        if (isIntercomActive && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
                const localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
            } catch (e) {
                console.warn('[WebRTC] Microphone not available:', e.message);
                isIntercomActive = false;
                if (btnIntercom) btnIntercom.classList.remove('active');
            }
        }

        console.log('[WebRTC] Creating Offer...');
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        console.log('[WebRTC] Sending Offer to Pi...');
        const res = await fetch(`${API_BASE}/webrtc/offer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sdp: pc.localDescription.sdp, type: pc.localDescription.type })
        });

        if (res.ok) {
            console.log('[WebRTC] Offer Accepted by Pi. Receiving Answer...');
            const answer = await res.json();
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
            console.log('[WebRTC] Handshake Complete. Connection established.');
        } else {
            console.error('[WebRTC] Pi rejected offer:', res.status);
        }
    } catch (err) {
        console.error('[WebRTC] Handshake CRASH:', err);
    }
}

// ══════════════════════════════════════════════════
//  SOCKET.IO — Sensor Events
// ══════════════════════════════════════════════════
function setupSocketHandlers() {
    socket.on('connect', () => {
        connStatus.textContent = '● Connected';
        connStatus.className   = 'conn-badge connected';
        console.log('[Socket] Connected. Starting WebRTC...');
        // Debounce: Only start WebRTC once after connection stabilizes
        if (window._webrtcReconnectTimer) clearTimeout(window._webrtcReconnectTimer);
        window._webrtcReconnectTimer = setTimeout(() => {
            startWebRTC();
        }, 1000);
    });

    socket.on('disconnect', () => {
        connStatus.textContent = '● Disconnected';
        connStatus.className   = 'conn-badge disconnected';
        console.log('[Socket] Disconnected. Cleaning up WebRTC...');
        // Kill any pending reconnect
        if (window._webrtcReconnectTimer) clearTimeout(window._webrtcReconnectTimer);
        // Clean up old WebRTC connection to prevent zombie tracks
        if (pc) {
            try { pc.close(); } catch(e) {}
            pc = null;
        }
    });

    // Periodic status broadcast (500ms)
    socket.on('hazard_status', (data) => {
        updateSensorUI('gas',  data.gas,  data.gas_analog);
        updateSensorUI('fire', data.fire, null);
        if (data.battery !== undefined) updateBatteryUI(data.battery);
    });

    socket.on('storage_status', (data) => {
        updateStorageUI(data);
    });

    // MISSION MEMORY (THE MEMORY)
    socket.on('patrol_status', (data) => {
        handlePatrolStatus(data);
    });

    // VISION ENHANCEMENT
    // Night vision removed per user request
    socket.on('zoom_status', (data) => {
        currentZoom = data.level;
        const label = currentZoom === 1.0 ? '1×' : `${currentZoom}×`;
        zoomLevelBadge.textContent = label;
    });

    // MOTION DETECTION
    socket.on('motion_detection_status', (data) => {
        const on = data.enabled;
        btnMotionDetect.classList.toggle('active', on);
        btnMotionDetect.title = on ? 'Motion Detection: ON' : 'Motion Detection: OFF';
    });

    // RADAR DATA
    socket.on('radar_data', (data) => {
        const dist = data.distance_cm;
        const badge = document.getElementById('radar-distance-badge');
        const container = document.getElementById('radar-container');
        const warning = document.getElementById('radar-warning');
        const blip = document.getElementById('radar-blip');

        if (badge) badge.textContent = `${dist} cm`;

        if (dist > 0 && dist <= 100) {
            blip.style.bottom = `${dist}px`;
            blip.classList.remove('hidden');
        } else {
            blip.classList.add('hidden');
        }

        if (dist > 0 && dist <= 20) {
            container.classList.add('danger-mode');
            warning.classList.remove('hidden');
            hazards.radar = 1;
            hazards.radarDist = dist;
        } else {
            container.classList.remove('danger-mode');
            warning.classList.add('hidden');
            hazards.radar = 0;
        }
        updateFullscreenAlerts();
    });

    socket.on('motion_detected', (data) => {
        // Flash the MOTION badge in the video panel for 3 seconds
        motionIndicator.classList.remove('hidden');
        clearTimeout(window._motionBadgeTimer);
        window._motionBadgeTimer = setTimeout(() => {
            motionIndicator.classList.add('hidden');
        }, 3000);

        // Log in Mission Intelligence
        appendLog({
            type:      'motion',
            sensor:    'motion',
            value:     1,
            timestamp: data.timestamp
        });
    });

    // Change-event alerts
    socket.on('hazard_alert', (data) => {
        appendLog(data);
        updateSensorUI(data.sensor, data.value, data.analog ?? null);
        if (data.value === 1) flashBanner(data.sensor);
    });

    socket.on('recording_status', (data) => {
        isServerRecording = (data.status === 'recording');
        updateServerRecordUI();
    });

    socket.on('servo_moved', (data) => {
        currentAngle = data.angle;
        servoSlider.value = currentAngle;
        sliderVal.textContent  = currentAngle;
        servoBadge.textContent = `Pan: ${currentAngle}°`;
    });

    socket.on('tilt_moved', (data) => {
        currentTiltAngle = data.angle;
        if (tiltSlider) tiltSlider.value = currentTiltAngle;
        if (tiltSliderVal) tiltSliderVal.textContent = currentTiltAngle;
        if (tiltBadge) tiltBadge.textContent = `Tilt: ${currentTiltAngle}°`;
    });

    // Motor status echo from server
    socket.on('motor_status', (data) => {
        currentDirection = data.direction;
        dirDisplay.textContent = data.direction.toUpperCase();
        spdDisplay.textContent = `${data.speed}%`;
    });

    // AI SENTINEL: Automatic Person Recognition & Recording
    socket.on('person_detected', (data) => {
        handleSentinelTrigger(data);
    });
}

function handleSentinelTrigger(data) {
    console.log('[Sentinel] Person detected!', data);
    
    // Priority: Manual recording takes precedence. Do not disturb.
    if (isManualRecording) return;

    sentinelCooldown = 60; // Reset 1-minute countdown
    updateSentinelUI();

    if (!isSentinelActive) {
        console.log('[Sentinel] Starting Auto-Recording...');
        isSentinelActive = true;
        startClientRecording(true); // 'true' flag means started by AI
        
        // Start the countdown heartbeat
        if (sentinelTimer) clearInterval(sentinelTimer);
        sentinelTimer = setInterval(() => {
            sentinelCooldown--;
            updateSentinelUI();

            if (sentinelCooldown <= 0) {
                console.log('[Sentinel] Cool-down finished. Stopping recording.');
                stopSentinelRecording();
            }
        }, 1000);
    }
}

function stopSentinelRecording() {
    if (sentinelTimer) {
        clearInterval(sentinelTimer);
        sentinelTimer = null;
    }
    isSentinelActive = false;
    sentinelCooldown = 0;
    updateSentinelUI();
    
    // Final check: Only stop if it was actually started by the AI
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
}

function updateSentinelUI() {
    const banner = document.getElementById('sentinel-banner');
    if (!banner) return; // Banner might not exist in simple HTML

    if (isSentinelActive) {
        banner.classList.remove('hidden');
        banner.textContent = `👁 SENTINEL ACTIVE: Auto-Recording (${sentinelCooldown}s)`;
    } else {
        banner.classList.add('hidden');
    }
}

// ══════════════════════════════════════════════════
//  SENSOR UI
// ══════════════════════════════════════════════════
function updateSensorUI(type, value, analog = null) {
    const isGas   = (type === 'gas');
    const statusEl = isGas ? gasStatus  : fireStatus;
    const cardEl   = isGas ? gasCard    : fireCard;
    const indEl    = isGas ? gasIndicator : fireIndicator;
    const alertCls = isGas ? 'hazard-gas'   : 'hazard-fire';
    const indCls   = isGas ? 'alert-gas'    : 'alert-fire';

    if (value === 1) {
        statusEl.textContent = '⚠ ALERT';
        statusEl.style.color = isGas ? 'var(--red)' : 'var(--orange)';
        cardEl.classList.add(alertCls);
        indEl.className = `sensor-indicator ${indCls}`;
        hazards[type] = 1;
    } else {
        statusEl.textContent = 'SAFE';
        statusEl.style.color = 'var(--green)';
        cardEl.classList.remove('hazard-gas', 'hazard-fire');
        indEl.className = 'sensor-indicator safe';
        hazards[type] = 0;
    }

    if (isGas && analog !== null && analog !== undefined) {
        gasAnalogEl.textContent = `ADC: ${analog} / 4095`;
    }

    updateFullscreenAlerts();
}

function updateFullscreenAlerts() {
    const fsOverlay = document.getElementById('fullscreen-hazard-overlay');
    const fsText = document.getElementById('hazard-overlay-text');
    if (!fsOverlay || !fsText) return;

    // Reset styles
    fsOverlay.classList.remove('hazard-fire', 'hazard-gas', 'hazard-radar');

    if (hazards.fire) {
        fsOverlay.classList.remove('hidden');
        fsOverlay.classList.add('hazard-fire');
        fsText.textContent = "FIRE DETECTED!";
    } else if (hazards.gas) {
        fsOverlay.classList.remove('hidden');
        fsOverlay.classList.add('hazard-gas');
        fsText.textContent = "GAS WARNING!";
    } else if (hazards.radar) {
        fsOverlay.classList.remove('hidden');
        fsOverlay.classList.add('hazard-radar');
        fsText.textContent = `OBSTACLE: ${hazards.radarDist} CM`;
    } else {
        fsOverlay.classList.add('hidden');
    }
}

function updateBatteryUI(percent) {
    if (!battIcon || !battText || !battCard) return;

    battText.textContent = `${percent}%`;

    // 1. Update Icons
    battIcon.className = 'fas';
    if (percent > 90) battIcon.classList.add('fa-battery-full');
    else if (percent > 60) battIcon.classList.add('fa-battery-three-quarters');
    else if (percent > 35) battIcon.classList.add('fa-battery-half');
    else if (percent > 15) battIcon.classList.add('fa-battery-quarter');
    else battIcon.classList.add('fa-battery-empty');

    // 2. Update Colors & Heartbeat
    battCard.classList.remove('batt-high', 'batt-medium', 'batt-low');
    if (percent > 50) battCard.classList.add('batt-high');
    else if (percent > 20) battCard.classList.add('batt-medium');
    else battCard.classList.add('batt-low');
}

function updateStorageUI(data) {
    if (!storageText || !storageCard) return;

    const percent = data.percent;
    storageText.textContent = `${percent}%`;
    
    // Update colors based on usage
    storageCard.classList.remove('storage-warning', 'storage-critical');
    
    if (percent >= 95) {
        storageCard.classList.add('storage-critical');
        // Flash a specific warning banner for memory
        if (percent % 1 === 0) { // Only log once on update
             console.warn('[Storage] Memory CRITICAL!');
        }
    } else if (percent >= 85) {
        storageCard.classList.add('storage-warning');
    }
}

// ══════════════════════════════════════════════════
//  ALERT BANNER
// ══════════════════════════════════════════════════
let bannerTimer = null;

function flashBanner(sensor) {
    alertBanner.textContent = sensor === 'gas'
        ? '🚨 GAS DETECTED — Evacuate Area!'
        : '🔥 FLAME DETECTED — Fire Alert!';
    alertBanner.className = `alert-banner ${sensor === 'gas' ? 'gas-alert' : 'fire-alert'}`;
    alertBanner.classList.remove('hidden');

    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => alertBanner.classList.add('hidden'), 5000);

    playBeep(sensor);
}

// ══════════════════════════════════════════════════
//  AUDIO ALERT (Web Audio API — no external cost)
// ══════════════════════════════════════════════════
function playBeep(sensor) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = sensor === 'gas' ? 880 : 660;
        osc.type = 'square';
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
        osc.start();
        osc.stop(ctx.currentTime + 0.6);
    } catch (e) { /* Blocked by browser policy */ }
}

// ══════════════════════════════════════════════════
//  SERVO CONTROLS (Real-time Debounced)
// ══════════════════════════════════════════════════
let servoTimeout = null;

function setupServoControls() {
    // Pan slider
    servoSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        syncServoUI(val);
        
        if(servoTimeout) clearTimeout(servoTimeout);
        servoTimeout = setTimeout(() => {
            socket.emit('servo_control', { angle: parseInt(val) });
        }, 50);
    });

    // Tilt slider
    if (tiltSlider) {
        tiltSlider.addEventListener('input', (e) => {
            const val = e.target.value;
            syncTiltUI(val);

            if(servoTimeout) clearTimeout(servoTimeout);
            servoTimeout = setTimeout(() => {
                socket.emit('tilt_control', { angle: parseInt(val) });
            }, 50);
        });
    }
}

function syncServoUI(val) {
    sliderVal.textContent = val;
    servoBadge.textContent = `Pan: ${val}°`;
    servoSlider.value = val;
    
    // Also sync FS slider if it exists
    const fsSlider = document.getElementById('fs-servo-slider');
    const fsVal    = document.getElementById('fs-slider-val');
    if (fsSlider) {
        fsSlider.value = val;
        if (fsVal) fsVal.textContent = val;
    }
}

function syncTiltUI(val) {
    if (tiltSliderVal) tiltSliderVal.textContent = val;
    if (tiltBadge) tiltBadge.textContent = `Tilt: ${val}°`;
    if (tiltSlider) tiltSlider.value = val;

    // Also sync FS tilt slider if it exists
    const fsTiltSlider = document.getElementById('fs-tilt-slider');
    const fsTiltVal    = document.getElementById('fs-tilt-val');
    if (fsTiltSlider) {
        fsTiltSlider.value = val;
        if (fsTiltVal) fsTiltVal.textContent = val;
    }
}

async function sendServoAngle(angle) {
    try {
        const res = await fetch(`${API_BASE}/api/servo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ angle })
        });
        if (res.ok) {
            currentAngle = angle;
            servoBadge.textContent = `Pan: ${angle}°`;
            sliderVal.textContent  = angle;
        }
    } catch (e) {
        console.error('[Servo] Pan command failed:', e);
    }
}

async function sendTiltAngle(angle) {
    try {
        const res = await fetch(`${API_BASE}/api/tilt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ angle })
        });
        if (res.ok) {
            currentTiltAngle = angle;
            if (tiltBadge) tiltBadge.textContent = `Tilt: ${angle}°`;
            if (tiltSliderVal) tiltSliderVal.textContent = angle;
        }
    } catch (e) {
        console.error('[Servo] Tilt command failed:', e);
    }
}

// Quick preset buttons (called from HTML onclick)
function quickServo(angle) {
    servoSlider.value     = angle;
    sliderVal.textContent = angle;
    syncServoUI(angle);
    sendServoAngle(angle);
    document.querySelectorAll('.servo-presets:first-of-type .preset-btn').forEach(b => b.classList.remove('active'));
    const map = { 0: 'btn-servo-0', 90: 'btn-servo-90', 180: 'btn-servo-180' };
    if (map[angle]) document.getElementById(map[angle])?.classList.add('active');
}

function quickTilt(angle) {
    syncTiltUI(angle);
    sendTiltAngle(angle);
    document.querySelectorAll('#btn-tilt-30, #btn-tilt-90, #btn-tilt-150').forEach(b => b.classList.remove('active'));
    const map = { 30: 'btn-tilt-30', 90: 'btn-tilt-90', 150: 'btn-tilt-150' };
    if (map[angle]) document.getElementById(map[angle])?.classList.add('active');
}

// ══════════════════════════════════════════════════
//  RECORDING CONTROLS
// ══════════════════════════════════════════════════
function setupRecordingControls() {
    // Client-side (browser MediaRecorder)
    btnRecordClient.addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            // Manual stop always clears both flags
            isManualRecording = false;
            if (isSentinelActive) stopSentinelRecording();
            else mediaRecorder.stop();
            
            btnRecordClient.textContent = '⏺ Record (Browser)';
            btnRecordClient.classList.remove('danger');
        } else {
            isManualRecording = true; // Mark as manual user intent
            startClientRecording(false);
        }
    });

    // Server-side (Raspberry Pi picamera2)
    btnRecordServer.addEventListener('click', async () => {
        const action = isServerRecording ? 'stop' : 'start';
        try {
            await fetch(`${API_BASE}/recording/${action}`, { method: 'POST' });
        } catch (e) {
            alert('Failed to toggle server recording. Is the backend running?');
        }
    });
}

function startClientRecording(isAI = false) {
    if (!remoteVideo.srcObject) { 
        if (!isAI) alert('No video stream to record.'); 
        return; 
    }
    if (!remoteVideo.captureStream && !remoteVideo.mozCaptureStream) { 
        alert('Browser recording not supported. Try Chrome or Firefox.'); 
        return; 
    }
    remoteVideo.onloadedmetadata = () => {
        console.log(`Video size: ${remoteVideo.videoWidth}x${remoteVideo.videoHeight}`);
    };
    remoteVideo.onplay = () => {
        console.log("Video playback started");
    };
    const stream = remoteVideo.captureStream
        ? remoteVideo.captureStream()
        : remoteVideo.mozCaptureStream();
    recordedChunks = [];
    mediaRecorder  = new MediaRecorder(stream, { mimeType: 'video/webm' });
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `nightwing_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 500);

        // UI Reset
        btnRecordClient.textContent = '⏺ Record (Browser)';
        btnRecordClient.classList.remove('danger');
        const fsBtnRecordClient = document.getElementById('fs-btn-record-client');
        if (fsBtnRecordClient) { fsBtnRecordClient.textContent = '⏺ Browser'; fsBtnRecordClient.classList.remove('danger'); }

        if (!isServerRecording) recIndicator.classList.add('hidden');
    };
    mediaRecorder.start();
    btnRecordClient.textContent = '⏹ Stop (Browser)';
    btnRecordClient.classList.add('danger');
    const fsBtnRecordClient = document.getElementById('fs-btn-record-client');
    if (fsBtnRecordClient) { fsBtnRecordClient.textContent = '⏹ Stop (Browser)'; fsBtnRecordClient.classList.add('danger'); }

    recIndicator.classList.remove('hidden');
}

function updateServerRecordUI() {
    const fsBtnRecordServer = document.getElementById('fs-btn-record-server');
    if (isServerRecording) {
        btnRecordServer.textContent = '⏹ Stop (Pi)';
        btnRecordServer.classList.add('danger');
        if(fsBtnRecordServer) { fsBtnRecordServer.textContent = '⏹ Stop (Pi)'; fsBtnRecordServer.classList.add('danger'); }
        recIndicator.classList.remove('hidden');
    } else {
        btnRecordServer.textContent = '⏺ Record (Pi)';
        btnRecordServer.classList.remove('danger');
        if(fsBtnRecordServer) { fsBtnRecordServer.textContent = '⏺ HD (Pi)'; fsBtnRecordServer.classList.remove('danger'); }
        recIndicator.classList.add('hidden');
    }
}

// ══════════════════════════════════════════════════
//  UTILITY BUTTONS
// ══════════════════════════════════════════════════
function setupUtilityButtons() {
    btnMute.addEventListener('click', () => {
        isMuted = !isMuted;
        remoteVideo.muted = isMuted;
        
        // Also handle the robot-audio element
        if (robotAudio) {
            robotAudio.muted = isMuted;
            if (!isMuted) {
                robotAudio.play().catch(e => console.warn("[Audio] Playback blocked by browser:", e));
            }
        }
        
        btnMute.textContent = isMuted ? '🔊 Unmute' : '🔇 Mute';
        const fsBtnMute = document.getElementById('fs-btn-mute');
        if (fsBtnMute) fsBtnMute.textContent = btnMute.textContent;
    });

    btnFullscreen.addEventListener('click', () => {
        const el = document.getElementById('video-section');
        document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen();
    });

    btnClearLogs.addEventListener('click', () => {
        logList.innerHTML = '<p class="log-placeholder">Log cleared.</p>';
    });

    if (btnExportCsv) {
        btnExportCsv.addEventListener('click', () => {
            console.log('[Mission] Exporting logs...');
            window.location.href = `${API_BASE}/api/export/mission`;
        });
    }

    if (btnClearMission) {
        btnClearMission.addEventListener('click', async () => {
            if (confirm('Are you sure you want to start a NEW mission? This will clear all historical data from the server for this duration.')) {
                try {
                    const res = await fetch(`${API_BASE}/api/mission/clear`, { method: 'POST' });
                    if (res.ok) {
                        alert('New session started. Mission logs cleared.');
                        logList.innerHTML = '<p class="log-placeholder">New mission started…</p>';
                    }
                } catch (e) {
                    console.error('[Mission] Clear failed:', e);
                }
            }
        });
    }
}

// ══════════════════════════════════════════════════
//  FULLSCREEN GLASS CONTROLS
// ══════════════════════════════════════════════════
function setupFullscreenControls() {
    const fsOverlay = document.getElementById('fs-controls-overlay');
    if (!fsOverlay) return;

    // Listen for fullscreen toggle to show/hide overlay
    document.addEventListener('fullscreenchange', () => {
        const fsTarget = document.fullscreenElement;
        if (fsTarget) {
            fsOverlay.classList.remove('hidden');
            // JUMP HUD INTO THE ACTIVE FULLSCREEN ELEMENT
            fsTarget.appendChild(motorModal);
            motorModal.classList.add('in-fullscreen');
        } else {
            fsOverlay.classList.add('hidden');
            document.getElementById('fs-slider-popup').classList.add('hidden'); 
            // JUMP HUD BACK TO DASHBOARD ROOT
            document.body.appendChild(motorModal);
            motorModal.classList.remove('in-fullscreen');
        }
    });

    // Proxy Button Clicks with Force Show
    document.getElementById('fs-btn-motor-modal').addEventListener('click', () => {
        // Toggle via the main button's listener logic
        btnMotorModal.click();
    });

    // Proxy Button Clicks
    document.getElementById('fs-btn-record-client').addEventListener('click', () => btnRecordClient.click());
    document.getElementById('fs-btn-record-server').addEventListener('click', () => btnRecordServer.click());
    document.getElementById('fs-btn-mute').addEventListener('click', () => btnMute.click());
    document.getElementById('fs-btn-exit').addEventListener('click', () => document.exitFullscreen());

    // Camera Slider Popup Toggle
    const fsBtnCamera = document.getElementById('fs-btn-camera');
    const fsSliderPopup = document.getElementById('fs-slider-popup');
    fsBtnCamera.addEventListener('click', () => {
        fsSliderPopup.classList.toggle('hidden');
    });

    // Sync FS Slider
    const fsServoSlider = document.getElementById('fs-servo-slider');
    fsServoSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        syncServoUI(val);
        
        if(servoTimeout) clearTimeout(servoTimeout);
        servoTimeout = setTimeout(() => {
            socket.emit('servo_control', { angle: parseInt(val) });
        }, 50);
    });
}

// ══════════════════════════════════════════════════
//  VISION ENHANCEMENT (NIGHT VISION + ZOOM)
// ══════════════════════════════════════════════════
const ZOOM_STEPS = [1.0, 1.5, 2.0, 3.0, 4.0];

function setupVisionControls() {
    // Night Vision removed per user request

    // Motion Detection toggle
    if (btnMotionDetect) {
        btnMotionDetect.addEventListener('click', () => {
            socket.emit('toggle_motion_detection', {});
        });
    }

    // Zoom In
    btnZoomIn.addEventListener('click', () => {
        const idx = ZOOM_STEPS.indexOf(currentZoom);
        const next = ZOOM_STEPS[Math.min(idx + 1, ZOOM_STEPS.length - 1)];
        if (next !== currentZoom) socket.emit('set_zoom', { level: next });
    });

    // Zoom Out
    btnZoomOut.addEventListener('click', () => {
        const idx = ZOOM_STEPS.indexOf(currentZoom);
        const prev = ZOOM_STEPS[Math.max(idx - 1, 0)];
        if (prev !== currentZoom) socket.emit('set_zoom', { level: prev });
    });
}

// ══════════════════════════════════════════════════
//  MISSION MEMORY (AUTONOMOUS PATROL)
// ══════════════════════════════════════════════════
function setupMissionControls() {
    if (!btnRecordMission) return;

    btnRecordMission.addEventListener('click', async () => {
        const res = await fetch(`${API_BASE}/api/mission/record/start`, { method: 'POST' });
        if (res.ok) {
            btnRecordMission.disabled = true;
            btnStopMissionRec.disabled = false;
            missionDot.classList.add('active', 'hidden-not'); 
            missionDot.classList.remove('hidden');
            console.log('[Mission] Recording started...');
        }
    });

    btnStopMissionRec.addEventListener('click', async () => {
        const res = await fetch(`${API_BASE}/api/mission/record/stop`, { method: 'POST' });
        if (res.ok) {
            btnRecordMission.disabled = false;
            btnStopMissionRec.disabled = true;
            btnStartPatrol.disabled = false;
            missionDot.classList.remove('active');
            missionDot.classList.add('hidden');
            console.log('[Mission] Recording stopped.');
        }
    });

    btnStartPatrol.addEventListener('click', async () => {
        if (isPatrollingLocal) {
            await stopPatrol();
        } else {
            const repeats = patrolRepeats.value || 1;
            try {
                const res = await fetch(`${API_BASE}/api/mission/patrol/start?repeats=${repeats}`, { method: 'POST' });
                if (!res.ok) {
                    const err = await res.json();
                    alert(`Patrol Failed: ${err.detail || 'Unknown error'}`);
                    return;
                }
                // UI state will be fully synced via handlePatrolStatus socket events
                isPatrollingLocal = true; 
            } catch (e) {
                alert('Connection error: Could not start patrol.');
            }
        }
    });
}

function handlePatrolStatus(data) {
    if (data.status === 'started') {
        console.log('[Patrol] Autonomous mission started!');
        isPatrollingLocal = true;
        missionProgress.classList.remove('hidden');
        btnStartPatrol.textContent = "⏹ Stop Patrol";
        btnStartPatrol.classList.add('danger');
        patrolRoundText.textContent = `Patrolling: Round 1 / ${data.total}`;
        
        // AUTO-RECORDING: Start browser video recording for the mission
        if (!mediaRecorder || mediaRecorder.state !== 'recording') {
            startClientRecording(true); // Tag as auto-recording
        }
    } 
    
    if (data.status === 'running') {
        isPatrollingLocal = true;
        patrolRoundText.textContent = `Patrolling: Round ${data.round} / ${data.total}`;
    }

    if (data.status === 'finished') {
        isPatrollingLocal = false;
        missionProgress.classList.add('hidden');
        btnStartPatrol.textContent = "▶ Start Patrol";
        btnStartPatrol.classList.remove('danger');
        btnStartPatrol.onclick = null; // Reset to default handler next time
        
        // AUTO-RECORDING: Stop and save the video when patrol finishes
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            console.log('[Patrol] Mission complete. Stopping recorder...');
            setTimeout(() => {
                if (mediaRecorder.state === 'recording') {
                    mediaRecorder.stop();
                    alert('🎬 Patrol Mission Complete! Video recording saved to your computer.');
                }
            }, 500); // Small buffer to capture the final "stop" frame
        }
    }
}

async function stopPatrol() {
    await fetch(`${API_BASE}/api/mission/patrol/stop`, { method: 'POST' });
}

// ══════════════════════════════════════════════════
//  MOTOR FLOATING MODAL
// ══════════════════════════════════════════════════
function setupMotorModal() {
    btnMotorModal.addEventListener('click', () => {
        const isHidden = motorModal.classList.toggle('hidden');
        if (!isHidden) {
            // Ensure it's visible in the viewport if it was dragged away
            const rect = motorModal.getBoundingClientRect();
            if (rect.top < 0 || rect.left < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) {
                motorModal.style.top = '80%';
                motorModal.style.left = '50%';
            }
            console.log('[HUD] Motor control active.');
        }
    });

    // Close button
    if (btnCloseModal) {
        btnCloseModal.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent triggering the toggle if they click close
            motorModal.classList.add('hidden');
            console.log('[HUD] Motor control minimized.');
        });
    }
}

function setupDraggableModal() {
    let isDragging = false;
    let offset = { x: 0, y: 0 };

    // In Stealth Mode, the entire modal is the drag handle
    motorModal.addEventListener('mousedown', (e) => {
        // Prevent dragging when interacting with sliders or buttons
        if (e.target.tagName.toLowerCase() === 'button' || e.target.tagName.toLowerCase() === 'input') return;
        
        isDragging = true;
        const rect = motorModal.getBoundingClientRect();
        
        offset.x = e.clientX - rect.left;
        offset.y = e.clientY - rect.top;
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const parentRect = motorModal.parentElement.getBoundingClientRect();
        
        // Calculate new position within parent bounds
        let left = e.clientX - parentRect.left - offset.x;
        let top  = e.clientY - parentRect.top - offset.y;
        
        motorModal.style.left = left + 'px';
        motorModal.style.top = top + 'px';
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}

// ══════════════════════════════════════════════════
//  MOTOR API INTEGRATION
// ══════════════════════════════════════════════════
function setupMotorControls() {
    speedSlider.addEventListener('input', () => {
        if (speedVal) speedVal.textContent = speedSlider.value;
    });
    speedSlider.addEventListener('change', () => {
        const val = parseInt(speedSlider.value);
        spdDisplay.textContent = `${val}%`;
        sendSpeed(val);
    });
}

function sendMotorCommand(direction, speed = null) {
    const payload = { direction };
    payload.speed = speed !== null ? speed : parseInt(speedSlider.value);
    
    // High-speed WebSocket transmission instead of REST HTTP
    socket.emit('motor_move', payload);
}

function sendSpeed(speed) {
    sendMotorCommand('set_speed', speed);
}

function dirToId(dir) {
    return { forward: 'fwd', backward: 'bwd', left: 'left', right: 'right' }[dir] || dir;
}

function startMove(dir) {
    document.querySelectorAll('.dpad-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`btn-${dirToId(dir)}`);
    if (btn) btn.classList.add('active');
    
    currentDirection = dir;
    dirDisplay.textContent = dir.toUpperCase();
    sendMotorCommand(dir);

    // Keep-alive heartbeat (300ms)
    if (moveInterval) clearInterval(moveInterval);
    moveInterval = setInterval(() => {
        sendMotorCommand(dir);
    }, 300);
}

function stopMove() {
    if (moveInterval) {
        clearInterval(moveInterval);
        moveInterval = null;
    }
    // Only send stop automatically if they released a d-pad button,
    // not if they pressed a dedicated hard stop
    if (currentDirection !== 'stop') {
        currentDirection = 'stop';
        dirDisplay.textContent = 'STOPPED';
        sendMotorCommand('stop');
    }
    document.querySelectorAll('.dpad-btn').forEach(b => b.classList.remove('active'));
}

function sendStop() {
    if (moveInterval) clearInterval(moveInterval);
    moveInterval = null;
    currentDirection = 'stop';
    dirDisplay.textContent = 'STOPPED';
    document.querySelectorAll('.dpad-btn').forEach(b => b.classList.remove('active'));
    sendMotorCommand('stop');
}

function emergencyBrake() {
    sendStop();
    sendMotorCommand('stop');
    speedSlider.value = 20;
    speedVal.textContent = "20";
    spdDisplay.textContent = "20%";
    sendSpeed(20);
}

// ══════════════════════════════════════════════════
//  LOGS
// ══════════════════════════════════════════════════
function appendLog(data) {
    const placeholder = logList.querySelector('.log-placeholder');
    if (placeholder) placeholder.remove();

    const item = document.createElement('div');
    item.className = 'log-item';
    
    let timeStr = '00:00:00';
    try {
        const d = new Date(data.timestamp);
        if (isNaN(d.getTime())) {
            // If it's already a time string (HH:MM:SS), use it directly
            if (typeof data.timestamp === 'string' && data.timestamp.includes(':')) {
                timeStr = data.timestamp;
            } else {
                timeStr = new Date().toLocaleTimeString('en-IN', { hour12: false });
            }
        } else {
            timeStr = d.toLocaleTimeString('en-IN', { hour12: false });
        }
    } catch (e) {
        timeStr = new Date().toLocaleTimeString('en-IN', { hour12: false });
    }
    const sensorCls = data.sensor === 'gas' ? 'log-sensor-gas' : 'log-sensor-fire';
    const analogStr = data.analog != null ? `<span class="log-analog">(ADC: ${data.analog})</span>` : '';
    const status    = data.value === 1 ? 'DETECTED' : 'CLEARED';
    item.innerHTML = `
        <span class="log-time">${timeStr}</span>
        <span class="${sensorCls}">${data.sensor.toUpperCase()} ${status}</span>
        ${analogStr}
    `;
    logList.prepend(item);

    // Keep last 100 entries
    while (logList.children.length > 100) logList.removeChild(logList.lastChild);
}

async function loadInitialLogs() {
    try {
        const res  = await fetch(`${API_BASE}/api/logs`);
        const logs = await res.json();
        logs.forEach(log => appendLog({
            sensor:    log.sensor_type,
            value:     log.value,
            analog:    null,
            timestamp: log.detected_at
        }));
    } catch (e) { console.warn('[Logs] Could not load history:', e.message); }
}

// ══════════════════════════════════════════════════
//  KEYBOARD SUPPORT (Active only when modal is open)
// ══════════════════════════════════════════════════
const keyMap = {
    ArrowUp:    'forward',   w: 'forward',   W: 'forward',
    ArrowDown:  'backward',  s: 'backward',  S: 'backward',
    ArrowLeft:  'left',      a: 'left',      A: 'left',
    ArrowRight: 'right',     d: 'right',     D: 'right',
    ' ':        'stop',
    'b':        'brake',     B: 'brake',
};

const heldKeys = new Set();

document.addEventListener('keydown', (e) => {
    // 1. Ignore if typing in an input or textarea
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // 2. Only process movement if the motor modal is visibly open
    if (!motorModal || motorModal.classList.contains('hidden')) return;

    if (keyMap[e.key]) {
        // 3. CRITICAL: Prevent browser scroll (ArrowUp, ArrowDown, Space)
        e.preventDefault();
        
        if (!heldKeys.has(e.key)) {
            heldKeys.add(e.key);
            const dir = keyMap[e.key];
            
            if (dir === 'brake') emergencyBrake();
            else if (dir === 'stop') sendStop();
            else startMove(dir);
        }
    }

    // Speed Control (+ / -)
    const SPEED_STEP = 5;
    if (e.key === '+' || e.key === '=') {
        const newVal = Math.min(100, parseInt(speedSlider.value) + SPEED_STEP);
        speedSlider.value = newVal;
        if (speedVal) speedVal.textContent = newVal;
        spdDisplay.textContent = `${newVal}%`;
        sendSpeed(newVal);
        e.preventDefault();
    } else if (e.key === '-' || e.key === '_') {
        const newVal = Math.max(20, parseInt(speedSlider.value) - SPEED_STEP);
        speedSlider.value = newVal;
        if (speedVal) speedVal.textContent = newVal;
        spdDisplay.textContent = `${newVal}%`;
        sendSpeed(newVal);
        e.preventDefault();
    }
});

document.addEventListener('keyup', (e) => {
    if (!motorModal || motorModal.classList.contains('hidden')) {
        heldKeys.clear();
        return;
    }

    if (keyMap[e.key] && keyMap[e.key] !== 'stop' && keyMap[e.key] !== 'brake') {
        heldKeys.delete(e.key);
        stopMove();
    }
});

// ══════════════════════════════════════════════════
//  INTERCOM CONTROLS
// ══════════════════════════════════════════════════
function setupIntercomControls() {
    if (!btnIntercom) return;
    btnIntercom.addEventListener('click', () => {
        isIntercomActive = !isIntercomActive;
        btnIntercom.classList.toggle('active', isIntercomActive);
        
        console.log('[Intercom] Toggled:', isIntercomActive ? 'ON' : 'OFF');
        
        // Restart WebRTC to adjust tracks
        if (pc) {
            pc.close();
        }
        startWebRTC();
    });
}

// ── Start ──
init();
