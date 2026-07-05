#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <HTTPClient.h>
#include <time.h>

// --- Configuration & Host Constants ---
// Setup default static connection parameters (updated on boot if dynamic config matches)
const char* ssid     = "DIGI-56KC";
const char* password = "CxuxFeduPx";
const char* mqtt_server = "bcc1fdaf.ala.eu-central-1.emqxsl.com";
const int mqtt_port = 8883;
const char* mqtt_user = "WateringSystem_ESP32";
const char* mqtt_pass = "tdsHU$TkT2UwE9L7S6M&";

// API security token to authenticate the ESP32 with your server
const char* api_access_token = "8a6c03267e3b603d90ddb23c2ae6917102c807eec6d38554";

// The Next.js API server host URL
const char* http_server = "http://192.168.1.135:3000"; // REPLACE with your active Next.js server local IP/domain

// --- Hardware Pins (Dynamic Fallbacks) ---
int pin_trig = 14; // Default trigger pin for water level sensor
int pin_echo = 27; // Default echo pin for water level sensor (can be remapped dynamically)
int pin_dht  = 13; // Default DHT data pin (can be remapped dynamically)

#define DHTTYPE DHT11
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
  unsigned long scheduledOffAt;    // Local schedule duration countdown timer
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
    pumps[i].scheduledOffAt = 0;
    pumps[i].hasScheduleTimer = false;
    
    pinMode(pumps[i].pin, OUTPUT);
    digitalWrite(pumps[i].pin, HIGH); // Set high (Off state for typical active-low relay)
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
  snprintf(configUrl, sizeof(configUrl), "%s/api/device/config", http_server);
  
  Serial.printf("Fetching configurations from: %s\n", configUrl);
  
  // Declaring clients at function scope keeps them alive during http.GET()
  WiFiClientSecure secureClient;
  WiFiClient plainClient;
  
  if (strncmp(http_server, "https", 5) == 0) {
    secureClient.setCACert(ca_cert);
    http.begin(secureClient, configUrl);
  } else {
    http.begin(plainClient, configUrl);
  }
  
  // Send authorization token to proof device identity
  http.addHeader("Authorization", String("Bearer ") + api_access_token);
  
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
            digitalWrite(pumps[pumpCount].pin, pumps[pumpCount].state ? LOW : HIGH);
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
  long duration = pulseIn(pin_echo, HIGH, 30000); 
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
          digitalWrite(pumps[i].pin, state ? LOW : HIGH);
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

// --- Arduino Lifecycle Hook ---
void setup() {
  Serial.begin(115200); // 115200 Baud rate
  delay(2000); 
  Serial.println("\n=== ESP32 Irrigation Node Initialization ===");
  
  // Load local configs
  setupDefaultConfig();
  
  Serial.print("Connecting to WiFi: ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi network active.");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());

  // Dynamic configuration fetch from Next.js server on boot (includes local schedule sync and watchdog setup)
  fetchConfiguration();

  // Configure MQTT
  espClient.setCACert(ca_cert);
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  client.setBufferSize(1024);
}

// --- Reconnection Logic ---
void reconnect() {
  while (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi connection lost. Attempting to reconnect...");
    delay(1000);
  }
  
  while (!client.connected()) {
    Serial.print("Connecting to EMQX TLS server... ");
    if (client.connect("ESP32_Watering_Client", mqtt_user, mqtt_pass)) {
      Serial.println("MQTT Connection established!");
      client.subscribe("device/commands");
      client.subscribe("device/config");
    } else {
      Serial.print("Connection rejected, error rc=");
      Serial.print(client.state());
      Serial.println(". Re-attempting connection in 5 seconds...");
      delay(5000);
    }
  }
}

// --- Helper to trigger a schedule watering cycle ---
void triggerScheduleCycle(LocalSchedule& s) {
  s.isPulseActive = true;
  s.isSoaking = false;
  s.lastPhaseTimestamp = millis();
  
  Serial.printf("Executing Schedule [%d] - Starting Cycle %d/%d\n", s.id, s.currentCycle + 1, s.cycles);
  
  // 1. Direct pump ids trigger (legacy)
  for (int pIdx = 0; pIdx < s.pumpCount; pIdx++) {
    int targetPumpId = s.pumpIds[pIdx];
    for (int p = 0; p < pumpCount; p++) {
      if (pumps[p].id == targetPumpId) {
        digitalWrite(pumps[p].pin, LOW); // ON
        pumps[p].state = 1;
        pumps[p].turnedOnAt = millis();
        pumps[p].scheduledOffAt = millis() + ((unsigned long)s.durationSeconds * 1000);
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
            digitalWrite(pumps[p].pin, LOW); // ON
            pumps[p].state = 1;
            pumps[p].turnedOnAt = millis();
            pumps[p].scheduledOffAt = millis() + ((unsigned long)s.durationSeconds * 1000);
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
    // Check once at the start of a new minute
    if (currentMinute != lastCheckedMinute && currentSecond == 0) {
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
      // 1. Local schedule duration cutoff
      if (pumps[i].hasScheduleTimer && now >= pumps[i].scheduledOffAt) {
        Serial.printf("Local schedule duration complete: Shutting down Pump [%d]\n", pumps[i].id);
        digitalWrite(pumps[i].pin, HIGH); // Turn relay OFF
        pumps[i].state = 0;
        pumps[i].hasScheduleTimer = false;
        sendTelemetry();
      }
      // 2. Hardware safety Watchdog fallback timeout
      else {
        unsigned long elapsed = now - pumps[i].turnedOnAt;
        if (elapsed >= (pumpSafetyTimeout * 1000)) {
          Serial.printf("Safety Watchdog Alert: Pump [%d] exceeded maximum continuous run limit! Shutting down.\n", pumps[i].id);
          digitalWrite(pumps[i].pin, HIGH); // Turn relay OFF
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
  if (!client.connected()) reconnect();
  client.loop();

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
