import os
import shutil
import asyncio
from datetime import datetime
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import socketio
from backend.sensors import HazardMonitor
from backend.database import (
    init_db, log_hazard, get_recent_logs, 
    log_environmental_snapshot, get_all_environmental_logs, clear_mission_data
)
from backend.webrtc import create_pc, pc_instances
from backend.recording import recorder_instance
from backend.motors import motor_controller
from backend.ultrasonic import radar_sensor
from pydantic import BaseModel
import csv
import io
from fastapi.responses import StreamingResponse

class Offer(BaseModel):
    sdp: str
    type: str

class ServoCommand(BaseModel):
    angle: int  # 0–180 (pan)

class TiltCommand(BaseModel):
    angle: int  # 30–150 (tilt)

class MotorCommand(BaseModel):
    direction: str   # forward | backward | left | right | stop
    speed: int = 75  # 0–100

# Initialize FastAPI
app = FastAPI(title="Nightwing Surveillance Robot API")

# Serve frontend static files
app.mount("/static", StaticFiles(directory="frontend"), name="static")

@app.get("/controller")
async def get_controller():
    from fastapi.responses import FileResponse
    return FileResponse("frontend/controller.html")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Socket.IO
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins="*")
sio_app = socketio.ASGIApp(sio, app)

# Global instances
hazard_monitor: HazardMonitor = None
main_loop = None

# Mission Memory State
is_recording_mission = False
is_patrolling = False
current_mission = [] # List of {"offset": float, "type": str, "cmd": str, "value": int}
recording_start_time = 0

# ─────────────────────────────────────────────
# Startup / Shutdown
# ─────────────────────────────────────────────
@app.on_event("startup")
async def startup_event():
    global hazard_monitor, main_loop
    main_loop = asyncio.get_running_loop()
    await init_db()

    # Start camera hardware via the global engine
    from backend.webrtc import camera_engine
    camera_engine.start(sio=sio, loop=main_loop)

    hazard_monitor = HazardMonitor(
        alert_callback=lambda data: asyncio.run_coroutine_threadsafe(handle_hazard(data), main_loop)
    )
    hazard_monitor.start_monitoring()
    asyncio.create_task(background_status_polling())
    asyncio.create_task(mission_logger_loop())
    asyncio.create_task(storage_monitor_loop())
    asyncio.create_task(radar_sensor.radar_loop(sio))
    print("[Nightwing] Backend started.")

@app.on_event("shutdown")
async def shutdown_event():
    # Stop camera hardware first to avoid busy locks
    from backend.webrtc import camera_engine
    camera_engine.stop()

    if hazard_monitor:
        hazard_monitor.cleanup()
    radar_sensor.stop()
    # Emergency stop motors and clean up GPIO
    try:
        motor_controller.emergency_brake()
        motor_controller.cleanup()
    except Exception:
        pass
    print("[Nightwing] Shutdown complete.")

# ─────────────────────────────────────────────
# Background Tasks
# ─────────────────────────────────────────────
async def background_status_polling():
    """Broadcasts sensor status to all clients every 500ms."""
    while True:
        if hazard_monitor:
            status = hazard_monitor.get_current_status()
            await sio.emit("hazard_status", status)
        await asyncio.sleep(0.5)

async def handle_hazard(data):
    """Stores to DB and emits alert on change."""
    await log_hazard(data["sensor"], data["value"])
    await sio.emit("hazard_alert", data)
    print(f"[ALERT] {data}")

async def mission_logger_loop():
    """Periodically logs environmental and radar data every 10 seconds."""
    while True:
        if hazard_monitor:
            status = hazard_monitor.get_current_status()
            
            # The monitor now tracks radar data
            await log_environmental_snapshot(
                gas_a=status["gas_analog"],
                gas_d=0 if status["gas"] else 1,
                fire_d=0 if status["fire"] else 1,
                r_dist=status.get("distance_cm", 0),
                r_alert=1 if status.get("distance_cm", 999) <= 20 else 0
            )
        await asyncio.sleep(10)

async def storage_monitor_loop():
    """Monitors SD card space and broadcasts to dashboard every 5 minutes."""
    while True:
        try:
            total, used, free = shutil.disk_usage("/")
            percent_used = round((used / total) * 100, 1)
            used_gb = round(used / (1024**3), 1)
            total_gb = round(total / (1024**3), 1)
            
            data = {
                "percent": percent_used,
                "used_gb": used_gb,
                "total_gb": total_gb,
                "free_gb": round(free / (1024**3), 1)
            }
            await sio.emit("storage_status", data)
        except Exception as e:
            print(f"[Storage] Monitor error: {e}")
        
        await asyncio.sleep(300) # 5 minutes

# ─────────────────────────────────────────────
# Mission Memory Engine (The Memory)
# ─────────────────────────────────────────────

async def run_patrol(repeats: int):
    """Executes the recorded mission sequence synchronously."""
    global is_patrolling
    is_patrolling = True
    await sio.emit("patrol_status", {"status": "started", "round": 0, "total": repeats})
    
    try:
        for r in range(repeats):
            if not is_patrolling: break
            await sio.emit("patrol_status", {"status": "running", "round": r + 1, "total": repeats})
            
            # Reset hardware to start state if needed
            if hazard_monitor: hazard_monitor.send_servo_command(90)
            motor_controller.stop()
            
            last_offset = 0
            for event in current_mission:
                if not is_patrolling: break
                
                # Wait for the next event timing
                delay = event["offset"] - last_offset
                if delay > 0:
                    await asyncio.sleep(delay)
                last_offset = event["offset"]
                
                # Execute event
                etype = event["type"]
                cmd   = event["cmd"]
                val   = event["value"]
                
                if etype == "motor":
                    motor_controller.set_speed(val)
                    actions = {
                        "forward":  motor_controller.forward,
                        "backward": motor_controller.backward,
                        "left":     motor_controller.turn_left,
                        "right":    motor_controller.turn_right,
                        "stop":     motor_controller.stop,
                    }
                    if cmd in actions: actions[cmd]()
                
                elif etype == "servo" and hazard_monitor:
                    hazard_monitor.send_servo_command(val)

                elif etype == "tilt" and hazard_monitor:
                    hazard_monitor.send_tilt_command(val)
            
            # Brief pause between rounds
            motor_controller.stop()
            await asyncio.sleep(1)
            
    finally:
        is_patrolling = False
        motor_controller.stop()
        if hazard_monitor: hazard_monitor.send_servo_command(90)
        await sio.emit("patrol_status", {"status": "finished"})
        print("[Mission] Unified Patrol complete.")

def record_event(etype: str, cmd: str, value: int):
    """Records an event with its high-res time offset."""
    global current_mission, recording_start_time
    if not is_recording_mission: return
    
    offset = asyncio.get_event_loop().time() - recording_start_time
    current_mission.append({
        "offset": offset,
        "type": etype,
        "cmd": cmd,
        "value": value
    })

@app.post("/api/mission/record/start")
async def start_recording_mission():
    global is_recording_mission, current_mission, recording_start_time
    is_recording_mission = True
    current_mission = []
    recording_start_time = asyncio.get_event_loop().time()
    # Initial states
    record_event("motor", "stop", 0)
    if hazard_monitor:
        record_event("servo", "move", 90)
    return {"status": "recording"}

@app.post("/api/mission/record/stop")
async def stop_recording_mission():
    global is_recording_mission
    record_event("motor", "stop", 0)
    is_recording_mission = False
    return {"status": "stopped", "events": len(current_mission)}

@app.post("/api/mission/patrol/start")
async def start_patrol(repeats: int = 1):
    if not current_mission:
        raise HTTPException(status_code=400, detail="No recorded mission found")
    asyncio.create_task(run_patrol(repeats))
    return {"status": "patrolling"}

@app.post("/api/mission/patrol/stop")
async def stop_patrol():
    global is_patrolling
    is_patrolling = False
    motor_controller.stop()
    return {"status": "stopped"}
@app.get("/api/status")
async def get_status():
    return hazard_monitor.get_current_status() if hazard_monitor else {}

@app.get("/api/logs")
async def get_logs():
    logs = await get_recent_logs()
    return JSONResponse(content=logs)

@app.get("/api/export/mission")
async def export_mission():
    """Generates a CSV of the mission history including Radar data."""
    logs = await get_all_environmental_logs()
    
    output = io.StringIO()
    # Updated fieldnames for modern mission telemetry
    fieldnames = ["timestamp", "gas_analog", "gas_alert", "fire_alert", "radar_dist", "radar_alert"]
    # extrasaction='ignore' prevents 500 errors if old columns exist in the DB
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction='ignore')
    writer.writeheader()
    
    for row in logs:
        # Filter unwanted columns like ID
        writer.writerow({k: v for k, v in row.items() if k != "id"})
    
    output.seek(0)
    filename = f"mission_log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.post("/api/mission/clear")
async def clear_mission():
    """Resets the surveillance duration logs."""
    await clear_mission_data()
    return {"status": "ok", "message": "Mission logs cleared"}

# Pan Servo control
@app.post("/api/servo")
async def move_servo(cmd: ServoCommand):
    """Sends a pan servo angle command to the ESP32."""
    if not hazard_monitor:
        raise HTTPException(status_code=503, detail="Monitor not initialized")
    success = hazard_monitor.send_servo_command(cmd.angle)
    if success:
        import time
        import backend.webrtc as webrtc_module
        webrtc_module._servo_moved_at = time.time()
        webrtc_module._prev_frame = None
        await sio.emit("servo_moved", {"angle": cmd.angle})
        
        # Record for Mission Memory if active
        if is_recording_mission:
            record_event("servo", "move", cmd.angle)
        return {"status": "ok", "angle": cmd.angle}
    raise HTTPException(status_code=500, detail="Serial write failed")

# Tilt Servo control
@app.post("/api/tilt")
async def move_tilt(cmd: TiltCommand):
    """Sends a tilt servo angle command to the ESP32."""
    if not hazard_monitor:
        raise HTTPException(status_code=503, detail="Monitor not initialized")
    success = hazard_monitor.send_tilt_command(cmd.angle)
    if success:
        import backend.webrtc as webrtc_module
        webrtc_module._prev_frame = None
        await sio.emit("tilt_moved", {"angle": cmd.angle})

        # Record for Mission Memory if active
        if is_recording_mission:
            record_event("tilt", "move", cmd.angle)
        return {"status": "ok", "angle": cmd.angle}
    raise HTTPException(status_code=500, detail="Serial write failed")

# Motor control
@app.post("/api/motor")
async def motor_move(cmd: MotorCommand):
    """Controls robot movement via L298N on Raspberry Pi GPIO."""
    direction = cmd.direction.lower()
    speed     = max(0, min(100, cmd.speed))
    
    # Always clear the lock when a fresh command is received from the user
    motor_controller.clear_obstacle_lock()
    motor_controller.set_speed(speed)

    actions = {
        "forward":  motor_controller.forward,
        "backward": motor_controller.backward,
        "left":     motor_controller.turn_left,
        "right":    motor_controller.turn_right,
        "stop":     motor_controller.stop,
        "brake":    motor_controller.emergency_brake,
    }

    if direction not in actions:
        raise HTTPException(status_code=400, detail=f"Unknown direction: {direction}")

    actions[direction]()
    
    # Record for Mission Memory if active
    if is_recording_mission:
        record_event("motor", direction, speed)

    status = motor_controller.get_status()
    await sio.emit("motor_status", status)
    return {"status": "ok", **status}

@app.get("/api/motor/status")
async def motor_status():
    return motor_controller.get_status()

# WebRTC
@app.post("/webrtc/offer")
async def webrtc_offer(offer: Offer):
    try:
        answer = await create_pc(offer.dict(), sio=sio)
        return answer
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Recording
@app.post("/recording/start")
async def start_recording():
    try:
        status = hazard_monitor.get_current_status() if hazard_monitor else {}
        hazard_detected = bool(status.get("gas") or status.get("fire"))
        success, result = await recorder_instance.start(hazard_detected=hazard_detected)
        if success:
            await sio.emit("recording_status", {"status": "recording", "filename": result})
            return {"status": "recording", "filename": result}
        raise HTTPException(status_code=400, detail=result)
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Recording] Start error: {e}")
        raise HTTPException(status_code=500, detail=f"Recording failed: {str(e)}")

@app.post("/recording/stop")
async def stop_recording():
    try:
        success, result = await recorder_instance.stop()
        if success:
            await sio.emit("recording_status", {"status": "stopped", "filename": result})
            return {"status": "stopped", "filename": result}
        raise HTTPException(status_code=400, detail=result)
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Recording] Stop error: {e}")
        raise HTTPException(status_code=500, detail=f"Stop failed: {str(e)}")


# ─────────────────────────────────────────────
# Socket.IO Events
# ─────────────────────────────────────────────
@sio.event
async def connect(sid, environ):
    print(f"[WS] Client connected: {sid}")
    if hazard_monitor:
        status = hazard_monitor.get_current_status()
        await sio.emit("hazard_status", status, to=sid)
        
    # Also send immediate storage info if available
    try:
        total, used, free = shutil.disk_usage("/")
        await sio.emit("storage_status", {
            "percent": round((used / total) * 100, 1),
            "used_gb": round(used / (1024**3), 1),
            "total_gb": round(total / (1024**3), 1)
        }, to=sid)
    except: pass

@sio.event
async def disconnect(sid):
    print(f"[WS] Client disconnected: {sid}")

@sio.event
async def request_status(sid, data):
    if hazard_monitor:
        await sio.emit("hazard_status", hazard_monitor.get_current_status(), to=sid)

@sio.event
async def motor_move(sid, data):
    """
    Socket.IO motor command from any client (phone/laptop).
    Payload: {"direction": "forward|backward|left|right|stop|brake", "speed": 0-100}
    """
    direction = data.get("direction", "stop").lower()
    speed     = max(0, min(100, int(data.get("speed", 75))))
    
    # Always clear the lock when a fresh command is received from the user
    motor_controller.clear_obstacle_lock()
    motor_controller.set_speed(speed)

    actions = {
        "forward":  motor_controller.forward,
        "backward": motor_controller.backward,
        "left":     motor_controller.turn_left,
        "right":    motor_controller.turn_right,
        "stop":     motor_controller.stop,
        "brake":    motor_controller.emergency_brake,
    }
    if direction in actions:
        actions[direction]()
        
        # Record for Mission Memory if active
        if is_recording_mission:
            record_event("motor", direction, speed)

    status = motor_controller.get_status()
    await sio.emit("motor_status", status)

# Night vision removed per user request

@sio.on('set_zoom')
async def handle_set_zoom(sid, data):
    import backend.webrtc as webrtc_module
    level = float(data.get("level", 1.0))
    webrtc_module.zoom_level = max(1.0, min(4.0, level))
    print(f"[Vision] Zoom set to {webrtc_module.zoom_level}x")
    await sio.emit("zoom_status", {"level": webrtc_module.zoom_level})

@sio.on('servo_control')
async def handle_servo_socket(sid, data):
    """
    Socket handler for pan servo control.
    Payload: {"angle": 0-180}
    """
    angle = int(data.get("angle", 90))
    if not hazard_monitor: return
    
    success = hazard_monitor.send_servo_command(angle)
    if success:
        import time
        import backend.webrtc as webrtc_module
        webrtc_module._servo_moved_at = time.time()
        webrtc_module._prev_frame = None
        await sio.emit("servo_moved", {"angle": angle})
        
        if is_recording_mission:
            record_event("servo", "move", angle)

@sio.on('tilt_control')
async def handle_tilt_socket(sid, data):
    """
    Socket handler for tilt servo control.
    Payload: {"angle": 30-150}
    """
    angle = int(data.get("angle", 90))
    if not hazard_monitor: return
    
    success = hazard_monitor.send_tilt_command(angle)
    if success:
        import backend.webrtc as webrtc_module
        webrtc_module._prev_frame = None
        await sio.emit("tilt_moved", {"angle": angle})

@sio.on('toggle_motion_detection')
async def handle_toggle_motion(sid, data):
    import backend.webrtc as webrtc_module
    webrtc_module.motion_detection_enabled = not webrtc_module.motion_detection_enabled
    state = webrtc_module.motion_detection_enabled
    # Reset previous frame so a stale diff doesn't trigger immediately
    webrtc_module._prev_frame = None
    print(f"[Motion] Detection {'ON' if state else 'OFF'}")
    await sio.emit("motion_detection_status", {"enabled": state})

# Run with: uvicorn backend.app:sio_app --host 0.0.0.0 --port 8000
