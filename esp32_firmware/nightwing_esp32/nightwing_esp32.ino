/**
 * Nightwing Robot - ESP32 Firmware
 * 
 * PIN CONNECTIONS:
 * - MQ-2 AO         → GPIO 35 (Analog input)
 * - MQ-2 DO         → GPIO 34 (Digital input, active low)
 * - Flame DO        → GPIO 32 (Digital input, active low)
 * - Pan Servo       → GPIO 25 (PWM output - horizontal rotation)
 * - Tilt Servo      → GPIO 26 (PWM output - vertical tilt)
 * - UART RX         → GPIO 16 (← Pi GPIO 14 TX)
 * - UART TX         → GPIO 17 (→ Pi GPIO 15 RX)
 * 
 * PROTOCOL (UART, 115200 baud, JSON lines):
 *   ESP32 → Pi : {"type":"sensor","gas_a":1024,"gas_d":1,"flame_d":1}\n
 *   Pi → ESP32 : {"cmd":"servo","angle":90}\n    (pan)
 *   Pi → ESP32 : {"cmd":"tilt","angle":90}\n     (tilt)
 */

#include <Arduino.h>
#include <ESP32Servo.h>
#include <ArduinoJson.h>

// --- Pin Definitions ---
#define MQ2_ANALOG_PIN    35
#define MQ2_DIGITAL_PIN   34
#define FLAME_DIGITAL_PIN 32
#define PAN_SERVO_PIN     25   // Horizontal pan
#define TILT_SERVO_PIN    26   // Vertical tilt
#define UART_RX_PIN       16
#define UART_TX_PIN       17

// --- Thresholds ---
#define GAS_ANALOG_THRESHOLD  2000  // Out of 4095 (12-bit ADC)

// --- Intervals ---
#define SENSOR_SEND_INTERVAL_MS 200

// --- Globals ---
Servo panServo;
Servo tiltServo;
HardwareSerial piSerial(2); // Use UART2 with custom pins
unsigned long lastSendTime = 0;
int currentPanAngle  = 90; // Start at center
int currentTiltAngle = 90; // Start at center (level)

void setup() {
  Serial.begin(115200); // Debug serial (USB)

  // Pi UART
  piSerial.begin(115200, SERIAL_8N1, UART_RX_PIN, UART_TX_PIN);

  // Input pins
  pinMode(MQ2_DIGITAL_PIN, INPUT);
  pinMode(FLAME_DIGITAL_PIN, INPUT);

  // Pan Servo (horizontal)
  ESP32PWM::allocateTimer(0);
  panServo.setPeriodHertz(50);
  panServo.attach(PAN_SERVO_PIN, 500, 2400);
  panServo.write(currentPanAngle);

  // Tilt Servo (vertical)
  ESP32PWM::allocateTimer(1);
  tiltServo.setPeriodHertz(50);
  tiltServo.attach(TILT_SERVO_PIN, 500, 2400);
  tiltServo.write(currentTiltAngle);

  Serial.println("[Nightwing ESP32] Pan+Tilt Initialized.");
}

void loop() {
  // --- Read and send sensor data ---
  if (millis() - lastSendTime >= SENSOR_SEND_INTERVAL_MS) {
    lastSendTime = millis();

    int gasAnalog    = analogRead(MQ2_ANALOG_PIN);
    int gasDigital   = digitalRead(MQ2_DIGITAL_PIN);    // Active low: 0 = alert
    int flameDigital = digitalRead(FLAME_DIGITAL_PIN);  // Active low: 0 = alert

    // Build JSON
    StaticJsonDocument<128> doc;
    doc["type"]    = "sensor";
    doc["gas_a"]   = gasAnalog;
    doc["gas_d"]   = gasDigital;
    doc["flame_d"] = flameDigital;

    String output;
    serializeJson(doc, output);
    piSerial.println(output);

    // Also print to USB debug
    Serial.println(output);
  }

  // --- Read Pi commands ---
  if (piSerial.available()) {
    String line = piSerial.readStringUntil('\n');
    line.trim();
    if (line.length() > 0) {
      StaticJsonDocument<64> cmd;
      DeserializationError err = deserializeJson(cmd, line);
      if (!err) {

        // ── Pan Command ──
        if (strcmp(cmd["cmd"], "servo") == 0) {
          int angle = constrain((int)cmd["angle"], 0, 180);
          panServo.write(angle);
          currentPanAngle = angle;
          Serial.printf("[Pan] Moved to %d degrees\n", angle);

          // Acknowledge back to Pi
          StaticJsonDocument<64> ack;
          ack["type"]  = "servo_ack";
          ack["angle"] = angle;
          String ackStr;
          serializeJson(ack, ackStr);
          piSerial.println(ackStr);
        }

        // ── Tilt Command ──
        else if (strcmp(cmd["cmd"], "tilt") == 0) {
          int angle = constrain((int)cmd["angle"], 30, 150); // Limit tilt range to avoid strain
          tiltServo.write(angle);
          currentTiltAngle = angle;
          Serial.printf("[Tilt] Moved to %d degrees\n", angle);

          // Acknowledge back to Pi
          StaticJsonDocument<64> ack;
          ack["type"]  = "tilt_ack";
          ack["angle"] = angle;
          String ackStr;
          serializeJson(ack, ackStr);
          piSerial.println(ackStr);
        }
      }
    }
  }
}
