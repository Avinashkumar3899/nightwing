import os
import asyncio
from datetime import datetime
import cv2
from concurrent.futures import ThreadPoolExecutor
from backend.database import log_recording

# Directory for recordings
RECORDINGS_DIR = "recordings"
if not os.path.exists(RECORDINGS_DIR):
    os.makedirs(RECORDINGS_DIR)

class Recorder:
    """Manages server-side video recording using OpenCV VideoWriter in a background thread."""
    def __init__(self):
        self.is_recording = False
        self.current_filename = None
        self.start_time = None
        self.video_writer = None
        # Thread pool to ensure disk I/O does not block WebRTC loop
        self.executor = ThreadPoolExecutor(max_workers=1)
        self._frame_skip = 0  # Write every other frame to reduce I/O load

    async def start(self, hazard_detected=False):
        """Starts a recording session."""
        if self.is_recording:
            return False, "Already recording"
        
        self.start_time = datetime.now()
        timestamp = self.start_time.strftime("%Y%m%d_%H%M%S")
        self.current_filename = f"recording_{timestamp}.mp4"
        file_path = os.path.join(RECORDINGS_DIR, self.current_filename)
        
        try:
            # Try XVID first (widely available), fallback to mp4v
            fourcc = cv2.VideoWriter_fourcc(*'XVID')
            self.video_writer = cv2.VideoWriter(file_path.replace('.mp4', '.avi'), fourcc, 10.0, (1280, 720))
            
            if not self.video_writer.isOpened():
                # Fallback to mp4v
                fourcc = cv2.VideoWriter_fourcc(*'mp4v')
                self.video_writer = cv2.VideoWriter(file_path, fourcc, 10.0, (1280, 720))
            
            if not self.video_writer.isOpened():
                print("[Recorder] ERROR: VideoWriter failed to open. Codec not available.")
                self.video_writer = None
                return False, "Recording codec not available on this system"
            
            self.current_filename = os.path.basename(self.video_writer.getBackendName() if hasattr(self.video_writer, 'getBackendName') else file_path)
            print(f"[Recorder] File created: {file_path}")
            
            # Log to DB (non-blocking, don't crash if DB fails)
            try:
                await log_recording(self.current_filename, hazard_detected)
            except Exception as e:
                print(f"[Recorder] DB log warning: {e}")
            
            self._frame_skip = 0
            self.is_recording = True
            return True, self.current_filename
            
        except Exception as e:
            print(f"[Recorder] ERROR starting: {e}")
            self.video_writer = None
            return False, str(e)

    async def stop(self):
        """Stops the current recording session."""
        if not self.is_recording:
            return False, "Not recording"
        
        self.is_recording = False  # Stop accepting frames FIRST
        
        if self.video_writer:
            try:
                self.video_writer.release()
            except Exception as e:
                print(f"[Recorder] Warning on release: {e}")
            self.video_writer = None
            
        print(f"[Recorder] Saved: {self.current_filename}")
        
        result = self.current_filename
        self.current_filename = None
        return True, result

    def _write_frame_sync(self, frame_data):
        try:
            if self.video_writer and self.is_recording:
                # Frame is already 720p from the capture loop
                bgr_frame = cv2.cvtColor(frame_data, cv2.COLOR_RGB2BGR)
                self.video_writer.write(bgr_frame)
        except Exception as e:
            print(f"[Recorder] Frame write error: {e}")

    def write_frame(self, frame_data):
        if self.is_recording and self.video_writer:
            # Skip every other frame (record at ~11fps instead of 22)
            # This halves the CPU and disk I/O load
            self._frame_skip += 1
            if self._frame_skip % 2 == 0:
                self.executor.submit(self._write_frame_sync, frame_data.copy())

recorder_instance = Recorder()
