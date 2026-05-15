import asyncio
import datetime
import logging
import math
import numpy as np
import cv2
import time
import threading
from aiortc import RTCPeerConnection, RTCSessionDescription, VideoStreamTrack, AudioStreamTrack
from av import VideoFrame, AudioFrame
from backend.recording import recorder_instance

# Audio dependencies (Defensive)
HAS_PYAUDIO = False
pyaudio_instance = None
try:
    import pyaudio
    pyaudio_instance = pyaudio.PyAudio()
    HAS_PYAUDIO = True
except Exception:
    pass

logger = logging.getLogger("pc")
pc_instances = set()

# ── Vision Enhancement Globals ──
night_vision_enabled = False # Removed per user request
zoom_level = 1.0   
motion_detection_enabled = False
motion_sensitivity        = 25
_prev_frame               = None
_last_motion_time         = 0.0
MOTION_COOLDOWN_SEC       = 5.0
_servo_moved_at           = 0.0

class GlobalCamera:
    """SINGLETON CAMERA PROVIDER"""
    def __init__(self):
        self.picam2 = None
        self.latest_frame = None
        self.running = False
        self.thread = None
        self.lock = threading.Lock()
        self.has_hardware = False
        self.error_count = 0
        self.sio = None
        self.loop = None 
        time.sleep(1)
        self._init_hardware()

    def _init_hardware(self):
        for attempt in range(3):
            try:
                from picamera2 import Picamera2
                self.picam2 = Picamera2()
                config = self.picam2.create_video_configuration(
                    main={"size": (1280, 720), "format": "RGB888"},
                    controls={"AwbMode": 0, "AeEnable": True, "AwbEnable": True}
                )
                self.picam2.configure(config)
                self.picam2.start()
                self.has_hardware = True
                return True
            except Exception: time.sleep(2)
        self.has_hardware = False
        return False

    def _capture_loop(self):
        global _prev_frame, _last_motion_time
        while self.running:
            if not self.has_hardware:
                time.sleep(2)
                continue
            try:
                raw_frame = self.picam2.capture_array("main")
                if raw_frame is not None:
                    # The camera format still returns BGR, we must convert to RGB for WebRTC
                    frame = cv2.cvtColor(np.flip(raw_frame, axis=(0, 1)), cv2.COLOR_BGR2RGB)
                    if zoom_level > 1.0:
                        h, w = frame.shape[:2]
                        crop_h, crop_w = int(h / zoom_level), int(w / zoom_level)
                        y0, x0 = (h - crop_h) // 2, (w - crop_w) // 2
                        frame = cv2.resize(frame[y0:y0+crop_h, x0:x0+crop_w], (w, h))



                    if motion_detection_enabled:
                        now = time.time()
                        motion_triggered = False
                        if (now - _servo_moved_at) > 1.5:
                            small = cv2.resize(frame, (320, 180), interpolation=cv2.INTER_NEAREST)
                            gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
                            gray = cv2.GaussianBlur(gray, (21, 21), 0)
                            if _prev_frame is not None and _prev_frame.shape == gray.shape:
                                diff = cv2.absdiff(_prev_frame, gray)
                                _, thresh = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
                                pct = (cv2.countNonZero(thresh) / (320*180)) * 100
                                if pct > (max(0.5, 100 - motion_sensitivity) * 0.15):
                                    motion_triggered = True
                                    if (now - _last_motion_time) > MOTION_COOLDOWN_SEC:
                                        _last_motion_time = now
                                        if self.sio and self.loop:
                                            asyncio.run_coroutine_threadsafe(
                                                self.sio.emit("motion_detected", {"pct": round(pct, 2), "timestamp": datetime.datetime.now().isoformat()}), self.loop
                                            )
                            _prev_frame = gray
                        else: _prev_frame = None
                        if motion_triggered:
                            h, w = frame.shape[:2]
                            cv2.rectangle(frame, (0, 0), (w-1, h-1), (255, 0, 0), 2)

                    if recorder_instance.is_recording: recorder_instance.write_frame(frame)
                    with self.lock: self.latest_frame = frame
            except Exception: pass
            time.sleep(1/22)

    def start(self, sio=None, loop=None):
        self.sio = sio
        self.loop = loop
        if not self.running:
            self.running = True
            self.thread = threading.Thread(target=self._capture_loop, daemon=True); self.thread.start()

    def get_frame(self):
        with self.lock: return self.latest_frame.copy() if self.latest_frame is not None else None

camera_engine = GlobalCamera()

class PiCamera2Track(VideoStreamTrack):
    kind = "video"
    async def recv(self):
        pts, time_base = await self.next_timestamp()
        frame_data = camera_engine.get_frame()
        if frame_data is None:
            frame_data = np.zeros((720, 1280, 3), dtype=np.uint8)
            cv2.putText(frame_data, "INITIALIZING...", (400, 360), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 255), 3)
        frame = VideoFrame.from_ndarray(frame_data, format="rgb24")
        frame.pts = pts; frame.time_base = time_base
        return frame

# ── 2-Way Audio Implementation ──

class MicrophoneTrack(AudioStreamTrack):
    """Captures sound from Pi's USB Microphone using arecord subprocess."""
    kind = "audio"

    def __init__(self):
        super().__init__()
        self.rate = 48000
        self.channels = 1
        self.frames_per_buffer = 960
        self._timestamp = 0
        self.process = None

        # Auto-detect the USB Microphone Card ID
        card_id = "default"
        try:
            import subprocess
            # Look for the card number associated with 'USB'
            cmd = "arecord -l | grep -i 'usb' | head -n 1 | cut -d' ' -f2 | tr -d ':'"
            result = subprocess.check_output(cmd, shell=True).decode().strip()
            if result:
                card_id = f"hw:{result},0"
                print(f"[Mic] Auto-detected USB Microphone on {card_id}")
            else:
                print("[Mic] WARNING: No USB Microphone detected, using default.")
        except Exception as e:
            print(f"[Mic] Auto-detect error: {e}")

        try:
            # Spawn arecord to read raw 16-bit 48kHz mono audio
            self.process = subprocess.Popen(
                ['arecord', '-D', card_id, '-f', 'S16_LE', '-r', str(self.rate), '-c', str(self.channels), '-t', 'raw'],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL
            )
            print(f"[Mic] arecord subprocess started using {card_id}")
        except Exception as e:
            print(f"[Mic] arecord failed to start: {e}")

    async def recv(self):
        # Calculate how many bytes we need: 960 samples * 2 bytes (S16)
        num_bytes = self.frames_per_buffer * 2
        
        if self.process and self.process.stdout:
            try:
                # Read raw PCM data from the arecord pipe
                data = await asyncio.to_thread(self.process.stdout.read, num_bytes)
                if len(data) < num_bytes:
                    # If we got a short read, pad with silence
                    data += b'\x00' * (num_bytes - len(data))
                
                samples = np.frombuffer(data, dtype=np.int16)
                # Reshape for aiortc (1, frames)
                reshaped = samples.reshape(1, -1)
                
                frame = AudioFrame.from_ndarray(reshaped, format='s16', layout='mono')
                frame.sample_rate = self.rate
                frame.pts = self._timestamp
                self._timestamp += self.frames_per_buffer
                import fractions
                frame.time_base = fractions.Fraction(1, self.rate)
                return frame
            except Exception as e:
                print(f"[Mic] Read error: {e}")
        
        # Fallback to silence if mic fails
        await asyncio.sleep(0.02)
        silence = np.zeros((1, self.frames_per_buffer), dtype=np.int16)
        frame = AudioFrame.from_ndarray(silence, format='s16', layout='mono')
        frame.sample_rate = self.rate
        return frame

    def stop(self):
        if self.process:
            try:
                self.process.terminate()
                self.process.wait(timeout=0.5)
            except: pass
        super().stop()

async def player_audio_track(track):
    """Plays Dashboard voice audio to Pi's speakers using aplay to prevent ALSA segfaults."""
    import subprocess
    process = None
    try:
        # Spawn an aplay subprocess expecting raw 16-bit 48kHz mono PCM on stdin
        process = subprocess.Popen(
            ['aplay', '-f', 'S16_LE', '-r', '48000', '-c', '1', '-t', 'raw'],
            stdin=subprocess.PIPE,
            stderr=subprocess.DEVNULL
        )
        while True:
            frame = await track.recv()
            data = frame.to_ndarray().tobytes()
            if process.poll() is None:
                # Write audio data to aplay's standard input
                process.stdin.write(data)
                process.stdin.flush()
            else:
                print("[Intercom] aplay subprocess died unexpectedly.")
                break
    except Exception as e:
        print(f"[Intercom] Playback error: {e}")
    finally:
        if process:
            try:
                process.stdin.close()
                process.terminate()
            except: pass

async def create_pc(offer, sio=None):
    print(f"[WebRTC] Creating new PC instance...")

    pc = RTCPeerConnection()
    pc_instances.add(pc)
    
    # Video track — ALWAYS added
    pc.addTrack(PiCamera2Track())
    
    # Audio track — only add if the browser's offer includes audio
    offer_sdp = offer.get("sdp", "")
    if "m=audio" in offer_sdp and HAS_PYAUDIO:
        pc.addTrack(MicrophoneTrack())
        print("[WebRTC] Audio track added (offer contains audio).")
    else:
        print("[WebRTC] Skipping audio track (no audio in offer or no PyAudio).")

    @pc.on("track")
    def on_track(track):
        if track.kind == "audio":
            asyncio.create_task(player_audio_track(track))

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        if pc.connectionState in ["failed", "closed"]:
            pc_instances.discard(pc)

    await pc.setRemoteDescription(RTCSessionDescription(sdp=offer["sdp"], type=offer["type"]))
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    return {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type}
