import aiosqlite
import asyncio
from datetime import datetime
import os

DB_PATH = "logs/surveillance.db"

async def init_db():
    """Initializes the database and creates tables if they don't exist."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS hazard_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sensor_type TEXT NOT NULL,
                value INTEGER NOT NULL,
                detected_at TEXT NOT NULL,
                resolved_at TEXT
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS recordings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                hazard_detected BOOLEAN DEFAULT FALSE
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS environmental_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                gas_analog INTEGER NOT NULL,
                gas_alert INTEGER NOT NULL,
                fire_alert INTEGER NOT NULL,
                radar_dist INTEGER NOT NULL,
                radar_alert INTEGER NOT NULL
            )
        """)
        await db.commit()

async def log_hazard(sensor_type, value):
    """Logs a hazard detection event."""
    async with aiosqlite.connect(DB_PATH) as db:
        timestamp = datetime.now().isoformat()
        await db.execute(
            "INSERT INTO hazard_logs (sensor_type, value, detected_at) VALUES (?, ?, ?)",
            (sensor_type, value, timestamp)
        )
        await db.commit()
        return db.total_changes > 0

async def update_hazard_resolution(log_id):
    """Updates a hazard log with its resolution time."""
    async with aiosqlite.connect(DB_PATH) as db:
        timestamp = datetime.now().isoformat()
        await db.execute(
            "UPDATE hazard_logs SET resolved_at = ? WHERE id = ?",
            (timestamp, log_id)
        )
        await db.commit()

async def log_recording(filename, hazard_detected=False):
    """Logs a new recording entry."""
    async with aiosqlite.connect(DB_PATH) as db:
        timestamp = datetime.now().isoformat()
        await db.execute(
            "INSERT INTO recordings (filename, started_at, hazard_detected) VALUES (?, ?, ?)",
            (filename, timestamp, hazard_detected)
        )
        await db.commit()
        return db.total_changes > 0

async def get_recent_logs(limit=50):
    """Retrieves the last 50 hazard logs."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM hazard_logs ORDER BY detected_at DESC LIMIT ?",
            (limit,)
        ) as cursor:
            return [dict(row) for row in await cursor.fetchall()]

async def log_environmental_snapshot(gas_a, gas_d, fire_d, r_dist, r_alert):
    """Logs a periodic snapshot of all sensors and telemetry."""
    async with aiosqlite.connect(DB_PATH) as db:
        timestamp = datetime.now().isoformat()
        await db.execute(
            """INSERT INTO environmental_logs 
               (timestamp, gas_analog, gas_alert, fire_alert, radar_dist, radar_alert) 
               VALUES (?, ?, ?, ?, ?, ?)""",
            (timestamp, gas_a, 1 if gas_d == 0 else 0, 1 if fire_d == 0 else 0, r_dist, 1 if r_alert else 0)
        )
        await db.commit()

async def get_all_environmental_logs():
    """Retrieves all logs for CSV export."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM environmental_logs ORDER BY timestamp ASC") as cursor:
            return [dict(row) for row in await cursor.fetchall()]

async def clear_mission_data():
    """Resets the current mission session by clearing logs."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM environmental_logs")
        await db.execute("DELETE FROM hazard_logs")
        await db.commit()

if __name__ == "__main__":
    # Test initialization
    asyncio.run(init_db())
    print(f"Database initialized at {DB_PATH}")
