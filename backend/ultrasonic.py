import time
import asyncio

try:
    import RPi.GPIO as GPIO
    IS_RPI = True
except ImportError:
    IS_RPI = False

class UltrasonicRadar:
    def __init__(self, trig_pin=5, echo_pin=6):
        self.trig_pin = trig_pin
        self.echo_pin = echo_pin
        self.is_running = False
        self.current_distance = -1.0
        
        if IS_RPI:
            GPIO.setmode(GPIO.BCM)
            # Suppress warnings if already configured
            GPIO.setwarnings(False)
            GPIO.setup(self.trig_pin, GPIO.OUT)
            GPIO.setup(self.echo_pin, GPIO.IN)
            # Ensure trigger is low to start
            GPIO.output(self.trig_pin, False)
            time.sleep(0.5)

    def measure_distance_sync(self):
        """Bloacking measure distance function. Retries internal cleanly."""
        if not IS_RPI:
            # Mock data for dev testing
            import random
            return round(random.uniform(5.0, 100.0), 1)

        # Send 10us pulse
        GPIO.output(self.trig_pin, True)
        time.sleep(0.00001)
        GPIO.output(self.trig_pin, False)

        pulse_start = time.time()
        pulse_end = time.time()
        timeout = pulse_start + 0.05  # 50ms timeout (approx 8 meters)

        # Wait for echo to go high
        while GPIO.input(self.echo_pin) == 0:
            pulse_start = time.time()
            if pulse_start > timeout:
                return -1.0 # Timeout out of range

        # Wait for echo to go low
        while GPIO.input(self.echo_pin) == 1:
            pulse_end = time.time()
            if pulse_end > timeout:
                return -1.0

        pulse_duration = pulse_end - pulse_start
        # Speed of sound is 343m/s or 34300cm/s. Distance = (time * speed) / 2
        distance = pulse_duration * 17150
        return round(distance, 1)

    async def radar_loop(self, sio_instance):
        """Asynchronous loop that pings the sensor and emits Socket.IO events."""
        self.is_running = True
        print(f"[Radar] Ultrasonic active on TRIG:{self.trig_pin} ECHO:{self.echo_pin}")
        while self.is_running:
            # Offload blocking GPIO reads to a thread
            dist = await asyncio.to_thread(self.measure_distance_sync)
            
            if dist > 0:
                self.current_distance = dist
                if sio_instance:
                    await sio_instance.emit("radar_data", {"distance_cm": dist})
                
                # AUTOMATIC BRAKE: Stop if obstacle is too close (< 20cm)
                if dist < 20:
                    from backend.motors import motor_controller
                    if motor_controller.current_dir in ["forward", "left", "right"]:
                        motor_controller.stop()
                        motor_controller.obstacle_locked = True
                        print(f"[Radar] AUTOMATIC STOP: Obstacle detected at {dist}cm")

            await asyncio.sleep(0.2) # Update 5 times a second

    def stop(self):
        self.is_running = False
        if IS_RPI:
            # Note: We purposely do not GPIO.cleanup() here because it might
            # interfere with the Motor Driver which also uses RPi.GPIO
            pass

radar_sensor = UltrasonicRadar()
