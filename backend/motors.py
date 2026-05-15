import RPi.GPIO as GPIO
import threading
import time

# ─────────────────────────────────────────────
# L298N Motor Driver — Raspberry Pi GPIO
# 
# LEFT MOTORS (Motor A):
#   ENA → GPIO 12 (Hardware PWM — speed)
#   IN1 → GPIO 17 (Forward)
#   IN2 → GPIO 27 (Backward)
#
# RIGHT MOTORS (Motor B):
#   ENB → GPIO 13 (Hardware PWM — speed)
#   IN3 → GPIO 22 (Forward)
#   IN4 → GPIO 23 (Backward)
#
# Power:  Motors → LiPo 2200mAH battery
#         Pi/ESP → USB
# ─────────────────────────────────────────────

ENA = 12
ENB = 13
IN1 = 27  # Swapped to reverse polarity
IN2 = 17
IN3 = 23  # Swapped to reverse polarity
IN4 = 22

PWM_FREQ = 1000  # Hz

class MotorController:
    """
    Controls 4-wheel differential drive robot via L298N motor driver.
    Strictly separated from routing logic (coding-rules.md Section 2.1).
    """

    def __init__(self):
        self._setup_gpio()
        self.current_speed  = 75    # Default speed (0–100%)
        self.current_dir    = "stop"
        self.obstacle_locked = False
        self._lock          = threading.Lock()

    def _setup_gpio(self):
        GPIO.setmode(GPIO.BCM)
        GPIO.setwarnings(False)

        GPIO.setup(ENA, GPIO.OUT)
        GPIO.setup(ENB, GPIO.OUT)
        GPIO.setup(IN1, GPIO.OUT)
        GPIO.setup(IN2, GPIO.OUT)
        GPIO.setup(IN3, GPIO.OUT)
        GPIO.setup(IN4, GPIO.OUT)

        # PWM for speed control
        self._pwm_a = GPIO.PWM(ENA, PWM_FREQ)
        self._pwm_b = GPIO.PWM(ENB, PWM_FREQ)
        self._pwm_a.start(0)
        self._pwm_b.start(0)

    def _set_left(self, fwd: bool, bwd: bool, speed: float):
        GPIO.output(IN1, GPIO.HIGH if fwd else GPIO.LOW)
        GPIO.output(IN2, GPIO.HIGH if bwd else GPIO.LOW)
        self._pwm_a.ChangeDutyCycle(speed)

    def _set_right(self, fwd: bool, bwd: bool, speed: float):
        GPIO.output(IN3, GPIO.HIGH if fwd else GPIO.LOW)
        GPIO.output(IN4, GPIO.HIGH if bwd else GPIO.LOW)
        self._pwm_b.ChangeDutyCycle(speed)

    # ── Public Movement Commands ──

    def forward(self, speed=None):
        if self.obstacle_locked:
            print("[Motor] FORWARD BLOCKED by obstacle")
            return
        spd = speed if speed is not None else self.current_speed
        with self._lock:
            self._set_left(fwd=True,  bwd=False, speed=spd)
            self._set_right(fwd=True, bwd=False, speed=spd)
            self.current_dir = "forward"
        print(f"[Motor] FORWARD @ {spd}%")

    def backward(self, speed=None):
        spd = speed if speed is not None else self.current_speed
        with self._lock:
            self._set_left(fwd=False,  bwd=True, speed=spd)
            self._set_right(fwd=False, bwd=True, speed=spd)
            self.current_dir = "backward"
        print(f"[Motor] BACKWARD @ {spd}%")

    def turn_left(self, speed=None):
        if self.obstacle_locked:
            print("[Motor] LEFT BLOCKED by obstacle")
            return
        spd = speed if speed is not None else self.current_speed
        with self._lock:
            self._set_left(fwd=False,  bwd=True, speed=spd)   # Left wheels backward
            self._set_right(fwd=True,  bwd=False, speed=spd)  # Right wheels forward
            self.current_dir = "left"
        print(f"[Motor] LEFT @ {spd}%")

    def turn_right(self, speed=None):
        if self.obstacle_locked:
            print("[Motor] RIGHT BLOCKED by obstacle")
            return
        spd = speed if speed is not None else self.current_speed
        with self._lock:
            self._set_left(fwd=True,   bwd=False, speed=spd)  # Left wheels forward
            self._set_right(fwd=False, bwd=True,  speed=spd)  # Right wheels backward
            self.current_dir = "right"
        print(f"[Motor] RIGHT @ {spd}%")

    def stop(self):
        with self._lock:
            self._set_left(fwd=False,  bwd=False, speed=0)
            self._set_right(fwd=False, bwd=False, speed=0)
            self.current_dir = "stop"
        print("[Motor] STOP")

    def emergency_brake(self):
        """Immediately cuts all motor power."""
        with self._lock:
            self._pwm_a.ChangeDutyCycle(0)
            self._pwm_b.ChangeDutyCycle(0)
            GPIO.output(IN1, GPIO.LOW)
            GPIO.output(IN2, GPIO.LOW)
            GPIO.output(IN3, GPIO.LOW)
            GPIO.output(IN4, GPIO.LOW)
            self.current_dir = "stop"
        print("[Motor] EMERGENCY BRAKE")

    def set_speed(self, speed: int):
        """Sets default speed (0–100)."""
        self.current_speed = max(0, min(100, speed))
        print(f"[Motor] Speed set to {self.current_speed}%")

    def get_status(self):
        return {
            "direction": self.current_dir,
            "speed":     self.current_speed,
            "obstacle_locked": self.obstacle_locked
        }

    def clear_obstacle_lock(self):
        """Manually clears the obstacle brake to allow movement again."""
        self.obstacle_locked = False
        print("[Motor] Obstacle lock cleared.")

    def cleanup(self):
        self.stop()
        self._pwm_a.stop()
        self._pwm_b.stop()
        GPIO.cleanup()
        print("[Motor] GPIO cleaned up.")


# Singleton instance
motor_controller = MotorController()
