# Coding Standards & Rules

This document defines mandatory development standards for the project.

---

# 1. General Principles

- Code must be modular.
- No hardware logic inside route handlers.
- No blocking loops in main thread.
- All sensor monitoring must run in background threads or async tasks.
- Follow Single Responsibility Principle.

---

# 2. Backend Rules (Python)

## Structure
- app.py → Only routing
- sensors.py → Sensor logic only
- webrtc.py → Video/audio streaming
- recording.py → Recording management

## Naming Conventions

Variables: snake_case
Functions: snake_case
Classes: PascalCase
Constants: UPPER_CASE

Example:
GAS_PIN = 24

def read_gas_sensor():
    pass

---

## GPIO Rules

- Never access GPIO directly inside Flask routes.
- Always use abstraction layer in sensors.py.
- Use debounce timing.
- Handle 3.3V safety logic properly.

---

## WebSocket Rules

- All hazard alerts must emit structured JSON:

{
  "type": "hazard",
  "sensor": "gas",
  "value": 1,
  "timestamp": "ISO8601"
}

---

## Error Handling

- Use try/except for all hardware reads.
- Log errors to file.
- Never crash main server on sensor failure.

---

# 3. Frontend Rules

## Structure

/components
/services
/hooks (if React)
/styles

---

## State Management

- Use centralized state (React Context or single state object).
- Sensor alerts must update UI instantly.
- No polling if WebSocket is available.

---

## UI Alert Rules

If GAS detected:
- Flash red banner
- Play alert sound
- Show timestamp

If FIRE detected:
- Flash orange/red
- Show severity level

---

# 4. Recording Rules

Client-Side:
- Use MediaRecorder API
- Download as .webm

Server-Side:
- Store in /recordings/
- Filename format:
  recording_YYYYMMDD_HHMMSS.mp4

---

# 5. Security Rules

- No open endpoints without auth.
- Use environment variables for secrets.
- Do not expose internal IPs in frontend.

---

# 6. Performance Rules

- Video latency target: < 500ms
- Sensor update frequency: 100–500ms
- Avoid memory leaks in WebRTC streams.

---

# 7. Logging Standard

Use structured logs:

[2026-04-01 14:22:10] GAS_DETECTED value=1

Log file:
logs/system.log

---

# 8. Code Review Requirements

Before merging:
✅ No blocking code
✅ GPIO cleanup implemented
✅ WebSocket tested
✅ Memory usage checked
✅ Error handling verified

---

Failure to follow these rules may cause:
- Audio lag
- Sensor delay
- Pi overheating
- System crashes