import serial
import threading
import json
import time
from datetime import datetime

# --- UART Configuration ---
# Pi GPIO 14 (TX) → ESP32 GPIO 16 (RX)
# Pi GPIO 15 (RX) → ESP32 GPIO 17 (TX)
SERIAL_PORT = "/dev/serial0"   # Hardware UART alias on Raspberry Pi
BAUD_RATE = 115200

# --- Alert Thresholds ---
GAS_ANALOG_THRESHOLD = 2000   # 12-bit ADC value (0–4095)
DEBOUNCE_THRESHOLD   = 3      # Number of consecutive readings to confirm alert

class HazardMonitor:
    """
    Hardware Abstraction Layer — reads sensor data from ESP32 via UART.
    The ESP32 handles all GPIO and ADC. This module only processes UART JSON.

    UART Protocol (newline-delimited JSON):
      ESP32 → Pi: {"type":"sensor","gas_a":1024,"gas_d":1,"flame_d":1}
      Pi → ESP32: {"cmd":"servo","angle":90}
    """

    def __init__(self, alert_callback=None):
        self.alert_callback = alert_callback
        self.monitoring = False
        self._thread = None

        # Current state
        self._gas_analog  = 0
        self._gas_digital = 1    # 1 = safe (active low)
        self._flame_digital = 1  # 1 = safe (active low)
        self._battery_percent = 100

        # Previous state (for change detection)
        self._prev_gas_alert   = False
        self._prev_flame_alert = False
        
        # Debounce buffers (counters for consecutive hits)
        self._gas_hit_count    = 0
        self._flame_hit_count  = 0

        # Serial port
        try:
            self._serial = serial.Serial(
                SERIAL_PORT,
                BAUD_RATE,
                timeout=1
            )
            print(f"[HazardMonitor] Serial opened: {SERIAL_PORT} @ {BAUD_RATE}")
        except Exception as e:
            print(f"[HazardMonitor] WARNING: Could not open serial port {SERIAL_PORT}: {e}")
            self._serial = None

    def _monitor_loop(self):
        """Background thread: reads UART lines from ESP32."""
        while self.monitoring:
            if not self._serial:
                time.sleep(1)
                continue
            try:
                if self._serial.in_waiting:
                    raw = self._serial.readline().decode("utf-8", errors="ignore").strip()
                    if raw:
                        self._process_line(raw)
            except Exception as e:
                print(f"[HazardMonitor] Serial read error: {e}")
                time.sleep(0.5)

    def _process_line(self, raw):
        """Parses one JSON line and fires callbacks on state changes."""
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return

        if data.get("type") != "sensor":
            return

        self._gas_analog   = data.get("gas_a", 0)
        self._gas_digital  = data.get("gas_d", 1)
        self._flame_digital = data.get("flame_d", 1)
        
        # Capture battery level (assumed 0-100 percentage)
        if "batt" in data:
            self._battery_percent = int(data["batt"])

        timestamp = datetime.now().isoformat()

        # --- Gas Alert Debouncing ---
        # Note: We ignore self._gas_digital because the hardware potentiometer is often miscalibrated.
        raw_gas_hit = (self._gas_analog > GAS_ANALOG_THRESHOLD)
        
        if raw_gas_hit:
            self._gas_hit_count = min(DEBOUNCE_THRESHOLD, self._gas_hit_count + 1)
        else:
            self._gas_hit_count = max(0, self._gas_hit_count - 1)

        # Confirm alert only if threshold met
        current_gas_alert = (self._gas_hit_count >= DEBOUNCE_THRESHOLD)
        # Clear alert only if count drops to 0
        if self._gas_hit_count == 0: current_gas_alert = False
        # If we were already in alert, stay in alert until count is 0
        if self._prev_gas_alert and self._gas_hit_count > 0: current_gas_alert = True

        if current_gas_alert != self._prev_gas_alert:
            self._prev_gas_alert = current_gas_alert
            if self.alert_callback:
                self.alert_callback({
                    "type": "hazard",
                    "sensor": "gas",
                    "value": 1 if current_gas_alert else 0,
                    "analog": self._gas_analog,
                    "timestamp": timestamp
                })

        # --- Flame Alert Debouncing ---
        raw_flame_hit = (self._flame_digital == 0)
        
        if raw_flame_hit:
            self._flame_hit_count = min(DEBOUNCE_THRESHOLD, self._flame_hit_count + 1)
        else:
            self._flame_hit_count = max(0, self._flame_hit_count - 1)

        current_flame_alert = (self._flame_hit_count >= DEBOUNCE_THRESHOLD)
        if self._flame_hit_count == 0: current_flame_alert = False
        if self._prev_flame_alert and self._flame_hit_count > 0: current_flame_alert = True

        if current_flame_alert != self._prev_flame_alert:
            self._prev_flame_alert = current_flame_alert
            if self.alert_callback:
                self.alert_callback({
                    "type": "hazard",
                    "sensor": "fire",
                    "value": 1 if current_flame_alert else 0,
                    "timestamp": timestamp
                })

    def get_current_status(self):
        """Returns current debounced sensor states."""
        return {
            "gas":        1 if self._prev_gas_alert else 0,
            "gas_analog": self._gas_analog,
            "fire":       1 if self._prev_flame_alert else 0,
            "battery":    self._battery_percent,
            "timestamp":  datetime.now().isoformat()
        }

    def send_servo_command(self, angle: int):
        """Sends a pan servo angle command to the ESP32."""
        angle = max(0, min(180, angle))
        
        # Invert the angle because the servo is mounted upside down or reversed
        physical_angle = 180 - angle
        
        if self._serial and self._serial.is_open:
            cmd = json.dumps({"cmd": "servo", "angle": physical_angle}) + "\n"
            try:
                self._serial.write(cmd.encode("utf-8"))
                print(f"[HazardMonitor] Pan servo command sent: {physical_angle}° (UI: {angle}°)")
                return True
            except Exception as e:
                print(f"[HazardMonitor] Pan servo send error: {e}")
                return False
        return False

    def send_tilt_command(self, angle: int):
        """Sends a tilt servo angle command to the ESP32."""
        angle = max(30, min(150, angle))  # Constrained range to avoid mechanical strain
        
        # Invert the angle because the servo is mounted upside down
        physical_angle = 180 - angle
        
        if self._serial and self._serial.is_open:
            cmd = json.dumps({"cmd": "tilt", "angle": physical_angle}) + "\n"
            try:
                self._serial.write(cmd.encode("utf-8"))
                print(f"[HazardMonitor] Tilt servo command sent: {physical_angle}° (UI: {angle}°)")
                return True
            except Exception as e:
                print(f"[HazardMonitor] Tilt servo send error: {e}")
                return False
        return False

    def start_monitoring(self):
        """Starts the background UART reading thread."""
        self.monitoring = True
        self._thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self._thread.start()
        print("[HazardMonitor] Monitoring started via UART.")

    def cleanup(self):
        """Stops monitoring and closes serial port."""
        self.monitoring = False
        if self._serial and self._serial.is_open:
            self._serial.close()
        print("[HazardMonitor] Cleaned up.")


if __name__ == "__main__":
    def test_cb(data):
        print(f"[ALERT] {data}")

    monitor = HazardMonitor(alert_callback=test_cb)
    monitor.start_monitoring()

    try:
        while True:
            print(f"Status: {monitor.get_current_status()}")
            time.sleep(2)
    except KeyboardInterrupt:
        monitor.cleanup()
