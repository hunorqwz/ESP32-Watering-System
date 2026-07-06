#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <HTTPClient.h>
#include <time.h>
#include <Preferences.h>
#include <WebServer.h>
#include <DNSServer.h>

// --- Configuration & Host Constants ---
// Setup default static connection parameters (updated on boot if dynamic config matches)
const char* fallback_ssid     = "DIGI-56KC";
const char* fallback_password = "CxuxFeduPx";
String active_ssid = "";
String active_password = "";
const char* mqtt_server = "bcc1fdaf.ala.eu-central-1.emqxsl.com";
const int mqtt_port = 8883;
const char* mqtt_user = "WateringSystem_ESP32";
const char* mqtt_pass = "tdsHU$TkT2UwE9L7S6M&";

// API security token to authenticate the ESP32 with your server
const char* api_access_token = "8a6c03267e3b603d90ddb23c2ae6917102c807eec6d38554";

// The Next.js API server host URL
const char* fallback_http_server = "http://192.168.1.135:3000"; // REPLACE with your active Next.js server local IP/domain
String active_http_server = "";

// --- Hardware Pins (Dynamic Fallbacks) ---
int pin_trig = 14; // Default trigger pin for water level sensor
int pin_echo = 27; // Default echo pin for water level sensor (can be remapped dynamically)
int pin_dht  = 13; // Default DHT data pin (can be remapped dynamically)

#define DHTTYPE DHT11
#define RELAY_ON LOW
#define RELAY_OFF HIGH
DHT* dht = nullptr; // Instantiated dynamically based on configured pins

// --- Dynamic Models ---
struct SensorConfig {
  int id;
  char name[32];
  char type[20]; // "moisture", "temperature", "humidity", "water_level"
  int pin;
  int dryLimit;
  int wetLimit;
};

struct PumpConfig {
  int id;
  char name[32];
  int pin;
  int state;
  unsigned long turnedOnAt;         // Watchdog: Timestamp when pump was turned on
  unsigned long scheduleDurationMs; // Duration of active scheduled run in milliseconds
  bool hasScheduleTimer;            // Flag indicating if a local timer is active
};

struct WateringFlow {
  int id;
  char name[32];
  int pumpId;
  int sensorIds[10];
  int sensorCount;
};

struct LocalSchedule {
  int id;
  int pumpIds[5];
  int pumpCount;
  int flowIds[5];
  int flowCount;
  int hour;
  int minute;
  int durationSeconds;
  int daysOfWeek[7];
  int dayCount;
  int cycles;
  int soakDurationSeconds;
  
  // Dynamic Cycle & Soak State
  bool isPulseActive;
  bool isSoaking;
  int currentCycle;
  unsigned long lastPhaseTimestamp;
};

SensorConfig sensors[10];
int sensorCount = 0;

PumpConfig pumps[10];
int pumpCount = 0;

WateringFlow flows[10];
int flowCount = 0;

LocalSchedule schedules[10];
int scheduleCount = 0;

// --- SSL Root Certificate (DigiCert Global Root G2) ---
const char* ca_cert = R"EOF(
-----BEGIN CERTIFICATE-----
MIIDjjCCAnagAwIBAgIQAzrx5qcRqaC7KGSxHQn65TANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0xMzA4MDExMjAwMDBaFw0zODAxMTUxMjAwMDBaMGExCzAJBgNVBAYTAlVT
MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j
b20xIDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBSb290IEcyMIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuzfNNNx7a8myaJCtSnX/RrohCgiN9RlUyfuI
2/Ou8jqJkTx65qsGGmvPrC3oXgkkRLpimn7Wo6h+4FR1IAWsULecYxpsMNzaHxmx
1x7e/dfgy5SDN67sH0NO3Xss0r0upS/kqbitOtSZpLYl6ZtrAGCSYP9PIUkY92eQ
q2EGnI/yuum06ZIya7XzV+hdG82MHauVBJVJ8zUtluNJbd134/tJS7SsVQepj5Wz
tCO7TG1F8PapspUwtP1MVYwnSlcUfIKdzXOS0xZKBgyMUNGPHgm+F6HmIcr9g+UQ
vIOlCsRnKPZzFBQ9RnbDhxSJITRNrw9FDKZJobq7nMWxM4MphQIDAQABo0IwQDAP
BgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNVHQ4EFgQUTiJUIBiV
5uNu5g/6+rkS7QYXjzkwDQYJKoZIhvcNAQELBQADggEBAGBnKJRvDkhj6zHd6mcY
1Yl9PMWLSn/pvtsrF9+wX3N3KjITOYFnQoQj8kVnNeyIv/iPsGEMNKSuIEyExtv4
NeF22d+mQrvHRAiGfzZ0JFrabA0UWTW98kndth/Jsw1HKj2ZL7tcu7XUIOGZX1NG
Fdtom/DzMNU+MeKNhJ7jitralj41E6Vf8PlwUHBHQRFXGU7Aj64GxJUTFy8bJZ91
8rGOmaFvE7FBcf6IKshPECBV1/MUReXgRPTqh5Uykw7+U0b6LJ3/iyK5S9kJRaTe
pLiaWN0bfVKfjllDiIGknibVb63dDcY3fe0Dkhvld1927jyNxF1WW6LZZm6zNTfl
MrY=
-----END CERTIFICATE-----
)EOF";

WiFiClientSecure espClient;
PubSubClient client(espClient);

// Timing & State variables
unsigned long lastMsg = 0;
unsigned long telemetryInterval = 15 * 60 * 1000; // Defaults to 15 mins (dynamic configuration updates this)
bool forceBootTelemetry = true;

// Safety & Offline Control variables
unsigned long pumpSafetyTimeout = 300;     // Safety Watchdog: defaults to 5 minutes (300 seconds)
long timezoneOffsetSeconds = 7200;          // Timezone offset: defaults to GMT+2 (Europe/Bucharest)
bool timeSynced = false;

// --- Preferences Flash Storage & Safety Fallbacks ---
Preferences preferences;

void saveSchedulesToFlash() {
  preferences.begin("irrigation", false);
  preferences.putInt("schedCount", scheduleCount);
  preferences.putBytes("schedules", schedules, sizeof(schedules));
  preferences.end();
  Serial.println("Schedules saved to flash memory.");
}

void loadSchedulesFromFlash() {
  preferences.begin("irrigation", true);
  int count = preferences.getInt("schedCount", 0);
  if (count > 0 && count <= 10) {
    scheduleCount = count;
    preferences.getBytes("schedules", schedules, sizeof(schedules));
    Serial.printf("Loaded %d schedules from flash memory.\n", scheduleCount);
  }
  preferences.end();
}

void saveLastKnownTime(time_t t) {
  preferences.begin("irrigation", false);
  preferences.putLong("lastTime", (long)t);
  preferences.end();
}

void loadLastKnownTime() {
  preferences.begin("irrigation", true);
  long t = preferences.getLong("lastTime", 0);
  preferences.end();
  if (t > 0 && !timeSynced) {
    struct timeval tv;
    tv.tv_sec = t;
    tv.tv_usec = 0;
    settimeofday(&tv, NULL);
    Serial.printf("Offline boot: System clock set to last known time: %ld\n", t);
    timeSynced = true; 
  }
}

float getWaterLevel(); // Forward declaration for safety check function

bool checkReservoirSafety() {
  for (int i = 0; i < sensorCount; i++) {
    if (strcmp(sensors[i].type, "water_level") == 0) {
      float dist = getWaterLevel();
      if (dist <= 0) {
        Serial.println("Local Safety Alert: Reservoir water level sensor failed or disconnected! Blocking pump for safety.");
        return false;
      }
      
      int dry = sensors[i].dryLimit;
      int wet = sensors[i].wetLimit;
      int height = dry - wet;
      float waterHeight = (float)dry - dist;
      if (waterHeight < 0) waterHeight = 0;
      
      float pct = 0;
      if (height > 0) {
        pct = (waterHeight / (float)height) * 100.0;
      } else {
        pct = 100.0;
      }
      
      if (pct < 10.0) {
        Serial.printf("Local Safety Lockout: Reservoir water level too low (%.1f%%, distance: %.1f cm). Blocking pump.\n", pct, dist);
        return false;
      }
      break;
    }
  }
  return true;
}

// --- Fallback Local Configurations ---
void setupDefaultConfig() {
  Serial.println("Loading default hardware fallback mappings...");
  
  sensorCount = 8;
  
  // Moisture Sensors (Zones 1-5)
  for (int i = 0; i < 5; i++) {
    sensors[i].id = i + 1;
    snprintf(sensors[i].name, sizeof(sensors[i].name), "Zone %d", i + 1);
    strcpy(sensors[i].type, "moisture");
    sensors[i].pin = (i == 4) ? 39 : (32 + i); // Maps 32, 33, 34, 35, 39
    sensors[i].dryLimit = 3400;
    sensors[i].wetLimit = 1100;
    pinMode(sensors[i].pin, INPUT);
  }
  
  // Temperature
  sensors[5].id = 6;
  strcpy(sensors[5].name, "Ambient Temp");
  strcpy(sensors[5].type, "temperature");
  sensors[5].pin = pin_dht;

  // Humidity
  sensors[6].id = 7;
  strcpy(sensors[6].name, "Ambient Humidity");
  strcpy(sensors[6].type, "humidity");
  sensors[6].pin = pin_dht;

  // Ultrasonic Reservoir
  sensors[7].id = 8;
  strcpy(sensors[7].name, "Reservoir Level");
  strcpy(sensors[7].type, "water_level");
  sensors[7].pin = pin_echo;
  sensors[7].dryLimit = 100;
  sensors[7].wetLimit = 0;
  
  pinMode(pin_echo, INPUT);
  pinMode(pin_trig, OUTPUT);

  // Re-instantiate DHT for fallback pin
  if (dht != nullptr) delete dht;
  dht = new DHT(pin_dht, DHTTYPE);
  dht->begin();

  // Pump Outputs (Pumps 1-4)
  pumpCount = 4;
  int defaultPumpPins[4] = {26, 25, 18, 19};
  for (int i = 0; i < 4; i++) {
    pumps[i].id = i + 1;
    snprintf(pumps[i].name, sizeof(pumps[i].name), "Pump %d", i + 1);
    pumps[i].pin = defaultPumpPins[i];
    pumps[i].state = 0;
    pumps[i].turnedOnAt = 0;
    pumps[i].scheduleDurationMs = 0;
    pumps[i].hasScheduleTimer = false;
    
    pinMode(pumps[i].pin, OUTPUT);
    digitalWrite(pumps[i].pin, RELAY_OFF); // Set to default off state
  }
}

// Setup NTP server time synchronization based on UTC offset
void syncTime() {
  Serial.printf("Configuring NTP with offset: %ld seconds...\n", timezoneOffsetSeconds);
  configTime(timezoneOffsetSeconds, 0, "pool.ntp.org", "time.nist.gov");
  
  // Wait up to 5 seconds to get a valid time sync
  struct tm timeinfo;
  int retry = 0;
  while (!getLocalTime(&timeinfo) && retry < 10) {
    delay(500);
    Serial.print(".");
    retry++;
  }
  
  if (getLocalTime(&timeinfo)) {
    Serial.println("\nNTP Time successfully synchronized!");
    Serial.printf("Current local time: %02d:%02d:%02d\n", timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
    timeSynced = true;
  } else {
    Serial.println("\nFailed to sync time via NTP. Will retry on next config fetch.");
    timeSynced = false;
  }
}

// --- HTTP Configuration Ingestion ---
void fetchConfiguration() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Cannot sync configs: WiFi is offline.");
    return;
  }
  
  HTTPClient http;
  char configUrl[128];
  snprintf(configUrl, sizeof(configUrl), "%s/api/device/config", active_http_server.c_str());
  
  Serial.printf("Fetching configurations from: %s\n", configUrl);
  
  // Declaring clients at function scope keeps them alive during http.GET()
  WiFiClientSecure secureClient;
  WiFiClient plainClient;
  
  if (strncmp(active_http_server.c_str(), "https", 5) == 0) {
    secureClient.setCACert(ca_cert);
    http.begin(secureClient, configUrl);
  } else {
    http.begin(plainClient, configUrl);
  }
  
  // Send authorization token to proof device identity
  http.addHeader("Authorization", String("Bearer ") + api_access_token);
  http.addHeader("X-Device-SSID", active_ssid);
  
  int httpCode = http.GET();
  if (httpCode == HTTP_CODE_OK) {
    String payload = http.getString();
    
    // Dynamic allocation to support scaling schedule configurations cleanly on heap
    DynamicJsonDocument doc(8192);
    DeserializationError error = deserializeJson(doc, payload);
    
    if (error) {
      Serial.printf("Failed to parse server config payload: %s\n", error.c_str());
      http.end();
      return;
    }
    
    if (doc["success"].as<bool>()) {
      Serial.println("Configuration fetched and loaded successfully.");

      // Check for dynamic WiFi credentials updates
      if (doc.containsKey("wifi_ssid") && doc.containsKey("wifi_password")) {
        String newSsid = doc["wifi_ssid"].as<String>();
        String newPass = doc["wifi_password"].as<String>();
        
        // If the credentials changed, trigger reboot with pending configuration
        if (newSsid.length() > 0 && (newSsid != active_ssid || newPass != active_password)) {
          Serial.printf("New WiFi configuration detected: %s. Saving pending and rebooting...\n", newSsid.c_str());
          preferences.begin("irrigation", false);
          preferences.putBool("has_pending", true);
          preferences.putString("ssid_pending", newSsid);
          preferences.putString("pass_pending", newPass);
          preferences.end();
          delay(1000);
          ESP.restart();
        }
      }

      // 1. Update Telemetry Interval
      if (doc.containsKey("telemetry_interval_minutes")) {
        int intervalMins = doc["telemetry_interval_minutes"].as<int>();
        telemetryInterval = (unsigned long)intervalMins * 60 * 1000;
        Serial.printf("Dynamic Sleep interval set to: %lu ms\n", telemetryInterval);
      }

      // 2. Fetch safety watchdog timeout limit
      if (doc.containsKey("pump_safety_timeout_seconds")) {
        pumpSafetyTimeout = doc["pump_safety_timeout_seconds"].as<unsigned long>();
        Serial.printf("Safety watchdog maximum timeout set to: %lu seconds\n", pumpSafetyTimeout);
      }

      // 3. Fetch timezone offset & sync time
      if (doc.containsKey("timezone_offset_seconds")) {
        long newOffset = doc["timezone_offset_seconds"].as<long>();
        if (newOffset != timezoneOffsetSeconds || !timeSynced) {
          timezoneOffsetSeconds = newOffset;
          syncTime();
        }
      }
      
      // 4. Map Dynamic Sensors
      if (doc.containsKey("sensors")) {
        JsonArray sensorArr = doc["sensors"].as<JsonArray>();
        sensorCount = 0;
        int newDhtPin = -1;
        
        for (JsonVariant value : sensorArr) {
          if (sensorCount >= 10) break;
          JsonObject sensorObj = value.as<JsonObject>();
          if (sensorObj.isNull()) continue;
          
          sensors[sensorCount].id = sensorObj["id"].as<int>();
          const char* nameStr = sensorObj["name"].as<const char*>();
          strncpy(sensors[sensorCount].name, nameStr ? nameStr : "Unnamed Sensor", sizeof(sensors[sensorCount].name) - 1);
          sensors[sensorCount].name[sizeof(sensors[sensorCount].name) - 1] = '\0';
          
          const char* typeStr = sensorObj["type"].as<const char*>();
          strncpy(sensors[sensorCount].type, typeStr ? typeStr : "unknown", sizeof(sensors[sensorCount].type) - 1);
          sensors[sensorCount].type[sizeof(sensors[sensorCount].type) - 1] = '\0';
          
          sensors[sensorCount].pin = sensorObj["pin"].as<int>();
          
          sensors[sensorCount].dryLimit = sensorObj.containsKey("dry_limit") && !sensorObj["dry_limit"].isNull() ? sensorObj["dry_limit"].as<int>() : 3400;
          sensors[sensorCount].wetLimit = sensorObj.containsKey("wet_limit") && !sensorObj["wet_limit"].isNull() ? sensorObj["wet_limit"].as<int>() : 1100;
          
          // Re-init PIN modes
          if (strcmp(sensors[sensorCount].type, "temperature") == 0 || strcmp(sensors[sensorCount].type, "humidity") == 0) {
            newDhtPin = sensors[sensorCount].pin;
          } else if (strcmp(sensors[sensorCount].type, "water_level") == 0) {
            pin_echo = sensors[sensorCount].pin;
            pinMode(pin_echo, INPUT);
            pinMode(pin_trig, OUTPUT);
          } else {
            pinMode(sensors[sensorCount].pin, INPUT);
          }
          
          Serial.printf("  -> Mapped Sensor [%d]: %s (Type: %s, Pin: %d)\n", 
                        sensors[sensorCount].id, sensors[sensorCount].name, sensors[sensorCount].type, sensors[sensorCount].pin);
          sensorCount++;
        }
        
        // Handle DHT pin changes
        if (newDhtPin != -1 && newDhtPin != pin_dht) {
          pin_dht = newDhtPin;
          if (dht != nullptr) delete dht;
          dht = new DHT(pin_dht, DHTTYPE);
          dht->begin();
          Serial.printf("DHT data pin moved dynamically to pin: %d\n", pin_dht);
        }
      }
      
      // 5. Map Dynamic Pumps
      if (doc.containsKey("pumps")) {
        JsonArray pumpArr = doc["pumps"].as<JsonArray>();
        pumpCount = 0;
        
        for (JsonVariant value : pumpArr) {
          if (pumpCount >= 10) break;
          JsonObject pumpObj = value.as<JsonObject>();
          if (pumpObj.isNull()) continue;
          
          pumps[pumpCount].id = pumpObj["id"].as<int>();
          const char* pNameStr = pumpObj["name"].as<const char*>();
          strncpy(pumps[pumpCount].name, pNameStr ? pNameStr : "Unnamed Pump", sizeof(pumps[pumpCount].name) - 1);
          pumps[pumpCount].name[sizeof(pumps[pumpCount].name) - 1] = '\0';
          
          pumps[pumpCount].pin = pumpObj["pin"].as<int>();
          pumps[pumpCount].state = pumpObj.containsKey("state") ? pumpObj["state"].as<int>() : 0;
          
          pinMode(pumps[pumpCount].pin, OUTPUT);
          // Only change physical relay if it is not currently run by a local timer
          if (!pumps[pumpCount].hasScheduleTimer) {
            digitalWrite(pumps[pumpCount].pin, pumps[pumpCount].state ? RELAY_ON : RELAY_OFF);
          }
          
          Serial.printf("  -> Mapped Output [%d]: %s (Pin: %d, State: %s)\n", 
                        pumps[pumpCount].id, pumps[pumpCount].name, pumps[pumpCount].pin, pumps[pumpCount].state ? "ON" : "OFF");
          pumpCount++;
        }
      }
      
      // 5b. Map Dynamic Watering Flows
      if (doc.containsKey("flows")) {
        JsonArray flowArr = doc["flows"].as<JsonArray>();
        flowCount = 0;
        Serial.println("Loading dynamic flows (zones) into local memory...");
        
        for (JsonVariant value : flowArr) {
          if (flowCount >= 10) break;
          JsonObject flowObj = value.as<JsonObject>();
          if (flowObj.isNull()) continue;
          
          flows[flowCount].id = flowObj["id"].as<int>();
          const char* fNameStr = flowObj["name"].as<const char*>();
          strncpy(flows[flowCount].name, fNameStr ? fNameStr : "Unnamed Flow", sizeof(flows[flowCount].name) - 1);
          flows[flowCount].name[sizeof(flows[flowCount].name) - 1] = '\0';
          
          flows[flowCount].pumpId = flowObj["pump_id"].as<int>();
          
          JsonArray sensorList = flowObj["sensor_ids"].as<JsonArray>();
          flows[flowCount].sensorCount = 0;
          for (JsonVariant sVal : sensorList) {
            if (flows[flowCount].sensorCount >= 10) break;
            flows[flowCount].sensorIds[flows[flowCount].sensorCount++] = sVal.as<int>();
          }
          
          Serial.printf("  -> Mapped Flow [%d]: %s (Pump ID: %d, Sensors count: %d)\n",
                        flows[flowCount].id, flows[flowCount].name, flows[flowCount].pumpId, flows[flowCount].sensorCount);
          flowCount++;
        }
      }

      // 6. Map Offline Local Schedules
      if (doc.containsKey("schedules")) {
        JsonArray schedArr = doc["schedules"].as<JsonArray>();
        scheduleCount = 0;
        Serial.println("Loading offline schedules into local memory...");

        for (JsonVariant value : schedArr) {
          if (scheduleCount >= 10) break;
          JsonObject schedObj = value.as<JsonObject>();
          if (schedObj.isNull()) continue;

          LocalSchedule& s = schedules[scheduleCount];
          s.id = schedObj["id"].as<int>();
          s.durationSeconds = schedObj["duration_seconds"].as<int>();

          // Parse time string e.g. "08:00:00" -> hour: 8, minute: 0
          const char* timeStr = schedObj["time_of_day"].as<const char*>();
          int hr = 0, mn = 0;
          if (timeStr) {
            sscanf(timeStr, "%d:%d", &hr, &mn);
          }
          s.hour = hr;
          s.minute = mn;

          // Map targeted pump IDs (direct/legacy)
          s.pumpCount = 0;
          if (schedObj.containsKey("pump_ids") && !schedObj["pump_ids"].isNull()) {
            JsonArray pumpsList = schedObj["pump_ids"].as<JsonArray>();
            for (JsonVariant pVal : pumpsList) {
              if (s.pumpCount >= 5) break;
              s.pumpIds[s.pumpCount++] = pVal.as<int>();
            }
          }

          // Map targeted flow IDs
          s.flowCount = 0;
          if (schedObj.containsKey("flow_ids") && !schedObj["flow_ids"].isNull()) {
            JsonArray flowsList = schedObj["flow_ids"].as<JsonArray>();
            for (JsonVariant fVal : flowsList) {
              if (s.flowCount >= 5) break;
              s.flowIds[s.flowCount++] = fVal.as<int>();
            }
          }

          s.cycles = schedObj.containsKey("cycles") ? schedObj["cycles"].as<int>() : 1;
          s.soakDurationSeconds = schedObj.containsKey("soak_duration_seconds") ? schedObj["soak_duration_seconds"].as<int>() : 0;

          // Initialize runtime state
          s.isPulseActive = false;
          s.isSoaking = false;
          s.currentCycle = 0;
          s.lastPhaseTimestamp = 0;

          // Map weekdays
          JsonArray daysList = schedObj["days_of_week"].as<JsonArray>();
          s.dayCount = 0;
          for (JsonVariant dVal : daysList) {
            if (s.dayCount >= 7) break;
            s.daysOfWeek[s.dayCount++] = dVal.as<int>();
          }

          Serial.printf("  -> Schedule [%d] loaded: daily at %02d:%02d for %ds (Pumps: %d, Flows: %d, Cycles: %d, Soak: %ds)\n",
                        s.id, s.hour, s.minute, s.durationSeconds, s.pumpCount, s.flowCount, s.cycles, s.soakDurationSeconds);
          scheduleCount++;
        }
      }
      // Save schedules to flash memory after parsing successfully
      saveSchedulesToFlash();
    } else {
      Serial.printf("Server rejected config request: %s\n", doc["error"].as<const char*>());
    }
  } else {
    Serial.printf("HTTP GET dynamic config failed with status: %d\n", httpCode);
  }
  http.end();
}

// --- Ultrasonic Sensor Read ---
float getWaterLevel() {
  digitalWrite(pin_trig, LOW);
  delayMicroseconds(2);
  digitalWrite(pin_trig, HIGH);
  delayMicroseconds(10);
  digitalWrite(pin_trig, LOW);
  long duration = pulseIn(pin_echo, HIGH, 11600); 
  if (duration == 0) return 0;
  return (duration * 0.034 / 2); 
}

// --- Telemetry Dispatch ---
void sendTelemetry() {
  if (sensorCount == 0) {
    Serial.println("Skipped Telemetry: No sensors assigned.");
    return;
  }
  // Dynamic allocation to support multiple sensors scaling on heap safely
  DynamicJsonDocument doc(2048);
  doc["deviceId"] = "ESP32_01";
  JsonArray readingsArr = doc.createNestedArray("readings");

  for (int i = 0; i < sensorCount; i++) {
    JsonObject readingObj = readingsArr.createNestedObject();
    readingObj["sensorId"] = sensors[i].id;
    
    float val = -1;
    if (strcmp(sensors[i].type, "moisture") == 0) {
      val = analogRead(sensors[i].pin);
    } else if (strcmp(sensors[i].type, "temperature") == 0) {
      if (dht != nullptr) val = dht->readTemperature();
    } else if (strcmp(sensors[i].type, "humidity") == 0) {
      if (dht != nullptr) val = dht->readHumidity();
    } else if (strcmp(sensors[i].type, "water_level") == 0) {
      val = getWaterLevel();
    }
    
    if (isnan(val)) val = -1;
    readingObj["value"] = val;
  }

  char out[768];
  serializeJson(doc, out);
  
  client.publish("device/sensorData", out);
  Serial.println("Relational Telemetry sent to EMQX.");

  // Save current time to flash as last known time if we have synced time
  if (timeSynced) {
    time_t nowTime;
    time(&nowTime);
    saveLastKnownTime(nowTime);
  }
}

// --- MQTT Commands/Config Callback ---
void callback(char* topic, byte* payload, unsigned int length) {
  // Heap allocation to prevent stack overflow on dynamic command payloads
  DynamicJsonDocument doc(1024);
  DeserializationError error = deserializeJson(doc, payload, length);
  if (error) {
    Serial.println("Failed to parse incoming command JSON.");
    return;
  }

  if (strcmp(topic, "device/commands") == 0) {
    // 1. Handle dynamic pump toggles mapping database ID -> GPIO Pin
    if (doc.containsKey("pump") && doc.containsKey("state")) {
      int pumpId = doc["pump"].as<int>();
      int state = doc["state"].as<int>();      
      
      bool resolved = false;
      for (int i = 0; i < pumpCount; i++) {
        if (pumps[i].id == pumpId) {
          if (state == 1 && !checkReservoirSafety()) {
            Serial.printf("Output toggle rejected: Pump ID %d safety lockout active.\n", pumpId);
            return;
          }
          digitalWrite(pumps[i].pin, state ? RELAY_ON : RELAY_OFF);
          pumps[i].state = state;
          
          // Clear any active local scheduled timer on manual override
          pumps[i].hasScheduleTimer = false;
          
          if (state) {
            pumps[i].turnedOnAt = millis(); // Watchdog starts timing now
          }
          
          Serial.printf("Output toggle command: Pump ID %d (Pin %d) set to %d\n", pumpId, pumps[i].pin, state);
          resolved = true;
          
          // Send telemetry immediately to confirm the state change physically
          sendTelemetry(); 
          break;
        }
      }
      if (!resolved) {
        Serial.printf("Command ignored: Output ID %d was not mapped.\n", pumpId);
      }
    } 
    // 2. Handle Immediate Telemetry Refresh Action
    else if (doc.containsKey("action")) {
      const char* action = doc["action"].as<const char*>();
      if (action && strcmp(action, "refresh_telemetry") == 0) {
        Serial.println("Forced telemetry refresh received. Updating...");
        sendTelemetry();
      } 
      // Handle remote configuration reload triggers
      else if (action && strcmp(action, "reload_config") == 0) {
        Serial.println("Forced config reload request. Synchronizing...");
        fetchConfiguration();
      }
    }
  } 
  else if (strcmp(topic, "device/config") == 0) {
    // Fallback real-time telemetry interval update
    if (doc.containsKey("telemetry_interval_minutes")) {
      telemetryInterval = doc["telemetry_interval_minutes"].as<unsigned long>() * 60 * 1000;
      Serial.printf("Sleep cycle changed dynamically to: %lu ms\n", telemetryInterval);
    }
  }
}

// --- Dynamic Wi-Fi and Server Setup Captive Portal ---
void startCaptivePortal() {
  Serial.println("\n=== Starting Wi-Fi & Server Setup Captive Portal ===");
  
  // 1. Scan for nearby networks in STA mode before launching AP
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);
  Serial.println("Scanning nearby Wi-Fi networks...");
  int n = WiFi.scanNetworks();
  String ssidOptions = "";
  if (n <= 0) {
    Serial.println("No networks found.");
    ssidOptions = "<option value=\"\">No networks found. Enter manually.</option>";
  } else {
    Serial.printf("Scanned %d Wi-Fi networks.\n", n);
    for (int i = 0; i < n; ++i) {
      String ssid = WiFi.SSID(i);
      if (ssid.length() > 0) {
        // Render SSID options with signal strength indicator and padlock emoji for secured networks
        String signal = String(WiFi.RSSI(i)) + " dBm";
        bool secured = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
        ssidOptions += "<option value=\"" + ssid + "\">" + ssid + " (" + signal + ")" + (secured ? " 🔒" : "") + "</option>";
      }
    }
  }
  WiFi.scanDelete(); // Free scan results memory
  
  // 2. Start Access Point
  WiFi.mode(WIFI_AP);
  IPAddress apIP(192, 168, 4, 1);
  IPAddress subnet(255, 255, 255, 0);
  WiFi.softAPConfig(apIP, apIP, subnet);
  
  if (!WiFi.softAP("Watering-System-Setup")) {
    Serial.println("Error: Failed to start SoftAP.");
    return;
  }
  
  Serial.print("Access Point active. SSID: Watering-System-Setup. IP: ");
  Serial.println(WiFi.softAPIP());
  
  DNSServer dns;
  dns.start(53, "*", apIP);
  
  WebServer server(80);
  
  // Serve dynamic configuration HTML portal
  server.on("/", HTTP_GET, [&server, ssidOptions]() {
    String html = R"HTML(
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Irrigation Node Setup</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: rgba(22, 28, 45, 0.9);
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --primary: #3b82f6;
      --primary-glow: rgba(59, 130, 246, 0.5);
      --border: #1f2937;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(circle at center, #111827 0%, #030712 100%);
      color: var(--text);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      padding: 16px;
      box-sizing: border-box;
    }
    .container {
      background-color: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px 24px;
      width: 100%;
      max-width: 400px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(8px);
    }
    .header {
      text-align: center;
      margin-bottom: 28px;
    }
    .logo {
      display: inline-flex;
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
      border-radius: 12px;
      margin-bottom: 16px;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 15px var(--primary-glow);
    }
    .logo svg {
      width: 24px;
      height: 24px;
      fill: none;
      stroke: white;
      stroke-width: 2;
    }
    h2 {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.025em;
    }
    p {
      color: var(--text-muted);
      font-size: 13px;
      margin: 6px 0 0 0;
    }
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 6px;
      color: var(--text-muted);
    }
    select, input {
      width: 100%;
      padding: 12px 14px;
      background-color: rgba(3, 7, 18, 0.5);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 14px;
      box-sizing: border-box;
      transition: all 0.2s;
    }
    select {
      appearance: none;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg>");
      background-repeat: no-repeat;
      background-position: right 14px center;
      background-size: 16px;
    }
    select:focus, input:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--primary-glow);
      background-color: rgba(3, 7, 18, 0.8);
    }
    option {
      background-color: var(--bg);
      color: var(--text);
    }
    button {
      width: 100%;
      padding: 14px;
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      border: none;
      border-radius: 8px;
      color: #ffffff;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      margin-top: 8px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    }
    button:hover {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      transform: translateY(-1px);
    }
    button:active {
      transform: translateY(0);
    }
    .footer {
      text-align: center;
      margin-top: 24px;
      font-size: 11px;
      color: var(--text-muted);
    }
  </style>
  <script>
    function toggleSSIDInput() {
      var select = document.getElementById("ssid");
      var manualGroup = document.getElementById("manual_ssid_group");
      var manualInput = document.getElementById("manual_ssid");
      if (select.value === "__manual__") {
        manualGroup.style.display = "block";
        manualInput.required = true;
      } else {
        manualGroup.style.display = "none";
        manualInput.required = false;
        manualInput.value = "";
      }
    }
  </script>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">
        <svg viewBox="0 0 24 24">
          <path d="M12 2L2 22h20L12 2zm0 3.99L19.53 19H4.47L12 5.99zM11 11h2v4h-2zm0 6h2v2h-2z" />
        </svg>
      </div>
      <h2>Terrace Irrigation Node</h2>
      <p>Provision Wi-Fi & Next.js Server Credentials</p>
    </div>
    <form action="/save" method="POST">
      <div class="form-group">
        <label for="ssid">Select Wi-Fi Network</label>
        <select id="ssid" name="ssid" onchange="toggleSSIDInput()" required>
          #SSID_OPTIONS#
          <option value="__manual__">-- Enter SSID manually --</option>
        </select>
      </div>
      <div class="form-group" id="manual_ssid_group" style="display: none;">
        <label for="manual_ssid">Manual Network Name (SSID)</label>
        <input type="text" id="manual_ssid" name="manual_ssid" placeholder="Enter Wi-Fi network name">
      </div>
      <div class="form-group">
        <label for="password">Wi-Fi Password</label>
        <input type="password" id="password" name="password" placeholder="Enter Wi-Fi password (optional)">
      </div>
      <div class="form-group">
        <label for="server_url">Next.js Server API URL</label>
        <input type="text" id="server_url" name="server_url" required value="#SERVER_URL#">
      </div>
      <button type="submit">Save & Restart Device</button>
    </form>
    <div class="footer">
      Device will continue offline if setup is idle for 5 minutes.
    </div>
  </div>
</body>
</html>
)HTML";
    html.replace("#SSID_OPTIONS#", ssidOptions);
    html.replace("#SERVER_URL#", active_http_server);
    server.send(200, "text/html", html);
  });
  
  // Save credentials to Preferences and restart
  server.on("/save", HTTP_POST, [&server]() {
    String ssid = server.arg("ssid");
    String manualSsid = server.arg("manual_ssid");
    String password = server.arg("password");
    String serverUrl = server.arg("server_url");
    
    Serial.println("Captive Portal: Received provisioning request.");
    
    if (ssid == "__manual__") {
      ssid = manualSsid;
    }
    
    if (ssid.length() > 0 && serverUrl.length() > 0) {
      preferences.begin("irrigation", false);
      preferences.putString("wifi_ssid", ssid);
      preferences.putString("wifi_pass", password);
      preferences.putString("http_server", serverUrl);
      preferences.putBool("has_pending", false);
      preferences.end();
      
      String response = R"HTML(
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Configuration Saved</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: rgba(22, 28, 45, 0.9);
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --success: #10b981;
      --border: #1f2937;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(circle at center, #111827 0%, #030712 100%);
      color: var(--text);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      padding: 16px;
      box-sizing: border-box;
      text-align: center;
    }
    .container {
      background-color: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px 24px;
      width: 100%;
      max-width: 400px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(8px);
    }
    .icon {
      display: inline-flex;
      width: 56px;
      height: 56px;
      background-color: rgba(16, 185, 129, 0.1);
      border-radius: 50%;
      align-items: center;
      justify-content: center;
      margin-bottom: 20px;
      border: 1px solid rgba(16, 185, 129, 0.2);
    }
    .icon svg {
      width: 28px;
      height: 28px;
      fill: none;
      stroke: var(--success);
      stroke-width: 2.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    h2 {
      margin: 0 0 10px 0;
      font-size: 22px;
      font-weight: 700;
    }
    p {
      color: var(--text-muted);
      font-size: 14px;
      line-height: 1.5;
      margin: 0 0 16px 0;
    }
    .highlight {
      color: var(--text);
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">
      <svg viewBox="0 0 24 24">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>
    <h2>Settings Saved!</h2>
    <p>The ESP32 is rebooting now to connect to <span class="highlight">)HTML" + ssid + R"HTML(</span>.</p>
    <p>Please disconnect from the setup hotspot and reconnect your device to your home network.</p>
  </div>
</body>
</html>
)HTML";
      server.send(200, "text/html", response);
      delay(2000);
      ESP.restart();
    } else {
      server.send(400, "text/plain", "Bad Request: SSID and Server URL are required.");
    }
  });
  
  // Captive Portal Redirect
  server.onNotFound([&server]() {
    server.sendHeader("Location", "http://192.168.4.1/", true);
    server.send(302, "text/plain", "");
  });
  
  server.begin();
  
  unsigned long startMs = millis();
  const unsigned long portalTimeoutMs = 300000; // 5 minutes
  
  while (millis() - startMs < portalTimeoutMs) {
    dns.processNextRequest();
    server.handleClient();
    delay(10);
  }
  
  Serial.println("Captive Portal timeout. Continuing boot in offline mode...");
  
  // Graceful cleanup
  server.stop();
  dns.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  // Re-establish connection attempt in background using current active configs
  WiFi.begin(active_ssid.c_str(), active_password.c_str());
}

// --- Arduino Lifecycle Hook ---
void setup() {
  Serial.begin(115200); // 115200 Baud rate
  delay(2000); 
  Serial.println("\n=== ESP32 Irrigation Node Initialization ===");
  
  // Load local configs
  setupDefaultConfig();

  // Load/verify WiFi configurations from Preferences
  preferences.begin("irrigation", false);
  bool hasPending = preferences.getBool("has_pending", false);
  
  if (hasPending) {
    active_ssid = preferences.getString("ssid_pending", fallback_ssid);
    active_password = preferences.getString("pass_pending", fallback_password);
    Serial.printf("Booting with pending WiFi: %s\n", active_ssid.c_str());
  } else {
    active_ssid = preferences.getString("wifi_ssid", fallback_ssid);
    active_password = preferences.getString("wifi_pass", fallback_password);
    Serial.printf("Booting with active WiFi: %s\n", active_ssid.c_str());
  }
  active_http_server = preferences.getString("http_server", fallback_http_server);
  if (active_http_server.length() == 0) {
    active_http_server = fallback_http_server;
  }
  Serial.printf("Active HTTP Server: %s\n", active_http_server.c_str());
  preferences.end();

  Serial.print("Connecting to WiFi: ");
  Serial.println(active_ssid);
  WiFi.begin(active_ssid.c_str(), active_password.c_str());
  
  int attempt = 0;
  while (WiFi.status() != WL_CONNECTED && attempt < 20) { // Try for 10 seconds
    delay(500);
    Serial.print(".");
    attempt++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi network active.");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
    
    if (hasPending) {
      // Success: promote pending credentials to active
      preferences.begin("irrigation", false);
      preferences.putBool("has_pending", false);
      preferences.putString("wifi_ssid", active_ssid);
      preferences.putString("wifi_pass", active_password);
      preferences.end();
      Serial.println("Pending WiFi successfully promoted to active.");
    } else {
      // Confirm active credentials are saved
      preferences.begin("irrigation", false);
      preferences.putString("wifi_ssid", active_ssid);
      preferences.putString("wifi_pass", active_password);
      preferences.end();
    }
    
    // Dynamic configuration fetch from Next.js server on boot
    fetchConfiguration();
  } else {
    Serial.println("\nWiFi connection timed out.");
    bool connected = false;
    
    if (hasPending) {
      // Failure: clear pending and rollback to previously working credentials
      preferences.begin("irrigation", false);
      preferences.putBool("has_pending", false);
      active_ssid = preferences.getString("wifi_ssid", fallback_ssid);
      active_password = preferences.getString("wifi_pass", fallback_password);
      preferences.end();
      Serial.printf("Rollback: re-trying previously active WiFi: %s\n", active_ssid.c_str());
      
      WiFi.disconnect();
      WiFi.begin(active_ssid.c_str(), active_password.c_str());
      attempt = 0;
      while (WiFi.status() != WL_CONNECTED && attempt < 20) { // Try for 10 seconds
        delay(500);
        Serial.print(".");
        attempt++;
      }
      if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\nWiFi successfully restored after rollback.");
        fetchConfiguration();
        connected = true;
      } else {
        Serial.println("\nWiFi rollback failed.");
      }
    }
    
    if (!connected && active_ssid != fallback_ssid) {
      // Try connecting to fallback compile-time WiFi credentials as a secondary backup
      Serial.printf("Trying fallback WiFi: %s\n", fallback_ssid);
      WiFi.disconnect();
      WiFi.begin(fallback_ssid, fallback_password);
      attempt = 0;
      while (WiFi.status() != WL_CONNECTED && attempt < 20) { // Try for 10 seconds
        delay(500);
        Serial.print(".");
        attempt++;
      }
      if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\nWiFi successfully connected to fallback. Updating active configuration in Flash.");
        active_ssid = fallback_ssid;
        active_password = fallback_password;
        
        preferences.begin("irrigation", false);
        preferences.putString("wifi_ssid", active_ssid);
        preferences.putString("wifi_pass", active_password);
        preferences.end();
        
        fetchConfiguration();
        connected = true;
      } else {
        Serial.println("\nFallback WiFi connection failed.");
      }
    }
    
    if (!connected) {
      Serial.println("Could not establish a connection to any Wi-Fi networks. Launching setup portal...");
      startCaptivePortal();
    }
  }

  // Load fallback schedules and time from flash if not fetched/synced
  if (scheduleCount == 0) {
    loadSchedulesFromFlash();
  }
  loadLastKnownTime();

  // Configure MQTT
  espClient.setCACert(ca_cert);
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  client.setBufferSize(1024);
}

// --- Reconnection Logic (Non-blocking) ---
void reconnectNonBlocking() {
  // If WiFi is not connected, attempt reconnection without blocking the main loop
  if (WiFi.status() != WL_CONNECTED) {
    static unsigned long lastWiFiCheck = 0;
    unsigned long now = millis();
    if (now - lastWiFiCheck >= 10000) { // Try to reconnect WiFi every 10s
      lastWiFiCheck = now;
      Serial.println("WiFi connection lost. Attempting to reconnect...");
      WiFi.disconnect();
      WiFi.begin(active_ssid.c_str(), active_password.c_str());
    }
    return;
  }

  // Attempt MQTT connection if offline without blocking the main loop
  if (!client.connected()) {
    static unsigned long lastMqttRetry = 0;
    unsigned long now = millis();
    if (now - lastMqttRetry >= 10000) { // Try to connect MQTT every 10s
      lastMqttRetry = now;
      Serial.print("Connecting to EMQX TLS server... ");
      if (client.connect("ESP32_Watering_Client", mqtt_user, mqtt_pass)) {
        Serial.println("MQTT Connection established!");
        client.subscribe("device/commands");
        client.subscribe("device/config");
        // Fetch dynamic configuration after connection recovery
        fetchConfiguration();
      } else {
        Serial.print("Connection rejected, error rc=");
        Serial.print(client.state());
        Serial.println(". Will retry MQTT in 10 seconds.");
      }
    }
  }
}

// --- Helper to trigger a schedule watering cycle ---
void triggerScheduleCycle(LocalSchedule& s) {
  if (!checkReservoirSafety()) {
    Serial.println("Scheduled cycle aborted: local reservoir safety lockout active.");
    s.isPulseActive = false;
    return;
  }
  s.isPulseActive = true;
  s.isSoaking = false;
  s.lastPhaseTimestamp = millis();
  
  Serial.printf("Executing Schedule [%d] - Starting Cycle %d/%d\n", s.id, s.currentCycle + 1, s.cycles);
  
  // 1. Direct pump ids trigger (legacy)
  for (int pIdx = 0; pIdx < s.pumpCount; pIdx++) {
    int targetPumpId = s.pumpIds[pIdx];
    for (int p = 0; p < pumpCount; p++) {
      if (pumps[p].id == targetPumpId) {
        digitalWrite(pumps[p].pin, RELAY_ON); // ON
        pumps[p].state = 1;
        pumps[p].turnedOnAt = millis();
        pumps[p].scheduleDurationMs = (unsigned long)s.durationSeconds * 1000;
        pumps[p].hasScheduleTimer = true;
        Serial.printf("  -> Pump [%d] (Pin %d) ON for %d seconds\n", targetPumpId, pumps[p].pin, s.durationSeconds);
      }
    }
  }
  
  // 2. Flows target trigger (zones)
  for (int fIdx = 0; fIdx < s.flowCount; fIdx++) {
    int targetFlowId = s.flowIds[fIdx];
    for (int f = 0; f < flowCount; f++) {
      if (flows[f].id == targetFlowId) {
        int pumpId = flows[f].pumpId;
        for (int p = 0; p < pumpCount; p++) {
          if (pumps[p].id == pumpId) {
            digitalWrite(pumps[p].pin, RELAY_ON); // ON
            pumps[p].state = 1;
            pumps[p].turnedOnAt = millis();
            pumps[p].scheduleDurationMs = (unsigned long)s.durationSeconds * 1000;
            pumps[p].hasScheduleTimer = true;
            Serial.printf("  -> Zone Flow [%s] Pump [%d] (Pin %d) ON for %d seconds\n", flows[f].name, pumpId, pumps[p].pin, s.durationSeconds);
          }
        }
      }
    }
  }
  sendTelemetry();
}

// --- Local Schedules Evaluator ---
void checkLocalSchedules() {
  if (!timeSynced) return;

  // 1. Run dynamic cycle & soak timers for active schedules
  for (int i = 0; i < scheduleCount; i++) {
    LocalSchedule& s = schedules[i];
    if (s.isPulseActive) {
      unsigned long elapsed = millis() - s.lastPhaseTimestamp;
      
      if (s.isSoaking) {
        // Check if soak time has expired
        if (elapsed >= ((unsigned long)s.soakDurationSeconds * 1000)) {
          s.currentCycle++;
          if (s.currentCycle < s.cycles) {
            triggerScheduleCycle(s);
          } else {
            s.isPulseActive = false;
            Serial.printf("Schedule [%d] complete. Finished all %d cycles.\n", s.id, s.cycles);
          }
        }
      } else {
        // Check if active watering cycle time has expired
        if (elapsed >= ((unsigned long)s.durationSeconds * 1000)) {
          if (s.soakDurationSeconds > 0 && (s.currentCycle + 1 < s.cycles)) {
            s.isSoaking = true;
            s.lastPhaseTimestamp = millis();
            Serial.printf("Schedule [%d] Cycle %d complete. Soaking for %d seconds...\n", s.id, s.currentCycle + 1, s.soakDurationSeconds);
          } else {
            s.currentCycle++;
            if (s.currentCycle < s.cycles) {
              triggerScheduleCycle(s);
            } else {
              s.isPulseActive = false;
              Serial.printf("Schedule [%d] complete. Finished all %d cycles.\n", s.id, s.cycles);
            }
          }
        }
      }
    }
  }

  // 2. Match current local clock time to trigger new schedules
  struct tm timeinfo;
  if (getLocalTime(&timeinfo)) {
    int currentHour = timeinfo.tm_hour;
    int currentMinute = timeinfo.tm_min;
    int currentSecond = timeinfo.tm_sec;
    int currentWDay = timeinfo.tm_wday; // 0 = Sunday, 1 = Monday ... 6 = Saturday
    int standardWDay = currentWDay == 0 ? 7 : currentWDay; // 1 = Monday ... 7 = Sunday

    static int lastCheckedMinute = -1;
    // Check once per minute transition
    if (currentMinute != lastCheckedMinute) {
      lastCheckedMinute = currentMinute;
      Serial.printf("Evaluating local offline schedules for time %02d:%02d...\n", currentHour, currentMinute);

      for (int i = 0; i < scheduleCount; i++) {
        LocalSchedule& s = schedules[i];

        // Check if today matches the scheduled weekdays
        bool dayMatches = false;
        for (int d = 0; d < s.dayCount; d++) {
          if (s.daysOfWeek[d] == standardWDay) {
            dayMatches = true;
            break;
          }
        }

        // Check time of day
        if (dayMatches && s.hour == currentHour && s.minute == currentMinute) {
          Serial.printf("Local Schedule [%d] matched! Starting Cycle & Soak...\n", s.id);
          s.currentCycle = 0;
          triggerScheduleCycle(s);
        }
      }
    }
  }
}

// --- Watchdog Safety and Schedule Duration Timer checks ---
void manageWatchdogs() {
  unsigned long now = millis();
  
  for (int i = 0; i < pumpCount; i++) {
    if (pumps[i].state == 1) {
      // 1. Local schedule duration cutoff (rollover-proof)
      if (pumps[i].hasScheduleTimer && (now - pumps[i].turnedOnAt >= pumps[i].scheduleDurationMs)) {
        Serial.printf("Local schedule duration complete: Shutting down Pump [%d]\n", pumps[i].id);
        digitalWrite(pumps[i].pin, RELAY_OFF); // Turn relay OFF
        pumps[i].state = 0;
        pumps[i].hasScheduleTimer = false;
        sendTelemetry();
      }
      // 2. Hardware safety Watchdog fallback timeout
      else {
        unsigned long elapsed = now - pumps[i].turnedOnAt;
        if (elapsed >= (pumpSafetyTimeout * 1000)) {
          Serial.printf("Safety Watchdog Alert: Pump [%d] exceeded maximum continuous run limit! Shutting down.\n", pumps[i].id);
          digitalWrite(pumps[i].pin, RELAY_OFF); // Turn relay OFF
          pumps[i].state = 0;
          pumps[i].hasScheduleTimer = false;
          sendTelemetry();
        }
      }
    }
  }
}

// --- Main Operational Loop ---
void loop() {
  reconnectNonBlocking();
  if (client.connected()) {
    client.loop();
  }

  // Evaluate local offline schedules
  checkLocalSchedules();

  // Enforce watchdogs and scheduled timeouts
  manageWatchdogs();

  // Sends initial telemetry payload once broker connects
  if (forceBootTelemetry && client.connected()) {
    Serial.println("Sending initial start telemetry report...");
    sendTelemetry();
    lastMsg = millis();
    forceBootTelemetry = false;
  }

  // Periodic Telemetry Reporting Loop
  unsigned long now = millis();
  if (now - lastMsg >= telemetryInterval) { 
    lastMsg = now;
    sendTelemetry();
  }
}
