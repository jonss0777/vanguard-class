
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

// WiFi Configuration

const char* WIFI_SSID     = "";
const char* WIFI_PASSWORD = "";

// Supabase Configuration
const char* SUPABASE_URL  = "";
const char* SUPABASE_KEY  = "";

// Hardware Pin Definitions (WROVER Safe - GPIO 16 & 17 Avoided)
const int PIN_LOCK_LED      = 4;   // Red LED: Lock Indicator
const int PIN_FLAP_INBOUND  = 33;  // Inbound LED (Moved from 17 due to WROVER PSRAM)
const int PIN_FLAP_OUTBOUND = 23;  // Outbound LED
const int PIN_FLAP_TWOWAY   = 25;  // Two-Way LED

const int TRIG_PIN          = 5;   // Ultrasonic Sensor Trig
const int ECHO_PIN          = 32;  // Ultrasonic Sensor Echo (Moved from 16 due to WROVER PSRAM)

// PCA9685 Setup
Adafruit_PWMServoDriver pca = Adafruit_PWMServoDriver(0x40);
#define SERVO_LEFT_CH   0
#define SERVO_RIGHT_CH  1
#define SERVOMIN        125  // ~0 degrees
#define SERVOMAX        575  // ~180 degrees

// Operational Parameters
const int TRIGGER_DISTANCE_CM = 15;   // Trigger door when object closer than 15cm
const int DOOR_OPEN_TIME_MS   = 4000; // Hold door open duration

// Global State Tracking
String windowState = "";
String flapRule    = "";
bool isDoorOpen    = false;

unsigned long lastPollTime = 0;
const unsigned long POLL_INTERVAL = 2000; // Poll Supabase every 2 seconds

// Convert Angle (0-180) to PCA Pulse
int angleToPulse(int angle) {
    return map(angle, 0, 180, SERVOMIN, SERVOMAX);
}

// Drive Both Servos to Open or Closed Positions
void setDoorPosition(bool open) {
    if (open) {
        pca.setPWM(SERVO_LEFT_CH, 0, angleToPulse(0));    
        pca.setPWM(SERVO_RIGHT_CH, 0, angleToPulse(180)); 
        isDoorOpen = true;
        Serial.println(" [Servos] Doors Opened");
    } else {
        pca.setPWM(SERVO_LEFT_CH, 0, angleToPulse(90));   
        pca.setPWM(SERVO_RIGHT_CH, 0, angleToPulse(90));  
        isDoorOpen = false;
        Serial.println(" [Servos] Doors Closed");
    }
}

// Ultrasonic Sensor Reading
float getDistanceCM() {
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);

    long duration = pulseIn(ECHO_PIN, HIGH, 30000); // 30ms Timeout
    if (duration == 0) return 999.0;
    
    return (duration * 0.0343) / 2.0;
}

void setup() {
    Serial.begin(115200);

    // Initialize Pins
    pinMode(PIN_LOCK_LED, OUTPUT);
    pinMode(PIN_FLAP_INBOUND, OUTPUT);
    pinMode(PIN_FLAP_OUTBOUND, OUTPUT);
    pinMode(PIN_FLAP_TWOWAY, OUTPUT);
    pinMode(TRIG_PIN, OUTPUT);
    pinMode(ECHO_PIN, INPUT);

    // Initialize PCA9685 PWM Driver
    Wire.begin(21, 22); // SDA=21, SCL=22
    pca.begin();
    pca.setPWMFreq(50); // Standard 50Hz Servo Frequency
    setDoorPosition(false); // Default closed position

    // Startup Flash Sequence
    digitalWrite(PIN_LOCK_LED, HIGH);
    digitalWrite(PIN_FLAP_INBOUND, HIGH);
    digitalWrite(PIN_FLAP_OUTBOUND, HIGH);
    digitalWrite(PIN_FLAP_TWOWAY, HIGH);
    delay(600);
    digitalWrite(PIN_LOCK_LED, LOW);
    digitalWrite(PIN_FLAP_INBOUND, LOW);
    digitalWrite(PIN_FLAP_OUTBOUND, LOW);
    digitalWrite(PIN_FLAP_TWOWAY, LOW);

    // WiFi Initialization
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.print("Connecting to WiFi");
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.println("\nWiFi Connected successfully!");
}

void loop() {
    // 1. Non-blocking Supabase DB Polling
    if (millis() - lastPollTime >= POLL_INTERVAL) {
        lastPollTime = millis();
        fetchSupabaseConfig();
    }

    // 2. Ultrasonic Motion Check
    checkUltrasonicDoorTrigger();
}

void checkUltrasonicDoorTrigger() {
    float distance = getDistanceCM();

    if (distance <= TRIGGER_DISTANCE_CM && distance > 0) {
        Serial.printf("\n[Sensor] Object Detected! Distance: %.1f cm\n", distance);

        if (windowState == "unlocked") {
            if (!isDoorOpen) {
                Serial.println(" -> Access Granted: Opening Door...");
                setDoorPosition(true);
                delay(DOOR_OPEN_TIME_MS);
                
                Serial.println(" -> Auto-Closing Door...");
                setDoorPosition(false);
            }
        } else {
            Serial.println(" -> Access Denied: System is LOCKED.");
            
            // Access Denied Warning: Flash Red LED 3 times
            for (int i = 0; i < 3; i++) {
                digitalWrite(PIN_LOCK_LED, LOW);
                delay(100);
                digitalWrite(PIN_LOCK_LED, HIGH);
                delay(100);
            }
            // Ensure Red LED returns to SOLID HIGH (Locked state)
            digitalWrite(PIN_LOCK_LED, HIGH);
        }
    }
}

void fetchSupabaseConfig() {
    if (WiFi.status() != WL_CONNECTED) return;

    HTTPClient http;
    http.begin(SUPABASE_URL);
    http.addHeader("apikey", SUPABASE_KEY);
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);

    int httpCode = http.GET();

    if (httpCode == HTTP_CODE_OK) {
        String payload = http.getString();

        StaticJsonDocument<256> doc;
        DeserializationError error = deserializeJson(doc, payload);

        if (!error) {
            String newWindowState = "";
            String newFlapRule    = "";

            if (doc.is<JsonArray>() && doc.size() > 0) {
                newWindowState = doc[0]["window_state"].as<String>();
                newFlapRule    = doc[0]["flap_rule"].as<String>();
            } else if (doc.is<JsonObject>()) {
                newWindowState = doc["window_state"].as<String>();
                newFlapRule    = doc["flap_rule"].as<String>();
            }

            // Update Hardware if state has changed
            if (newWindowState != windowState || newFlapRule != flapRule) {
                windowState = newWindowState;
                flapRule    = newFlapRule;

                Serial.println("\n==================================");
                Serial.println("  DATABASE STATE CHANGED");
                Serial.printf("  Window: %s | Flap: %s\n", windowState.c_str(), flapRule.c_str());
                Serial.println("==================================");

                updateHardwareOutputs();
            }
        }
    }
    http.end();
}

void updateHardwareOutputs() {
    // 1. Red Lock Indicator LED
    if (windowState == "unlocked") {
        digitalWrite(PIN_LOCK_LED, LOW);  // LED OFF = Unlocked
        Serial.println(" -> [Hardware] Red LED LOW  (Door Unlocked)");
    } else {
        digitalWrite(PIN_LOCK_LED, HIGH); // LED ON = Locked
        Serial.println(" -> [Hardware] Red LED HIGH (Door Locked)");
    }

    // 2. Flap Rule Outputs
    if (flapRule == "two_way" || flapRule == "both") {
        digitalWrite(PIN_FLAP_INBOUND, LOW);
        digitalWrite(PIN_FLAP_OUTBOUND, LOW);
        digitalWrite(PIN_FLAP_TWOWAY, HIGH);
    } 
    else if (flapRule == "outbound_only" || flapRule == "outbound") {
        digitalWrite(PIN_FLAP_INBOUND, LOW);
        digitalWrite(PIN_FLAP_OUTBOUND, HIGH);
        digitalWrite(PIN_FLAP_TWOWAY, LOW);
    } 
    else { 
        digitalWrite(PIN_FLAP_INBOUND, HIGH);
        digitalWrite(PIN_FLAP_OUTBOUND, LOW);
        digitalWrite(PIN_FLAP_TWOWAY, LOW);
    }
}