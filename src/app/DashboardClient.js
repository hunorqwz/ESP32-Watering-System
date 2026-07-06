'use client';
 
import { useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';
import { Cylinder, Thermometer, Droplets, Sprout, RefreshCw, Settings, X, Plus, Trash2, Edit2, Wifi, Clock, CloudSun, Calendar, LogOut, MapPin } from 'lucide-react';
import ActivityLog from '@/components/ActivityLog';
import NotesModal from '@/components/NotesModal';
import { signOut } from 'next-auth/react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart, Bar } from 'recharts';

const PumpIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth="2.2" stroke="currentColor">
    {/* Motor block with cooling fins */}
    <rect x="2" y="8" width="10" height="8" rx="1.5" />
    <path d="M5 8v8M8 8v8" />
    {/* Connection coupler */}
    <path d="M12 11.5h1.5v1H12z" />
    {/* Impeller chamber */}
    <circle cx="17" cy="12" r="3.5" />
    {/* Water outlet (top) */}
    <path d="M17 8.5V4h1.5" />
    {/* Water inlet (bottom) */}
    <path d="M17 15.5V20" />
  </svg>
);
 
export default function Dashboard({ apiToken }) {
  const refreshIntervalRef = useRef(null);
  const [data, setData] = useState({
    sensors: [],
    pumps: [],
    latest_readings: {},
    history_readings: [],
    configs: {},
    commands: [],
    device_status: { active: false, last_seen_seconds: null, interval_minutes: 15 },
    schedules: [],
    weather_forecast: [],
    next_watering: { time: 'None Scheduled', reason: 'No active schedules defined.', skipped: false, details: '' }
  });
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState({
    active: false,
    last_seen_seconds: null,
    interval_minutes: 15
  });
  const [togglingConfig, setTogglingConfig] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pumpsState, setPumpsState] = useState({});
  const [togglingPumps, setTogglingPumps] = useState({});
  const [lastReportTime, setLastReportTime] = useState(null);
 
  // Notes Modal State
  const [isNotesOpen, setIsNotesOpen] = useState(false);
 
  // Configuration Manager Modal States
  const [isConfigOpen, _setIsConfigOpen] = useState(false);
  const isConfigOpenRef = useRef(false);
  const setIsConfigOpen = (val) => {
    _setIsConfigOpen(val);
    isConfigOpenRef.current = val;
  };
  const [configTab, setConfigTab] = useState('network'); // 'network', 'sensors', 'pumps', 'general', 'schedules'
  
  // Refs for focusing inputs from SVG diagram click events
  const heightInputRef = useRef(null);
  const offsetInputRef = useRef(null);
  const widthInputRef = useRef(null);
  const lengthInputRef = useRef(null);
  const volumeInputRef = useRef(null);
  const minVolumeInputRef = useRef(null);
 
  // Forms
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [customInterval, setCustomInterval] = useState(15);
  const [intervalUnit, setIntervalUnit] = useState('minutes');
  const [latitude, setLatitude] = useState(48.137);
  const [longitude, setLongitude] = useState(11.575);
  const [locationName, setLocationName] = useState('');
  const [locationSearchQuery, setLocationSearchQuery] = useState('');
  const [locationResults, setLocationResults] = useState([]);
  const [timezone, setTimezone] = useState('Europe/Bucharest');
  const [moistureSkipThreshold, setMoistureSkipThreshold] = useState(70);
  const [reservoirMinVolume, setReservoirMinVolume] = useState(5.0);
 
  // Reservoir calibration forms
  const [reservoirUseDimensions, setReservoirUseDimensions] = useState(false);
  const [reservoirTotalVolume, setReservoirTotalVolume] = useState(100);
  const [reservoirWidth, setReservoirWidth] = useState(60);
  const [reservoirLength, setReservoirLength] = useState(70);
  const [reservoirHeight, setReservoirHeight] = useState(50);
 
  // Sensor Form
  const [editingSensorId, setEditingSensorId] = useState(null);
  const [sensorName, setSensorName] = useState('');
  const [sensorType, setSensorType] = useState('moisture');
  const [sensorPin, setSensorPin] = useState(32);
  const [sensorPinSecondary, setSensorPinSecondary] = useState('');
  const [sensorDryLimit, setSensorDryLimit] = useState(3400);
  const [sensorWetLimit, setSensorWetLimit] = useState(1100);
  const [sensorPumpId, setSensorPumpId] = useState('');
 
  // Pump Form
  const [editingPumpId, setEditingPumpId] = useState(null);
  const [pumpName, setPumpName] = useState('');
  const [pumpPin, setPumpPin] = useState(25);
  const [pumpFlowRate, setPumpFlowRate] = useState(4.0);
  const [reservoirSensorOffset, setReservoirSensorOffset] = useState(100);
  const [focusedField, setFocusedField] = useState(null);

  // History / Chart States
  const [historyData, setHistoryData] = useState({
    moistureHistory: [],
    waterHistory: [],
    analytics: { totalSkipped: 0, rainSkips: 0, moistureSkips: 0, safeguardSkips: 0 }
  });

  // Watchdog Settings
  const [pumpSafetyTimeout, setPumpSafetyTimeout] = useState(300);
  const [historyRange, setHistoryRange] = useState('7d');
  const [historyLoading, setHistoryLoading] = useState(true);
  const [chartTab, setChartTab] = useState('moisture');

  // Schedule Form State
  const [editingScheduleId, setEditingScheduleId] = useState(null);
  const [schedPumpIds, setSchedPumpIds] = useState([]);
  const [schedFlowIds, setSchedFlowIds] = useState([]);
  const [schedTime, setSchedTime] = useState('07:00');
  const [schedDuration, setSchedDuration] = useState(120);
  const [schedDays, setSchedDays] = useState([1, 2, 3, 4, 5, 6, 7]);
  const [schedEnabled, setSchedEnabled] = useState(true);
  const [schedCycles, setSchedCycles] = useState(1);
  const [schedSoak, setSchedSoak] = useState(0);

  // Flows / Zones Form State
  const [editingFlowId, setEditingFlowId] = useState(null);
  const [flowName, setFlowName] = useState('');
  const [flowPumpId, setFlowPumpId] = useState('');
  const [flowSensorIds, setFlowSensorIds] = useState([]);
 
  // Dynamic UI feedback states
  const [toasts, setToasts] = useState([]);
  const [confirmDialog, setConfirmDialog] = useState(null);

  const showToast = (message, type = 'success') => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const fetchHistoryData = async (range = '7d') => {
    try {
      setHistoryLoading(true);
      const res = await fetch(`/api/dashboard/history?range=${range}`);
      const json = await res.json();
      if (json.success) {
        setHistoryData({
          moistureHistory: json.moistureHistory || [],
          waterHistory: json.waterHistory || [],
          analytics: json.analytics || { totalSkipped: 0, rainSkips: 0, moistureSkips: 0, safeguardSkips: 0 }
        });
      }
    } catch (err) {
      console.error('Failed to fetch history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchHistoryData(historyRange);
  }, [historyRange]);

  const fetchDashboardData = async () => {
    try {
      const res = await fetch('/api/dashboard');
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setData(json);
          setConnected(true);
          
          if (json.device_status) {
            setDeviceStatus(json.device_status);
          }
          if (json.configs && !isConfigOpenRef.current) {
            setWifiSsid(json.configs['wifi_ssid'] || '');
            setWifiPassword(json.configs['wifi_password'] || '');
            setReservoirUseDimensions(json.configs['reservoir_use_dimensions'] === 'true');
            setReservoirTotalVolume(json.configs['reservoir_total_volume_liters'] ? Number(json.configs['reservoir_total_volume_liters']) : 100);
            setReservoirWidth(json.configs['reservoir_width_cm'] ? Number(json.configs['reservoir_width_cm']) : 60);
            setReservoirLength(json.configs['reservoir_length_cm'] ? Number(json.configs['reservoir_length_cm']) : 70);
            setReservoirHeight(json.configs['reservoir_height_cm'] ? Number(json.configs['reservoir_height_cm']) : 50);
            setReservoirSensorOffset(json.configs['reservoir_sensor_offset_cm'] ? Number(json.configs['reservoir_sensor_offset_cm']) : 100);
            setLatitude(json.configs['latitude'] ? Number(json.configs['latitude']) : 48.137);
            setLongitude(json.configs['longitude'] ? Number(json.configs['longitude']) : 11.575);
            setLocationName(json.configs['location_name'] || '');
            setTimezone(json.configs['timezone'] || 'Europe/Bucharest');
            setMoistureSkipThreshold(json.configs['moisture_skip_threshold_percent'] ? parseInt(json.configs['moisture_skip_threshold_percent'], 10) : 70);
            setReservoirMinVolume(json.configs['reservoir_min_volume_liters'] ? parseFloat(json.configs['reservoir_min_volume_liters']) : 5.0);
            setPumpSafetyTimeout(json.configs['pump_safety_timeout_seconds'] ? parseInt(json.configs['pump_safety_timeout_seconds'], 10) : 300);

            // Sync Data Fetch & Sync Interval config inputs
            const intervalMins = json.configs['telemetry_interval_minutes'] ? parseInt(json.configs['telemetry_interval_minutes'], 10) : 15;
            if (intervalMins % 60 === 0 && intervalMins > 0) {
              setCustomInterval(intervalMins / 60);
              setIntervalUnit('hours');
            } else {
              setCustomInterval(intervalMins);
              setIntervalUnit('minutes');
            }
          }

          // Sync last report time from latest reading timestamps
          if (json.latest_readings) {
            let maxTime = null;
            Object.values(json.latest_readings).forEach(r => {
              const t = new Date(r.created_at).getTime();
              if (!maxTime || t > maxTime) maxTime = t;
            });
            if (maxTime) setLastReportTime(maxTime);
          }

          // Sync pump states
          if (json.pumps) {
            const states = {};
            json.pumps.forEach(p => {
              states[p.id] = p.state === 1;
            });
            setPumpsState(states);
          }
        } else {
          setConnected(false);
        }
      } else {
        setConnected(false);
      }
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
      setConnected(false);
    } finally {
      setLoading(false);
    }
  };

  // HTTP Polling with Visibility API
  useEffect(() => {
    fetchDashboardData();

    let interval = null;

    const startPolling = () => {
      if (interval) clearInterval(interval);
      interval = setInterval(() => {
        if (document.visibilityState === 'visible') {
          fetchDashboardData();
        }
      }, 60000);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchDashboardData();
        startPolling();
      } else {
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    startPolling();

    if ('serviceWorker' in navigator) {
      if (process.env.NODE_ENV === 'production') {
        navigator.serviceWorker.register('/sw.js').catch((err) =>
          console.error('Service Worker registration failed:', err)
        );
      } else {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          if (registrations.length > 0) {
            Promise.all(registrations.map(r => r.unregister())).then(() => {
              console.log('Cleared active service workers in development mode.');
            });
          }
        });
      }
    }

    return () => {
      if (interval) clearInterval(interval);
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Locally increment last_seen_seconds every second to keep the connection status updated in real-time
  // without spamming the backend API.
  useEffect(() => {
    const timer = setInterval(() => {
      setDeviceStatus(prev => {
        if (prev.last_seen_seconds === null) return prev;
        const nextSeen = prev.last_seen_seconds + 1;
        const thresholdSeconds = (prev.interval_minutes + 2) * 60;
        return {
          ...prev,
          last_seen_seconds: nextSeen,
          active: nextSeen <= thresholdSeconds
        };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // WebSockets Real-Time Push connection
  useEffect(() => {
    let client = null;
    let active = true;

    const initMqtt = async () => {
      try {
        const res = await fetch('/api/mqtt-auth', {
          headers: {
            'Authorization': `Bearer ${apiToken}`
          }
        });
        if (!res.ok) {
          throw new Error('MQTT credentials not found or not configured.');
        }
        const authData = await res.json();
        if (!authData.success || !authData.username || !authData.password) {
          throw new Error('MQTT credentials payload is incomplete.');
        }

        if (!active) return; // Prevent connecting if component unmounted while fetching

        const brokerUrl = authData.brokerUrl || 'wss://bcc1fdaf.ala.eu-central-1.emqxsl.com:8084/mqtt';
        console.log('Connecting to EMQX broker via WebSockets...');
        client = mqtt.connect(brokerUrl, {
          username: authData.username,
          password: authData.password,
          clientId: 'web_dashboard_' + Math.random().toString(16).slice(2, 10),
          clean: true,
          connectTimeout: 5000,
          reconnectPeriod: 10000
        });

        client.on('connect', () => {
          console.log('Connected to EMQX broker via WebSockets on port 8084.');
          client.subscribe('device/telemetry', (err) => {
            if (!err) console.log('Subscribed to device/telemetry topic.');
          });
          client.subscribe('device/commands', (err) => {
            if (!err) console.log('Subscribed to device/commands topic.');
          });
        });

        client.on('message', (topic, message) => {
          try {
            const payload = JSON.parse(message.toString());
            console.log(`Received message on [${topic}]:`, payload);

            if (topic === 'device/telemetry') {
              // Relational format update
              if (payload.readings) {
                setData(prev => {
                  const updatedReadings = { ...prev.latest_readings };
                  Object.keys(payload.readings).forEach(sensorId => {
                    updatedReadings[sensorId] = {
                      value: payload.readings[sensorId],
                      created_at: payload.created_at
                    };
                  });
                  return { ...prev, latest_readings: updatedReadings };
                });

                const t = new Date(payload.created_at).getTime();
                setLastReportTime(t);
                setDeviceStatus(prev => ({
                  ...prev,
                  last_seen_seconds: 0,
                  active: true
                }));
              }
            } else if (topic === 'device/commands') {
              const { pump, state } = payload;
              if (pump !== undefined && state !== undefined) {
                setPumpsState(prev => ({
                  ...prev,
                  [pump]: state === 1
                }));
              }
            }
          } catch (err) {
            console.error('Error parsing MQTT message:', err);
          }
        });

        client.on('error', (err) => {
          console.error('MQTT connection error:', err);
        });

      } catch (err) {
        console.warn('MQTT WebSockets connection skipped:', err.message);
        console.log('Real-time updates will fallback to HTTP polling.');
      }
    };

    initMqtt();

    return () => {
      active = false;
      if (client) {
        console.log('Disconnecting from MQTT WebSockets client...');
        client.end();
      }
    };
  }, []);

  // Sync intervals
  useEffect(() => {
    const totalMinutes = deviceStatus.interval_minutes || 15;
    if (totalMinutes % 60 === 0) {
      setCustomInterval(totalMinutes / 60);
      setIntervalUnit('hours');
    } else {
      setCustomInterval(totalMinutes);
      setIntervalUnit('minutes');
    }
  }, [deviceStatus.interval_minutes]);

  const getMaxTimestamp = (readings) => {
    if (!readings) return null;
    let maxT = null;
    Object.values(readings).forEach(r => {
      const t = new Date(r.created_at).getTime();
      if (!maxT || t > maxT) maxT = t;
    });
    return maxT;
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }
    
    setRefreshing(true);
    const lastMaxTime = getMaxTimestamp(data.latest_readings);
    showToast('Sending telemetry refresh command to ESP32...', 'info');
    
    try {
      const res = await fetch('/api/refresh', {
        method: 'POST'
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          showToast('Refresh command published successfully. Awaiting data...', 'success');
          let attempts = 0;
          refreshIntervalRef.current = setInterval(async () => {
            attempts++;
            try {
              const dashRes = await fetch('/api/dashboard');
              if (dashRes.ok) {
                const dashJson = await dashRes.json();
                if (dashJson.success) {
                  const newMaxTime = getMaxTimestamp(dashJson.latest_readings);
                  if (newMaxTime !== lastMaxTime) {
                    setData(dashJson);
                    if (refreshIntervalRef.current) {
                      clearInterval(refreshIntervalRef.current);
                      refreshIntervalRef.current = null;
                    }
                    setRefreshing(false);
                    showToast('Telemetry data updated successfully.', 'success');
                    return;
                  }
                }
              }
            } catch (err) {
              console.error('Error polling after refresh:', err);
            }
            
            if (attempts >= 8) {
              if (refreshIntervalRef.current) {
                clearInterval(refreshIntervalRef.current);
                refreshIntervalRef.current = null;
              }
              setRefreshing(false);
              fetchDashboardData();
              showToast('Telemetry refresh timed out. No new data received.', 'warning');
            }
          }, 1000);
        } else {
          console.error('Refresh command rejected:', json.error);
          showToast(json.error || 'Failed to dispatch refresh command.', 'error');
          setRefreshing(false);
        }
      } else {
        showToast('Server rejected the refresh command.', 'error');
        setRefreshing(false);
      }
    } catch (err) {
      console.error('Failed to trigger telemetry refresh:', err);
      showToast('Network error triggering refresh command.', 'error');
      setRefreshing(false);
    }
  };

  const handlePumpToggle = async (pumpId, currentPin) => {
    if (togglingPumps[pumpId]) return;
    
    const nextState = !pumpsState[pumpId];
    setTogglingPumps(prev => ({ ...prev, [pumpId]: true }));
    
    try {
      const res = await fetch('/api/command', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          pump: parseInt(pumpId, 10),
          state: nextState ? 1 : 0
        })
      });
      
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setPumpsState(prev => ({ ...prev, [pumpId]: nextState }));
          showToast(`${data.pumps.find(p => p.id === pumpId)?.name || 'Pump'} turned ${nextState ? 'ON' : 'OFF'}.`, 'success');
          fetchDashboardData();
        } else {
          showToast(json.error || 'Failed to toggle pump.', 'error');
        }
      } else {
        showToast('Server failed to toggle pump.', 'error');
      }
    } catch (err) {
      console.error('Failed to send command:', err);
      showToast('Network error toggling pump.', 'error');
    } finally {
      setTogglingPumps(prev => ({ ...prev, [pumpId]: false }));
    }
  };

  // WiFi Settings Save
  const triggerWifiSave = async () => {
    setTogglingConfig(true);
    try {
      const promises = [
        fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'wifi_ssid', value: wifiSsid })
        })
      ];

      if (wifiPassword !== '••••••••') {
        promises.push(
          fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: 'wifi_password', value: wifiPassword })
          })
        );
      }

      const results = await Promise.all(promises);
      const jsonResults = await Promise.all(results.map(r => r.json().catch(() => ({ success: false }))));
      const allSuccess = jsonResults.every(r => r.success);

      if (allSuccess) {
        if (deviceStatus.active) {
          showToast('WiFi settings updated successfully.', 'success');
        } else {
          showToast('WiFi settings saved, but the device is offline. They will apply once it reconnects.', 'warning');
        }
        await fetchDashboardData();
      } else {
        showToast('Failed to save some WiFi configuration parameters.', 'error');
      }
    } catch (err) {
      console.error('Failed to save WiFi settings:', err);
      showToast('Error communicating with the configuration server.', 'error');
    } finally {
      setTogglingConfig(false);
    }
  };

  const handleWifiSave = () => {
    setConfirmDialog({
      title: 'Update WiFi Settings?',
      message: 'Warning: Changing the SSID or Password will apply to the ESP32. If they are incorrect, the ESP32 will permanently lose connectivity on its next check-in. Are you sure you want to apply these settings?',
      confirmLabel: 'Save and Apply',
      type: 'warning',
      onConfirm: triggerWifiSave
    });
  };

  // Telemetry Interval Save
  const triggerCustomIntervalSave = async (totalMinutes) => {
    setTogglingConfig(true);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'telemetry_interval_minutes', value: String(totalMinutes) })
      });
      
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setDeviceStatus(prev => ({ ...prev, interval_minutes: totalMinutes }));
          if (deviceStatus.active) {
            showToast(`Telemetry update rate set to ${customInterval} ${intervalUnit}.`, 'success');
          } else {
            showToast(`Telemetry rate saved, but the device is offline. It will sync once it reconnects.`, 'warning');
          }
          await fetchDashboardData();
        } else {
          showToast(json.error || 'Failed to update telemetry rate.', 'error');
        }
      } else {
        showToast('Server rejected configuration change.', 'error');
      }
    } catch (err) {
      console.error('Failed to save telemetry rate:', err);
      showToast('Network error updating telemetry rate.', 'error');
    } finally {
      setTogglingConfig(false);
    }
  };

  const handleCustomIntervalSave = () => {
    const minutes = parseInt(customInterval, 10);
    if (isNaN(minutes) || minutes < 1) {
      showToast('Please enter a valid interval duration.', 'error');
      return;
    }
    const multiplier = intervalUnit === 'hours' ? 60 : 1;
    const totalMinutes = minutes * multiplier;

    setConfirmDialog({
      title: 'Update Data Fetch & Sync Interval?',
      message: `Are you sure you want to change the device's data fetch & sync interval to ${customInterval} ${intervalUnit} (${totalMinutes} minutes)? The next device sync will pull this configuration.`,
      confirmLabel: 'Update Interval',
      type: 'info',
      onConfirm: () => triggerCustomIntervalSave(totalMinutes)
    });
  };

  const handleLocationSearch = async () => {
    if (!locationSearchQuery.trim()) {
      showToast('Please enter a location name to search.', 'error');
      return;
    }
    setTogglingConfig(true);
    try {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(locationSearchQuery)}&count=5&language=en&format=json`);
      if (res.ok) {
        const json = await res.json();
        if (json.results && json.results.length > 0) {
          setLocationResults(json.results);
        } else {
          showToast('No matching locations found.', 'error');
          setLocationResults([]);
        }
      } else {
        showToast('Failed to connect to geocoding API.', 'error');
      }
    } catch (err) {
      console.error('Failed to search location:', err);
      showToast('Network error searching for location.', 'error');
    } finally {
      setTogglingConfig(false);
    }
  };

  const handleLocationSelect = async (loc) => {
    const latStr = String(loc.latitude);
    const lngStr = String(loc.longitude);
    const nameStr = `${loc.name}${loc.admin1 ? ', ' + loc.admin1 : ''}, ${loc.country}`;

    setTogglingConfig(true);
    try {
      const resLat = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'latitude', value: latStr })
      });
      const resLng = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'longitude', value: lngStr })
      });
      const resName = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'location_name', value: nameStr })
      });

      if (resLat.ok && resLng.ok && resName.ok) {
        setLatitude(loc.latitude);
        setLongitude(loc.longitude);
        setLocationName(nameStr);
        setLocationResults([]);
        setLocationSearchQuery('');
        showToast(`Location updated to ${loc.name}, ${loc.country}.`, 'success');
        await fetchDashboardData();
      } else {
        showToast('Failed to save selected location settings.', 'error');
      }
    } catch (err) {
      console.error('Failed to save selected location:', err);
      showToast('Network error saving selected location.', 'error');
    } finally {
      setTogglingConfig(false);
    }
  };

  const handleClearActivityLog = async () => {
    setConfirmDialog({
      title: 'Clear System Activity Log?',
      message: 'Are you sure you want to delete all historical pump activation logs? This action is permanent.',
      confirmLabel: 'Clear Log',
      type: 'danger',
      onConfirm: async () => {
        try {
          const res = await fetch('/api/command', { method: 'DELETE' });
          if (res.ok) {
            const json = await res.json();
            if (json.success) {
              showToast('System activity log cleared successfully.', 'success');
              await fetchDashboardData();
            } else {
              showToast(json.error || 'Failed to clear activity log.', 'error');
            }
          } else {
            showToast('Server rejected clear request.', 'error');
          }
        } catch (err) {
          console.error('Failed to clear activity log:', err);
          showToast('Network error clearing activity log.', 'error');
        }
      }
    });
  };

  const handleTimezoneSave = async () => {
    setTogglingConfig(true);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'timezone', value: timezone })
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          if (deviceStatus.active) {
            showToast(`System timezone updated to ${timezone}.`, 'success');
          } else {
            showToast(`Timezone saved, but the device is offline. It will sync once it reconnects.`, 'warning');
          }
          await fetchDashboardData();
        } else {
          showToast(json.error || 'Failed to update timezone.', 'error');
        }
      } else {
        showToast('Server rejected timezone configuration update.', 'error');
      }
    } catch (err) {
      console.error('Failed to save timezone:', err);
      showToast('Network error updating timezone.', 'error');
    } finally {
      setTogglingConfig(false);
    }
  };

  const handleMoistureSkipSave = async () => {
    setTogglingConfig(true);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'moisture_skip_threshold_percent', value: String(moistureSkipThreshold) })
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          const skipLabel = moistureSkipThreshold === 100 ? 'Disabled' : moistureSkipThreshold + '%';
          if (deviceStatus.active) {
            showToast(`Moisture skip threshold updated to ${skipLabel}.`, 'success');
          } else {
            showToast(`Moisture skip threshold saved, but the device is offline. It will sync once it reconnects.`, 'warning');
          }
          await fetchDashboardData();
        } else {
          showToast(json.error || 'Failed to update threshold.', 'error');
        }
      } else {
        showToast('Server rejected threshold configuration update.', 'error');
      }
    } catch (err) {
      console.error('Failed to save moisture skip threshold:', err);
      showToast('Network error updating moisture skip threshold.', 'error');
    } finally {
      setTogglingConfig(false);
    }
  };

  const handlePumpSafetyTimeoutSave = async () => {
    if (isNaN(pumpSafetyTimeout) || pumpSafetyTimeout <= 0) {
      showToast('Pump safety timeout must be a positive integer.', 'error');
      return;
    }
    setTogglingConfig(true);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'pump_safety_timeout_seconds', value: String(pumpSafetyTimeout) })
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          if (deviceStatus.active) {
            showToast(`Pump safety timeout updated to ${pumpSafetyTimeout} seconds.`, 'success');
          } else {
            showToast(`Pump safety timeout saved, but the device is offline. It will sync once it reconnects.`, 'warning');
          }
          await fetchDashboardData();
        } else {
          showToast(json.error || 'Failed to update safety timeout.', 'error');
        }
      } else {
        showToast('Server rejected safety timeout configuration update.', 'error');
      }
    } catch (err) {
      console.error('Failed to save pump safety timeout:', err);
      showToast('Network error updating pump safety timeout.', 'error');
    } finally {
      setTogglingConfig(false);
    }
  };

  const handleReservoirSave = async () => {
    if (isNaN(reservoirHeight) || reservoirHeight <= 0) {
      showToast('Please enter a valid positive number for tank height.', 'error');
      return;
    }
    if (isNaN(reservoirSensorOffset) || reservoirSensorOffset <= 0) {
      showToast('Please enter a valid positive number for sensor mounting offset.', 'error');
      return;
    }

    if (reservoirUseDimensions) {
      if (isNaN(reservoirWidth) || reservoirWidth <= 0) {
        showToast('Please enter a valid positive number for tank width.', 'error');
        return;
      }
      if (isNaN(reservoirLength) || reservoirLength <= 0) {
        showToast('Please enter a valid positive number for tank length.', 'error');
        return;
      }
    } else {
      if (isNaN(reservoirTotalVolume) || reservoirTotalVolume <= 0) {
        showToast('Please enter a valid positive number for total volume.', 'error');
        return;
      }
    }
    if (isNaN(reservoirMinVolume) || reservoirMinVolume < 0) {
      showToast('Please enter a valid positive number for safety minimum volume.', 'error');
      return;
    }
    setTogglingConfig(true);
    try {
      const results = await Promise.all([
        fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'reservoir_use_dimensions', value: String(reservoirUseDimensions) })
        }),
        fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'reservoir_min_volume_liters', value: String(reservoirMinVolume) })
        }),
        fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'reservoir_total_volume_liters', value: String(reservoirTotalVolume) })
        }),
        fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'reservoir_width_cm', value: String(reservoirWidth) })
        }),
        fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'reservoir_length_cm', value: String(reservoirLength) })
        }),
        fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'reservoir_height_cm', value: String(reservoirHeight) })
        }),
        fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'reservoir_sensor_offset_cm', value: String(reservoirSensorOffset) })
        })
      ]);

      const jsonResults = await Promise.all(results.map(r => r.json().catch(() => ({ success: false }))));
      const allSuccess = jsonResults.every(r => r.success);

      if (allSuccess) {
        if (deviceStatus.active) {
          showToast('Reservoir configurations updated successfully.', 'success');
        } else {
          showToast('Reservoir configurations saved, but the device is offline. They will sync once it reconnects.', 'warning');
        }
        await fetchDashboardData();
      } else {
        showToast('Failed to save some reservoir config parameters.', 'error');
      }
    } catch (err) {
      console.error('Failed to save reservoir settings:', err);
      showToast('Error communicating with the configuration server.', 'error');
    } finally {
      setTogglingConfig(false);
    }
  };

  // Sensor Add/Edit Save
  const handleSensorSave = async (force = false) => {
    const actualForce = typeof force === 'boolean' ? force : false;

    if (!sensorName || !sensorType || sensorPin === undefined) {
      showToast('Please fill in all required sensor configuration fields.', 'error');
      return;
    }
    
    try {
      const res = await fetch('/api/sensor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingSensorId,
          name: sensorName,
          type: sensorType,
          pin: parseInt(sensorPin, 10),
          pin_secondary: sensorType === 'water_level' && sensorPinSecondary !== '' ? parseInt(sensorPinSecondary, 10) : null,
          dry_limit: sensorType === 'moisture' || sensorType === 'water_level' ? parseInt(sensorDryLimit, 10) : null,
          wet_limit: sensorType === 'moisture' || sensorType === 'water_level' ? parseInt(sensorWetLimit, 10) : null,
          pump_id: sensorPumpId !== '' ? parseInt(sensorPumpId, 10) : null,
          force: actualForce
        })
      });
      const json = await res.json().catch(() => ({ success: false, error: 'Malformed response from server.' }));

      if (res.ok || json.needsForce) {
        if (json.success) {
          showToast(editingSensorId ? 'Sensor updated successfully.' : 'New sensor added successfully.', 'success');
          setEditingSensorId(null);
          setSensorName('');
          setSensorPin(32);
          setSensorPinSecondary('');
          setSensorPumpId('');
          await fetchDashboardData();
        } else if (json.needsForce) {
          setConfirmDialog({
            title: 'Confirm Shared Pin Mapping',
            message: json.warning || 'A sensor already maps to this pin. Are you sure you want to share this pin mapping?',
            confirmLabel: 'Proceed Anyway',
            type: 'warning',
            onConfirm: () => handleSensorSave(true)
          });
        } else {
          showToast(json.error || 'Failed to save sensor configuration.', 'error');
        }
      } else {
        showToast(json.error || 'Server failed to save sensor.', 'error');
      }
    } catch (err) {
      console.error('Failed to save sensor:', err);
      showToast('Network error saving sensor.', 'error');
    }
  };

  const triggerSensorDelete = async (sensorId) => {
    try {
      const res = await fetch(`/api/sensor?id=${sensorId}`, { method: 'DELETE' });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          showToast('Sensor configuration deleted successfully.', 'success');
          await fetchDashboardData();
        } else {
          showToast(json.error || 'Failed to delete sensor.', 'error');
        }
      } else {
        showToast('Server failed to delete sensor config.', 'error');
      }
    } catch (err) {
      console.error('Failed to delete sensor:', err);
      showToast('Network error deleting sensor.', 'error');
    }
  };

  const handleSensorDelete = (sensorId) => {
    const sensor = data.sensors?.find(s => s.id === sensorId);
    setConfirmDialog({
      title: 'Delete Sensor Configuration?',
      message: `Are you sure you want to delete the sensor "${sensor?.name || 'this sensor'}"? All of its database log history will be permanently deleted. This action is irreversible.`,
      confirmLabel: 'Delete Sensor',
      type: 'danger',
      onConfirm: () => triggerSensorDelete(sensorId)
    });
  };

  // Pump Add/Edit Save
  const handlePumpSave = async () => {
    if (!pumpName || pumpPin === undefined) {
      showToast('Please fill in all required pump configuration fields.', 'error');
      return;
    }
    try {
      const res = await fetch('/api/pump', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingPumpId,
          name: pumpName,
          pin: parseInt(pumpPin, 10),
          flow_rate_lpm: parseFloat(pumpFlowRate)
        })
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          showToast(editingPumpId ? 'Pump updated successfully.' : 'New pump added successfully.', 'success');
          setEditingPumpId(null);
          setPumpName('');
          setPumpPin(25);
          setPumpFlowRate(4.0);
          await fetchDashboardData();
        } else {
          showToast(json.error || 'Failed to save pump configuration.', 'error');
        }
      } else {
        showToast('Server failed to save pump.', 'error');
      }
    } catch (err) {
      console.error('Failed to save pump:', err);
      showToast('Network error saving pump.', 'error');
    }
  };

  const triggerPumpDelete = async (pumpId) => {
    try {
      const res = await fetch(`/api/pump?id=${pumpId}`, { method: 'DELETE' });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          showToast('Pump configuration deleted successfully.', 'success');
          await fetchDashboardData();
        } else {
          showToast(json.error || 'Failed to delete pump.', 'error');
        }
      } else {
        showToast('Server failed to delete pump config.', 'error');
      }
    } catch (err) {
      console.error('Failed to delete pump:', err);
      showToast('Network error deleting pump.', 'error');
    }
  };

  const handlePumpDelete = (pumpId) => {
    const pump = data.pumps?.find(p => p.id === pumpId);
    setConfirmDialog({
      title: 'Delete Pump Configuration?',
      message: `Are you sure you want to delete the pump "${pump?.name || 'this pump'}"? Dynamic outputs mapped to pin ${pump?.pin || 'its pin'} will be deleted. Past command logs will be retained.`,
      confirmLabel: 'Delete Pump',
      type: 'danger',
      onConfirm: () => triggerPumpDelete(pumpId)
    });
  };

  // Flows Add/Edit/Save/Delete
  const handleFlowSave = async () => {
    if (!flowName.trim() || !flowPumpId || flowSensorIds.length === 0) {
      showToast('Please provide a name, select a pump, and check at least one moisture sensor.', 'error');
      return;
    }

    try {
      const res = await fetch('/api/flow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingFlowId,
          name: flowName,
          pump_id: parseInt(flowPumpId, 10),
          sensor_ids: flowSensorIds
        })
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          showToast(editingFlowId ? 'Flow zone updated successfully.' : 'New flow zone created successfully.', 'success');
          setEditingFlowId(null);
          setFlowName('');
          setFlowPumpId('');
          setFlowSensorIds([]);
          await fetchDashboardData();
        } else {
          showToast(json.error || 'Failed to save flow zone.', 'error');
        }
      } else {
        showToast('Server failed to save flow zone.', 'error');
      }
    } catch (err) {
      console.error('Failed to save flow zone:', err);
      showToast('Network error saving flow zone.', 'error');
    }
  };

  const triggerFlowDelete = async (flowId) => {
    try {
      const res = await fetch(`/api/flow?id=${flowId}`, { method: 'DELETE' });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          showToast('Flow zone deleted successfully.', 'success');
          await fetchDashboardData();
        } else {
          showToast(json.error || 'Failed to delete flow zone.', 'error');
        }
      } else {
        showToast('Server failed to delete flow zone.', 'error');
      }
    } catch (err) {
      console.error('Failed to delete flow zone:', err);
      showToast('Network error deleting flow zone.', 'error');
    }
  };

  const handleFlowDelete = (flowId) => {
    const flow = data.flows?.find(f => f.id === flowId);
    setConfirmDialog({
      title: 'Delete Flow Zone?',
      message: `Are you sure you want to permanently delete the flow zone "${flow?.name || 'this flow'}"? Scheduling rules targeting this flow will remain but need re-mapping.`,
      confirmLabel: 'Delete Flow',
      type: 'danger',
      onConfirm: () => triggerFlowDelete(flowId)
    });
  };

  // Schedule Add/Edit/Save
  const handleScheduleSave = async () => {
    if (schedFlowIds.length === 0 && schedPumpIds.length === 0) {
      showToast('Please select at least one Watering Flow or Pump target.', 'error');
      return;
    }
    if (!schedTime || !schedDuration || schedDays.length === 0) {
      showToast('Please select a time, duration, and at least one day.', 'error');
      return;
    }

    try {
      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingScheduleId,
          pump_ids: schedPumpIds.length > 0 ? schedPumpIds : null,
          flow_ids: schedFlowIds.length > 0 ? schedFlowIds : null,
          time_of_day: schedTime,
          duration_seconds: parseInt(schedDuration, 10),
          days_of_week: schedDays,
          enabled: schedEnabled,
          cycles: parseInt(schedCycles, 10) || 1,
          soak_duration_seconds: parseInt(schedSoak, 10) || 0
        })
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          showToast(editingScheduleId ? 'Schedule updated successfully.' : 'New schedule added successfully.', 'success');
          setEditingScheduleId(null);
          setSchedPumpIds([]);
          setSchedFlowIds([]);
          setSchedTime('07:00');
          setSchedDuration(120);
          setSchedDays([1, 2, 3, 4, 5, 6, 7]);
          setSchedEnabled(true);
          setSchedCycles(1);
          setSchedSoak(0);
          await fetchDashboardData();
        } else {
          showToast(json.error || 'Failed to save schedule.', 'error');
        }
      } else {
        showToast('Server failed to save schedule.', 'error');
      }
    } catch (err) {
      console.error('Failed to save schedule:', err);
      showToast('Network error saving schedule.', 'error');
    }
  };

  const triggerScheduleDelete = async (scheduleId) => {
    try {
      const res = await fetch(`/api/schedule?id=${scheduleId}`, { method: 'DELETE' });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          showToast('Schedule deleted successfully.', 'success');
          await fetchDashboardData();
        } else {
          showToast(json.error || 'Failed to delete schedule.', 'error');
        }
      } else {
        showToast('Server failed to delete schedule config.', 'error');
      }
    } catch (err) {
      console.error('Failed to delete schedule:', err);
      showToast('Network error deleting schedule.', 'error');
    }
  };

  const handleScheduleDelete = (scheduleId) => {
    setConfirmDialog({
      title: 'Delete Watering Schedule?',
      message: 'Are you sure you want to permanently delete this scheduled watering event? This action cannot be undone.',
      confirmLabel: 'Delete Schedule',
      type: 'danger',
      onConfirm: () => triggerScheduleDelete(scheduleId)
    });
  };

  const renderLastSeenText = () => {
    const elapsed = deviceStatus.last_seen_seconds;
    if (elapsed === null) return 'Never seen';
    if (elapsed < 60) return 'Just now';
    if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`;
    return `${Math.floor(elapsed / 3600)}h ago`;
  };

  const mapMoistureToPercentage = (rawValue, dryLimit, wetLimit) => {
    if (rawValue === undefined || rawValue === null) return 0;
    const dry = dryLimit !== undefined && dryLimit !== null ? dryLimit : 3400;
    const wet = wetLimit !== undefined && wetLimit !== null ? wetLimit : 1100;
    if (dry === wet) return 0;
    
    if (dry > wet) {
      if (rawValue >= dry) return 0;
      if (rawValue <= wet) return 100;
      return Math.round(((dry - rawValue) / (dry - wet)) * 100);
    } else {
      if (rawValue <= dry) return 0;
      if (rawValue >= wet) return 100;
      return Math.round(((rawValue - dry) / (wet - dry)) * 100);
    }
  };

  const getReservoirStats = (rawDistance) => {
    const waterSensor = data.sensors?.find(s => s.type === 'water_level');
    const emptyDist = data.configs['reservoir_sensor_offset_cm']
      ? parseFloat(data.configs['reservoir_sensor_offset_cm'])
      : (waterSensor?.dry_limit || 100);
    const heightCm = data.configs['reservoir_height_cm']
      ? parseFloat(data.configs['reservoir_height_cm'])
      : 50;

    const useDimensions = data.configs['reservoir_use_dimensions'] === 'true';
    const totalVolume = data.configs['reservoir_total_volume_liters'] ? parseFloat(data.configs['reservoir_total_volume_liters']) : 100;
    const width = data.configs['reservoir_width_cm'] ? parseFloat(data.configs['reservoir_width_cm']) : 60;
    const length = data.configs['reservoir_length_cm'] ? parseFloat(data.configs['reservoir_length_cm']) : 70;

    const calculatedCapacity = Math.round((width * length * heightCm) / 100) / 10;
    const capacity = useDimensions ? calculatedCapacity : totalVolume;

    if (rawDistance === undefined || rawDistance === null) {
      return { percentage: 0, liters: 0, height: 0, capacity };
    }

    // Water level height from bottom of tank = sensor mounting offset minus raw sensor distance
    let waterHeight = emptyDist - rawDistance;
    if (waterHeight < 0) waterHeight = 0;
    if (waterHeight > heightCm) waterHeight = heightCm;

    const percentage = Math.min(100, Math.max(0, Math.round((waterHeight / heightCm) * 100)));
    const liters = useDimensions
      ? Math.round((width * length * waterHeight) / 100) / 10
      : Math.round((totalVolume * (percentage / 100)) * 10) / 10;

    return {
      percentage,
      liters,
      height: Math.round(waterHeight * 10) / 10,
      capacity
    };
  };

  const getMoistureStatus = (pct) => {
    if (pct < 30) return { label: 'Dry', color: 'text-red-500 font-semibold' };
    if (pct <= 70) return { label: 'Good', color: 'text-emerald-600 font-semibold' };
    return { label: 'Wet', color: 'text-blue-600 font-semibold' };
  };

  const getProgressBarColorClass = (pct) => {
    if (pct < 30) return 'bg-red-500';
    if (pct <= 70) return 'bg-emerald-500';
    return 'bg-blue-500';
  };

  const tempSensor = data.sensors?.find(s => s.type === 'temperature');
  const tempReading = tempSensor ? data.latest_readings?.[tempSensor.id]?.value : null;

  const humSensor = data.sensors?.find(s => s.type === 'humidity');
  const humReading = humSensor ? data.latest_readings?.[humSensor.id]?.value : null;

  const waterSensor = data.sensors?.find(s => s.type === 'water_level');
  const waterReading = waterSensor ? data.latest_readings?.[waterSensor.id]?.value : null;
  const resStats = getReservoirStats(waterReading);

  const moistureSensors = data.sensors?.filter(s => s.type === 'moisture') || [];
  const isStale = !connected || !deviceStatus.active;
  const isLowWater = waterReading !== null && resStats && resStats.liters < reservoirMinVolume;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex justify-between items-center border-b border-zinc-200 pb-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Terrace System</h1>
            <p className="text-xs text-zinc-500">Relational & Dynamic Custom IoT Panel</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="flex items-center justify-end gap-1.5">
                <span className={`w-2 h-2 rounded-full ${connected && deviceStatus.active ? 'bg-green-500' : 'bg-zinc-300 animate-pulse'}`}></span>
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                  {!connected ? 'Syncing' : deviceStatus.active ? 'ESP32 Active' : 'ESP32 Offline'}
                </span>
              </div>
              <span className="text-[10px] text-zinc-400 font-medium block mt-0.5">
                Last Report: {renderLastSeenText()}
              </span>
            </div>

            <button
              onClick={handleRefresh}
              disabled={refreshing || !connected}
              className="flex items-center gap-1.5 bg-white border border-zinc-200 hover:border-zinc-300 text-zinc-700 hover:text-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed transition px-3 py-1.5 text-xs font-semibold rounded-lg shadow-sm active:scale-95 disabled:active:scale-100 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} strokeWidth={2.2} />
              <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
          </div>
        </header>

        {isLowWater && (
          <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl flex items-center gap-3 shadow-sm animate-in slide-in-from-top-4 duration-300">
            <svg className="w-5 h-5 text-red-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2.2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-bold uppercase tracking-wider text-red-900">Reservoir Safeguard Lockout Active</h4>
              <p className="text-[10px] text-red-700 mt-0.5 font-medium">
                The reservoir volume ({resStats.liters}L) is below the minimum safety threshold ({reservoirMinVolume}L). Pumps have been locked out to prevent dry-running. Please refill the reservoir.
              </p>
            </div>
          </div>
        )}

        {/* Top Tier: Summary metrics (Reservoir Level, Temp, Humidity) */}
        <div className={`grid grid-cols-1 sm:grid-cols-3 gap-4 transition-opacity duration-300 ${isStale ? 'opacity-60' : ''}`}>
          
          {/* Reservoir Level */}
          <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-2 relative overflow-hidden flex flex-col justify-between">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold block">Reservoir Level</span>
                {loading || !waterSensor || waterReading === null ? (
                  <div className="h-8 w-24 text-xs text-zinc-400 mt-1 italic">No active water level sensor</div>
                ) : (
                  <div className="text-2xl font-bold tracking-tight text-zinc-900 mt-1">
                    {resStats.percentage}%
                  </div>
                )}
              </div>
              <Cylinder className={`w-6 h-6 ${resStats.percentage < 20 ? 'text-red-500 animate-pulse' : 'text-zinc-400'}`} />
            </div>
            
            {waterSensor && waterReading !== null && (
              <div className="text-[10px] text-zinc-500 font-medium flex justify-between items-center w-full mt-1">
                <span>{resStats.liters}L / {resStats.capacity}L</span>
                <span className="text-zinc-300">|</span>
                <span>{resStats.height} cm height</span>
              </div>
            )}
            {waterSensor && resStats.percentage < 20 && (
              <span className="text-[9px] text-red-500 font-semibold block animate-pulse">Low Water Alert</span>
            )}
          </div>

          {/* Temp */}
          <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-1 relative overflow-hidden">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold block">Temperature</span>
                {loading || !tempSensor || tempReading === null ? (
                  <div className="h-8 w-24 text-xs text-zinc-400 mt-1 italic">No temperature sensor</div>
                ) : (
                  <div className="text-2xl font-bold tracking-tight text-zinc-900 mt-1">{Number(tempReading).toFixed(1)}°C</div>
                )}
              </div>
              <Thermometer className="w-6 h-6 text-zinc-400" />
            </div>
          </div>

          {/* Humidity */}
          <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-1 relative overflow-hidden">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold block">Humidity</span>
                {loading || !humSensor || humReading === null ? (
                  <div className="h-8 w-24 text-xs text-zinc-400 mt-1 italic">No humidity sensor</div>
                ) : (
                  <div className="text-2xl font-bold tracking-tight text-zinc-900 mt-1">{Number(humReading).toFixed(1)}%</div>
                )}
              </div>
              <Droplets className="w-6 h-6 text-zinc-400" />
            </div>
          </div>
        </div>

        {/* Next Watering & Weather Forecast Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          
          {/* Next Watering Prediction Card */}
          <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-4 flex flex-col justify-between">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold block">Next Watering Run</span>
                <div className="text-lg font-bold tracking-tight text-zinc-900 mt-1 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-zinc-400" />
                  <span>{data.next_watering?.time || 'None Scheduled'}</span>
                </div>
              </div>
              <span className={`px-2 py-0.5 text-[9px] uppercase tracking-wider font-bold rounded-full ${
                data.next_watering?.skipped 
                  ? 'bg-amber-50 text-amber-600 border border-amber-200' 
                  : data.next_watering?.timestamp 
                    ? 'bg-blue-50 text-blue-600 border border-blue-200'
                    : 'bg-zinc-50 text-zinc-400 border border-zinc-200'
              }`}>
                {data.next_watering?.skipped ? 'Rain Skip Active' : data.next_watering?.timestamp ? 'Scheduled' : 'Inactive'}
              </span>
            </div>
            
            <div className="space-y-1 text-xs">
              <p className="text-zinc-600 font-medium">{data.next_watering?.reason}</p>
              {data.next_watering?.details && (
                <p className="text-[10px] text-zinc-400 font-mono">{data.next_watering.details}</p>
              )}
            </div>
          </div>

          {/* Weather Forecast Card */}
          <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-3">
            <div className="flex justify-between items-center border-b border-zinc-100 pb-2">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
                Weather Forecast {data.configs?.['location_name'] ? `(${data.configs['location_name'].split(',')[0].trim()})` : ''}
              </span>
              <CloudSun className="w-4 h-4 text-zinc-400" />
            </div>
            
            {data.weather_forecast && data.weather_forecast.length === 0 ? (
              <div className="text-center py-4 text-xs text-zinc-400 italic">No weather forecast available.</div>
            ) : (
              <div className="grid grid-cols-5 gap-1.5 text-center">
                {data.weather_forecast?.slice(0, 5).map((w, index) => {
                  const daysShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                  const wDate = new Date(w.forecast_date);
                  const dayName = index === 0 ? 'Today' : index === 1 ? 'Tom' : daysShort[wDate.getDay()];
                  
                  const showRainAlert = w.precipitation_probability > 0.5 && w.expected_precipitation_mm >= 2.0;

                  return (
                    <div key={w.forecast_date} className={`p-1.5 rounded-lg border transition ${
                      showRainAlert 
                        ? 'bg-blue-50/50 border-blue-100 text-blue-900' 
                        : 'border-zinc-50 text-zinc-800'
                    }`}>
                      <span className="text-[8px] font-bold uppercase tracking-wider block text-zinc-400">{dayName}</span>
                      <span className="text-xs font-extrabold block mt-0.5">{Math.round(w.temp_c)}°C</span>
                      <span className="text-[8px] block font-mono text-zinc-500 mt-0.5 truncate" title={w.description}>
                        {w.description}
                      </span>
                      {w.precipitation_probability > 0 && (
                        <span className={`text-[8px] font-bold block mt-0.5 ${showRainAlert ? 'text-blue-600' : 'text-zinc-400'}`}>
                          {Math.round(w.precipitation_probability * 100)}% ({w.expected_precipitation_mm}mm)
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
 
        </div>

        {/* Charts & Historical Analytics */}
        <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 border-b border-zinc-100 pb-3">
            <div>
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold block">Historical Telemetry & Water Usage</span>
              <h2 className="text-sm font-bold text-zinc-900 mt-0.5">System Analytics</h2>
            </div>
            
            <div className="flex items-center gap-2 text-xs">
              {/* Range Selector */}
              <div className="flex bg-zinc-100 p-0.5 rounded-lg border border-zinc-200">
                {['24h', '7d', '30d'].map((r) => (
                  <button
                    key={r}
                    onClick={() => {
                      setHistoryRange(r);
                    }}
                    className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded-md transition ${
                      historyRange === r
                        ? 'bg-white text-zinc-800 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-800'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>

              {/* Chart Type Toggle */}
              <div className="flex bg-zinc-100 p-0.5 rounded-lg border border-zinc-200">
                {['moisture', 'water'].map((type) => (
                  <button
                    key={type}
                    onClick={() => setChartTab(type)}
                    className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded-md transition ${
                      chartTab === type
                        ? 'bg-white text-zinc-800 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-800'
                    }`}
                  >
                    {type === 'moisture' ? 'Moisture' : 'Water Usage'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {historyLoading ? (
            <div className="h-64 flex flex-col items-center justify-center text-xs text-zinc-400 space-y-2">
              <RefreshCw className="w-5 h-5 animate-spin" />
              <span>Loading historical telemetry...</span>
            </div>
          ) : chartTab === 'moisture' ? (
            <div className="h-64 w-full text-xs">
              {historyData.moistureHistory.length === 0 ? (
                <div className="h-full flex items-center justify-center text-zinc-400 italic">
                  No historical moisture readings found in this range.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={historyData.moistureHistory} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                    <XAxis dataKey="time" stroke="#71717a" fontSize={9} tickLine={false} />
                    <YAxis domain={[0, 100]} stroke="#71717a" fontSize={9} tickLine={false} label={{ value: 'Moisture %', angle: -90, position: 'insideLeft', offset: 10, fill: '#71717a', fontSize: 9 }} />
                    <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #e4e4e7', borderRadius: '8px', fontSize: '10px', color: '#09090b' }} />
                    <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: '10px', marginTop: '10px' }} />
                    {Object.keys(historyData.moistureHistory[0] || {})
                      .filter((key) => key !== 'time')
                      .map((sensorName, idx) => {
                        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
                        const strokeColor = colors[idx % colors.length];
                        return (
                          <Line
                            key={sensorName}
                            type="monotone"
                            dataKey={sensorName}
                            stroke={strokeColor}
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4 }}
                          />
                        );
                      })}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          ) : (
            <div className="h-64 w-full text-xs">
              {historyData.waterHistory.length === 0 ? (
                <div className="h-full flex items-center justify-center text-zinc-400 italic">
                  No irrigation consumption data recorded in this range.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={historyData.waterHistory} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                    <XAxis dataKey="date" stroke="#71717a" fontSize={9} tickLine={false} />
                    <YAxis stroke="#71717a" fontSize={9} tickLine={false} label={{ value: 'Liters (L)', angle: -90, position: 'insideLeft', offset: 10, fill: '#71717a', fontSize: 9 }} />
                    <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #e4e4e7', borderRadius: '8px', fontSize: '10px', color: '#09090b' }} />
                    <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: '10px', marginTop: '10px' }} />
                    {Object.keys(historyData.waterHistory[0] || {})
                      .filter((key) => key !== 'date')
                      .map((pumpName, idx) => {
                        const colors = ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#f472b6'];
                        const fillCol = colors[idx % colors.length];
                        return (
                          <Bar
                            key={pumpName}
                            dataKey={pumpName}
                            fill={fillCol}
                            radius={[4, 4, 0, 0]}
                            stackId="a"
                          />
                        );
                      })}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          )}

          {/* Quick Metrics Analytics Footer */}
          {!historyLoading && (
            <div className="grid grid-cols-4 gap-2 pt-3 border-t border-zinc-100 text-center text-xs">
              <div className="bg-zinc-50 rounded-lg p-2 border border-zinc-100">
                <span className="text-[9px] text-zinc-400 uppercase tracking-wider block">Total Skips</span>
                <span className="text-sm font-bold text-zinc-800">{historyData.analytics.totalSkipped}</span>
              </div>
              <div className="bg-zinc-50 rounded-lg p-2 border border-zinc-100">
                <span className="text-[9px] text-zinc-400 uppercase tracking-wider block">Rain Skips</span>
                <span className="text-sm font-bold text-zinc-800">{historyData.analytics.rainSkips}</span>
              </div>
              <div className="bg-zinc-50 rounded-lg p-2 border border-zinc-100">
                <span className="text-[9px] text-zinc-400 uppercase tracking-wider block">Moisture Skips</span>
                <span className="text-sm font-bold text-zinc-800">{historyData.analytics.moistureSkips}</span>
              </div>
              <div className="bg-zinc-50 rounded-lg p-2 border border-zinc-100">
                <span className="text-[9px] text-zinc-400 uppercase tracking-wider block">Safeguards</span>
                <span className="text-sm font-bold text-zinc-800">{historyData.analytics.safeguardSkips}</span>
              </div>
            </div>
          )}
        </div>

        {/* Middle Tier: Soil Moisture & Pump Controls grouped by flows OR legacy flat list */}
        {data.flows && data.flows.length > 0 ? (
          <div className="space-y-4">
            <h2 className="text-[10px] text-black uppercase tracking-wider font-bold">Watering Zones (Flows)</h2>
            <div className="grid grid-cols-1 gap-6 transition-opacity duration-300">
              {data.flows.map((flow) => {
                const pump = data.pumps?.find(p => p.id === flow.pump_id);
                if (!pump) return null;
                const isActive = pumpsState[pump.id];
                const isToggling = togglingPumps[pump.id];
                const disabledByLowWater = isLowWater && !isActive;

                // Find sensors belonging to this flow
                const flowSensors = data.sensors?.filter(s => flow.sensor_ids?.includes(s.id)) || [];
                
                let totalPct = 0;
                let count = 0;
                const renderedSensors = flowSensors.map(sensor => {
                  const reading = data.latest_readings?.[sensor.id];
                  const rawVal = reading?.value;
                  const hasVal = rawVal !== undefined && rawVal !== null;
                  const percentage = hasVal ? mapMoistureToPercentage(rawVal, sensor.dry_limit, sensor.wet_limit) : 0;
                  if (hasVal) {
                    totalPct += percentage;
                    count++;
                  }
                  const status = getMoistureStatus(percentage);
                  const barColor = getProgressBarColorClass(percentage);
                  return { sensor, percentage, status, barColor, hasVal };
                });

                const avgMoisture = count > 0 ? Math.round(totalPct / count) : null;
                const avgStatus = avgMoisture !== null ? getMoistureStatus(avgMoisture) : null;

                return (
                  <div key={flow.id} className={`bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-4 transition ${isActive ? 'bg-emerald-50/20 border-emerald-200' : ''}`}>
                    <div className="flex justify-between items-center border-b border-zinc-100 pb-3">
                      <div>
                        <h3 className="text-sm font-bold text-zinc-900 leading-tight">{flow.name}</h3>
                        <span className="text-[9px] text-zinc-400 font-mono">
                          Bound Output: {pump.name} (Pin {pump.pin})
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-3">
                        {avgMoisture !== null && (
                          <div className="text-right">
                            <span className="text-[9px] text-zinc-400 block font-semibold uppercase">Avg Moisture</span>
                            <span className="text-xs font-bold text-zinc-800">
                              {avgMoisture}% <span className={`text-[8px] uppercase ${avgStatus.color}`}>{avgStatus.label}</span>
                            </span>
                          </div>
                        )}
                        <span className="text-zinc-300">|</span>
                        <div className="flex items-center gap-2">
                          <PumpIcon className={`w-4 h-4 ${isActive ? 'text-emerald-500 animate-pulse' : 'text-zinc-400'}`} />
                          <button
                            onClick={() => handlePumpToggle(pump.id, pump.pin)}
                            disabled={isToggling || disabledByLowWater}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isActive ? 'bg-emerald-500' : 'bg-zinc-200'} ${(isToggling || disabledByLowWater) ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition duration-200 ease-in-out ${isActive ? 'translate-x-4' : 'translate-x-0'}`} />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Moisture sensors of this zone */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      {renderedSensors.length === 0 ? (
                        <div className="col-span-full text-center py-2 text-[10px] text-zinc-400 italic">
                          No moisture sensors bound to this flow.
                        </div>
                      ) : (
                        renderedSensors.map(({ sensor, percentage, status, barColor, hasVal }) => (
                          <div key={sensor.id} className="bg-zinc-50 border border-zinc-100 rounded-lg p-3 space-y-2 flex flex-col justify-between">
                            <div className="flex justify-between items-start">
                              <div>
                                <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block truncate max-w-[100px]" title={sensor.name}>
                                  {sensor.name}
                                </span>
                                {loading || !hasVal ? (
                                  <div className="h-5 w-10 bg-zinc-200 rounded animate-pulse mt-1"></div>
                                ) : (
                                  <div className="flex items-baseline gap-1 mt-0.5">
                                    <span className="text-sm font-bold text-zinc-800">{percentage}%</span>
                                    <span className={`text-[7px] uppercase tracking-wider ${status.color}`}>{status.label}</span>
                                  </div>
                                )}
                              </div>
                              <Sprout className="w-4 h-4 text-zinc-400" />
                            </div>
                            <div className="w-full bg-zinc-200 rounded-full h-1 mt-1">
                              {loading || !hasVal ? (
                                <div className="h-1 bg-zinc-300 rounded-full w-1/2 animate-pulse"></div>
                              ) : (
                                <div className={`${barColor} h-1 rounded-full transition-all duration-500`} style={{ width: `${percentage}%` }}></div>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <>
            {/* Legacy Flat Lists */}
            <div className="space-y-3">
              <h2 className="text-[10px] text-black uppercase tracking-wider font-bold">Soil Moisture</h2>
              {moistureSensors.length === 0 ? (
                <div className="bg-white border border-dashed border-zinc-200 rounded-xl p-8 text-center text-xs text-zinc-500">
                  No moisture sensors defined. Open the Config Manager to add custom sensors.
                </div>
              ) : (
                <div className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 transition-opacity duration-300 ${isStale ? 'opacity-60' : ''}`}>
                  {moistureSensors.map((sensor) => {
                    const reading = data.latest_readings?.[sensor.id];
                    const rawVal = reading?.value;
                    const hasVal = rawVal !== undefined && rawVal !== null;
                    const percentage = hasVal ? mapMoistureToPercentage(rawVal, sensor.dry_limit, sensor.wet_limit) : 0;
                    const status = getMoistureStatus(percentage);
                    const barColor = getProgressBarColorClass(percentage);
                    
                    return (
                      <div key={sensor.id} className="bg-white border border-zinc-200 rounded-xl p-4 shadow-sm space-y-3 flex flex-col justify-between">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block leading-tight">{sensor.name}</span>
                            <span className="text-[8px] text-zinc-400 font-mono">Pin: {sensor.pin}</span>
                            {loading || !hasVal ? (
                              <div className="h-6 w-12 bg-zinc-100 rounded animate-pulse mt-1"></div>
                            ) : (
                              <div className="flex items-baseline gap-1 mt-1">
                                <span className="text-lg font-bold text-zinc-800">{percentage}%</span>
                                <span className={`text-[8px] uppercase tracking-wider ${status.color}`}>{status.label}</span>
                              </div>
                            )}
                          </div>
                          <Sprout className="w-5 h-5 text-zinc-400" />
                        </div>
                        <div className="w-full bg-zinc-100 rounded-full h-1 mt-1">
                          {loading || !hasVal ? (
                            <div className="h-1 bg-zinc-200 rounded-full w-1/2 animate-pulse"></div>
                          ) : (
                            <div className={`${barColor} h-1 rounded-full transition-all duration-500`} style={{ width: `${percentage}%` }}></div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-3 pt-4">
              <h2 className="text-[10px] text-black uppercase tracking-wider font-bold">Pump Controls</h2>
              {data.pumps.length === 0 ? (
                <div className="bg-white border border-dashed border-zinc-200 rounded-xl p-6 text-center text-xs text-zinc-500">
                  No pumps configured. Open the settings panel to add dynamic pumps.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {data.pumps.map((pump) => {
                    const isActive = pumpsState[pump.id];
                    const isToggling = togglingPumps[pump.id];
                    const disabledByLowWater = isLowWater && !isActive;
                    
                    return (
                      <div key={pump.id} className={`border rounded-xl p-5 flex justify-between items-center ${isActive ? 'bg-emerald-50/40 border-emerald-200 shadow-sm' : 'bg-white border-zinc-200 shadow-sm'} ${disabledByLowWater ? 'opacity-70 bg-zinc-50' : ''}`}>
                        <div className="flex items-center gap-3">
                          <PumpIcon className={`w-5 h-5 ${isActive ? 'text-emerald-500' : 'text-zinc-300'} ${disabledByLowWater ? 'text-zinc-400' : ''}`} />
                          <div>
                            <span className="text-sm font-semibold text-zinc-800 block leading-tight">{pump.name}</span>
                            <span className={`text-[8px] font-mono ${disabledByLowWater ? 'text-red-500 font-bold' : 'text-zinc-400'}`}>
                              {disabledByLowWater ? 'LOCKED (Low Water)' : `Pin: ${pump.pin}`}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => handlePumpToggle(pump.id, pump.pin)}
                          disabled={isToggling || disabledByLowWater}
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isActive ? 'bg-emerald-500' : 'bg-zinc-200'} ${(isToggling || disabledByLowWater) ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition duration-200 ease-in-out ${isActive ? 'translate-x-5' : 'translate-x-0'}`} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* Recent Activity Log Section */}
        <ActivityLog commands={data.commands} loading={loading} onClear={handleClearActivityLog} />

        {/* Footer Settings */}
        <footer className="flex justify-between items-center text-[10px] text-zinc-400 pt-6 border-t border-zinc-200">
          <div>
            <span>Terrace Irrigation Control System Dashboard</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsNotesOpen(true)}
              className="flex items-center gap-1.5 hover:text-zinc-600 transition cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-zinc-500 bg-transparent border-0"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2.2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <span>System Notes</span>
            </button>
            <span className="text-zinc-300">|</span>
            <button
              onClick={() => setIsConfigOpen(true)}
              className="flex items-center gap-1.5 hover:text-zinc-600 transition cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-zinc-500 bg-transparent border-0"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Configure Panel</span>
            </button>
            <span className="text-zinc-300">|</span>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="flex items-center gap-1.5 hover:text-red-500 transition cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-zinc-500 hover:text-red-500 bg-transparent border-0"
            >
              <LogOut className="w-3.5 h-3.5 text-zinc-400 hover:text-red-500" strokeWidth={2.2} />
              <span>Log Out</span>
            </button>
          </div>
        </footer>

      </div>

      {/* COMPREHENSIVE CONFIGURATION MANAGER MODAL */}
      {isConfigOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full border border-zinc-200 shadow-2xl overflow-hidden flex flex-col h-[80vh] animate-in fade-in zoom-in-95 duration-150">
            
            {/* Header */}
            <div className="flex justify-between items-center border-b border-zinc-100 p-5">
              <div>
                <h3 className="font-semibold text-zinc-900 text-sm">System Configuration Manager</h3>
                <p className="text-[10px] text-zinc-500 mt-0.5">Edit networks, calibrate sensors, and assign hardware pins</p>
              </div>
              <button onClick={() => { setIsConfigOpen(false); fetchDashboardData(); }} className="text-zinc-400 hover:text-zinc-600 cursor-pointer p-1 rounded-lg hover:bg-zinc-50 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body (Sidebar Tabs + Content Layout) */}
            <div className="flex flex-1 overflow-hidden">
              
              {/* Sidebar Tabs */}
              <div className="w-1/4 border-r border-zinc-100 bg-zinc-50/50 p-3 space-y-1">
                {[
                  { id: 'network', label: 'Network Info', icon: Wifi },
                  { id: 'sensors', label: 'Sensors', icon: Sprout },
                  { id: 'pumps', label: 'Pumps', icon: PumpIcon },
                  { id: 'flows', label: 'Watering Flows', icon: Droplets },
                  { id: 'schedules', label: 'Schedules', icon: Clock },
                  { id: 'location', label: 'Location & Time', icon: MapPin },
                  { id: 'reservoir', label: 'Reservoir Settings', icon: Cylinder },
                  { id: 'system', label: 'System Settings', icon: Settings }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setConfigTab(tab.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold rounded-lg text-left transition-colors cursor-pointer ${
                      configTab === tab.id ? 'bg-white border border-zinc-200 text-blue-600 shadow-sm' : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
                    }`}
                  >
                    <tab.icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>

              {/* Tab Content Area */}
              <div className="flex-1 p-6 overflow-y-auto space-y-6">
                
                {/* 1. NETWORK SETTINGS TAB */}
                {configTab === 'network' && (
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-zinc-700 uppercase tracking-wider border-b pb-1.5">WiFi Setup</h4>
                    <div className="space-y-3">
                      <div>
                        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">SSID / Network Name</label>
                        <input
                          type="text"
                          value={wifiSsid}
                          onChange={(e) => setWifiSsid(e.target.value)}
                          className="w-full bg-zinc-50 border border-zinc-200 rounded-lg py-1.5 px-3 font-mono text-xs text-zinc-800 focus:outline-none focus:border-zinc-400"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">WiFi Password</label>
                        <input
                          type="password"
                          value={wifiPassword}
                          onChange={(e) => setWifiPassword(e.target.value)}
                          className="w-full bg-zinc-50 border border-zinc-200 rounded-lg py-1.5 px-3 font-mono text-xs text-zinc-800 focus:outline-none focus:border-zinc-400"
                        />
                      </div>
                      <button
                        onClick={handleWifiSave}
                        disabled={togglingConfig}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 text-xs rounded-xl cursor-pointer shadow-sm active:scale-95 transition-all w-fit disabled:opacity-50"
                      >
                        Save WiFi Settings
                      </button>
                    </div>

                    {/* Offline Provisioning Help Card */}
                    <div className="mt-6 border border-zinc-100 bg-zinc-50/50 rounded-xl p-4.5 space-y-2.5">
                      <div className="flex items-center gap-2 text-zinc-800">
                        <Wifi className="w-4 h-4 text-blue-500" />
                        <h5 className="text-[11px] font-bold uppercase tracking-wider">Offline Setup & Relocation</h5>
                      </div>
                      <p className="text-[11px] text-zinc-600 leading-relaxed">
                        If you move the device to a new location or change your home network password, the ESP32 will not be able to reach this panel. Follow these steps to connect:
                      </p>
                      <ol className="text-[11px] text-zinc-600 list-decimal pl-4.5 space-y-1.5 leading-relaxed">
                        <li>The ESP32 will automatically launch a configuration hotspot named <strong className="text-zinc-900 font-semibold">Watering-System-Setup</strong> after failing to connect for 10 seconds.</li>
                        <li>Connect your phone, tablet, or laptop to that hotspot.</li>
                        <li>Open your browser and navigate to <strong className="text-zinc-900 font-semibold">http://192.168.4.1</strong> to open the setup portal.</li>
                        <li>Select your new local Wi-Fi network from the list, type your password, confirm the Next.js server URL, and save.</li>
                      </ol>
                    </div>
                  </div>
                )}

                {/* 2. DYNAMIC SENSOR CONFIGURATION TAB */}
                {configTab === 'sensors' && (
                  <div className="space-y-6">
                    <h4 className="text-xs font-bold text-zinc-700 uppercase tracking-wider border-b pb-1.5">Manage Sensors</h4>

                    {/* Sensor Config Form */}
                    <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 space-y-3 text-xs">
                      <span className="font-bold text-zinc-700 block text-[11px] uppercase tracking-wider">
                        {editingSensorId ? 'Edit Sensor Configuration' : 'Add Custom Sensor'}
                      </span>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[9px] font-semibold text-zinc-500 uppercase">Sensor Name</label>
                          <input
                            type="text"
                            placeholder="e.g. Zone 6 Lavender"
                            value={sensorName}
                            onChange={(e) => setSensorName(e.target.value)}
                            className="w-full bg-white border border-zinc-200 rounded-lg py-1 px-2.5 mt-0.5 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-semibold text-zinc-500 uppercase">Sensor Type</label>
                          <select
                            value={sensorType}
                            onChange={(e) => setSensorType(e.target.value)}
                            className="w-full bg-white border border-zinc-200 rounded-lg py-1 px-2.5 mt-0.5 focus:outline-none"
                          >
                            <option value="moisture">Soil Moisture</option>
                            <option value="temperature">Temperature</option>
                            <option value="humidity">Humidity</option>
                            <option value="water_level">Water Level (Reservoir)</option>
                          </select>
                        </div>
                      </div>

                      {/* Associated Pump Zone */}
                      <div>
                        <label className="text-[9px] font-semibold text-zinc-500 uppercase">Associated Pump / Zone</label>
                        <select
                          value={sensorPumpId}
                          onChange={(e) => setSensorPumpId(e.target.value)}
                          className="w-full bg-white border border-zinc-200 rounded-lg py-1 px-2.5 mt-0.5 focus:outline-none"
                        >
                          <option value="">None (Global / Unbound)</option>
                          {data.pumps.map(pump => (
                            <option key={pump.id} value={pump.id}>
                              {pump.name} (Pin {pump.pin})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[9px] font-semibold text-zinc-500 uppercase">
                            {sensorType === 'water_level' ? 'Trig Pin (Primary)' : 'ESP32 Pin'}
                          </label>
                          <input
                            type="number"
                            value={sensorPin}
                            onChange={(e) => setSensorPin(e.target.value)}
                            className="w-full bg-white border border-zinc-200 rounded-lg py-1 px-2.5 mt-0.5 focus:outline-none font-mono"
                          />
                        </div>
                        {sensorType === 'water_level' && (
                          <div>
                            <label className="text-[9px] font-semibold text-zinc-500 uppercase">Echo Pin (Secondary)</label>
                            <input
                              type="number"
                              value={sensorPinSecondary}
                              onChange={(e) => setSensorPinSecondary(e.target.value)}
                              className="w-full bg-white border border-zinc-200 rounded-lg py-1 px-2.5 mt-0.5 focus:outline-none font-mono"
                            />
                          </div>
                        )}
                      </div>

                      {(sensorType === 'moisture' || sensorType === 'water_level') && (
                        <div className="flex gap-2 w-full mt-2">
                          <div className="w-1/2">
                            <label className="text-[9px] font-semibold text-zinc-500 uppercase">Dry (Air) Limit</label>
                            <input
                              type="number"
                              value={sensorDryLimit}
                              onChange={(e) => setSensorDryLimit(e.target.value)}
                              className="w-full bg-white border border-zinc-200 rounded-lg py-1 px-2.5 mt-0.5 focus:outline-none font-mono"
                            />
                          </div>
                          <div className="w-1/2">
                            <label className="text-[9px] font-semibold text-zinc-500 uppercase">Wet (Water) Limit</label>
                            <input
                              type="number"
                              value={sensorWetLimit}
                              onChange={(e) => setSensorWetLimit(e.target.value)}
                              className="w-full bg-white border border-zinc-200 rounded-lg py-1 px-2.5 mt-0.5 focus:outline-none font-mono"
                            />
                          </div>
                        </div>
                      )}

                      <div className="flex justify-end gap-2 pt-1">
                        {editingSensorId && (
                          <button
                            onClick={() => {
                              setEditingSensorId(null);
                              setSensorName('');
                              setSensorPin(32);
                              setSensorPinSecondary('');
                              setSensorPumpId('');
                            }}
                            className="bg-white border border-zinc-200 px-3 py-1.5 text-xs font-semibold rounded-lg"
                          >
                            Cancel
                          </button>
                        )}
                        <button
                          onClick={handleSensorSave}
                          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-3 py-1.5 text-xs rounded-lg active:scale-95 transition-all shadow-sm"
                        >
                          {editingSensorId ? 'Update Sensor' : 'Add Sensor'}
                        </button>
                      </div>
                    </div>

                    {/* Sensor Configs List */}
                    <div className="space-y-2">
                      <span className="font-bold text-zinc-700 block text-[10px] uppercase tracking-wider">Active Sensors</span>
                      {data.sensors.map(sensor => (
                        <div key={sensor.id} className="flex justify-between items-center text-xs bg-white border border-zinc-200 p-3 rounded-xl shadow-sm">
                          <div>
                            <span className="font-bold text-zinc-800 block">{sensor.name}</span>
                            <span className="text-[10px] text-zinc-400 font-mono">
                              Type: {sensor.type} | Pin: {sensor.pin}{(sensor.pin_secondary !== null && sensor.pin_secondary !== undefined) ? ` (Echo: ${sensor.pin_secondary})` : ''} | Group: {sensor.sensor_group}
                              {(() => {
                                const bound = data.pumps.find(p => p.id === sensor.pump_id);
                                return bound ? ` | Waters: ${bound.name}` : ' | Waters: None (Global)';
                              })()}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setEditingSensorId(sensor.id);
                                setSensorName(sensor.name);
                                setSensorType(sensor.type);
                                setSensorPin(sensor.pin);
                                setSensorPinSecondary(sensor.pin_secondary !== null && sensor.pin_secondary !== undefined ? sensor.pin_secondary : '');
                                setSensorDryLimit(sensor.dry_limit !== null && sensor.dry_limit !== undefined ? sensor.dry_limit : 3400);
                                setSensorWetLimit(sensor.wet_limit !== null && sensor.wet_limit !== undefined ? sensor.wet_limit : 1100);
                                setSensorPumpId(sensor.pump_id !== null && sensor.pump_id !== undefined ? String(sensor.pump_id) : '');
                              }}
                              className="p-1.5 border border-zinc-100 hover:border-zinc-200 hover:bg-zinc-50 rounded-lg text-zinc-600 transition"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleSensorDelete(sensor.id)}
                              className="p-1.5 border border-zinc-100 hover:border-zinc-200 hover:bg-red-50 text-red-500 rounded-lg transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 3. DYNAMIC PUMP CONFIGURATION TAB */}
                {configTab === 'pumps' && (
                  <div className="space-y-6">
                    <h4 className="text-xs font-bold text-zinc-700 uppercase tracking-wider border-b pb-1.5">Manage Pumps</h4>

                    {/* Pump Config Form */}
                    <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 space-y-3 text-xs">
                      <span className="font-bold text-zinc-700 block text-[11px] uppercase tracking-wider">
                        {editingPumpId ? 'Edit Pump Settings' : 'Add Custom Pump'}
                      </span>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="text-[9px] font-semibold text-zinc-500 uppercase">Pump Name</label>
                          <input
                            type="text"
                            placeholder="e.g. Pump 5 Solenoid"
                            value={pumpName}
                            onChange={(e) => setPumpName(e.target.value)}
                            className="w-full bg-white border border-zinc-200 rounded-lg py-1 px-2.5 mt-0.5 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-semibold text-zinc-500 uppercase">ESP32 Pin</label>
                          <input
                            type="number"
                            value={pumpPin}
                            onChange={(e) => setPumpPin(e.target.value)}
                            className="w-full bg-white border border-zinc-200 rounded-lg py-1 px-2.5 mt-0.5 focus:outline-none font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-semibold text-zinc-500 uppercase">Flow Rate (L/min)</label>
                          <input
                            type="number"
                            step="0.1"
                            min="0.1"
                            value={pumpFlowRate}
                            onChange={(e) => setPumpFlowRate(e.target.value)}
                            className="w-full bg-white border border-zinc-200 rounded-lg py-1 px-2.5 mt-0.5 focus:outline-none font-mono"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-1">
                        {editingPumpId && (
                          <button
                            onClick={() => {
                              setEditingPumpId(null);
                              setPumpName('');
                              setPumpPin(25);
                              setPumpFlowRate(4.0);
                            }}
                            className="bg-white border border-zinc-200 px-3 py-1.5 text-xs font-semibold rounded-lg"
                          >
                            Cancel
                          </button>
                        )}
                        <button
                          onClick={handlePumpSave}
                          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-3 py-1.5 text-xs rounded-lg active:scale-95 transition-all shadow-sm"
                        >
                          {editingPumpId ? 'Update Pump' : 'Add Pump'}
                        </button>
                      </div>
                    </div>

                    {/* Pumps List */}
                    <div className="space-y-2">
                      <span className="font-bold text-zinc-700 block text-[10px] uppercase tracking-wider">Active Pumps</span>
                      {data.pumps.map(pump => (
                        <div key={pump.id} className="flex justify-between items-center text-xs bg-white border border-zinc-200 p-3 rounded-xl shadow-sm">
                          <div>
                            <span className="font-bold text-zinc-800 block">{pump.name}</span>
                            <span className="text-[10px] text-zinc-400 font-mono">Pin Assignment: {pump.pin} | Flow: {pump.flow_rate_lpm || 4.0} L/min</span>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setEditingPumpId(pump.id);
                                setPumpName(pump.name);
                                setPumpPin(pump.pin);
                                setPumpFlowRate(pump.flow_rate_lpm !== null && pump.flow_rate_lpm !== undefined ? pump.flow_rate_lpm : 4.0);
                              }}
                              className="p-1.5 border border-zinc-100 hover:border-zinc-200 hover:bg-zinc-50 rounded-lg text-zinc-600 transition"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handlePumpDelete(pump.id)}
                              className="p-1.5 border border-zinc-100 hover:border-zinc-200 hover:bg-red-50 text-red-500 rounded-lg transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 3b. DYNAMIC WATERING FLOWS TAB */}
                {configTab === 'flows' && (
                  <div className="space-y-6">
                    <h4 className="text-xs font-bold text-zinc-700 uppercase tracking-wider border-b pb-1.5">Manage Watering Flows</h4>

                    {/* Flow Config Form */}
                    <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 space-y-3 text-xs">
                      <span className="font-bold text-zinc-700 block text-[11px] uppercase tracking-wider">
                        {editingFlowId ? 'Edit Flow Configuration' : 'Add Custom Flow (Zone)'}
                      </span>
                      
                      <div className="space-y-3">
                        <div>
                          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">Flow Name</label>
                          <input
                            type="text"
                            placeholder="e.g. Balcony Tomatoes, Living Room Ferns"
                            value={flowName}
                            onChange={(e) => setFlowName(e.target.value)}
                            className="w-full bg-white border border-zinc-200 rounded-lg py-1.5 px-3 focus:outline-none focus:border-zinc-400"
                          />
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">Select Pump</label>
                            <select
                              value={flowPumpId}
                              onChange={(e) => setFlowPumpId(e.target.value)}
                              className="w-full bg-white border border-zinc-200 rounded-lg py-1.5 px-2.5 focus:outline-none cursor-pointer"
                            >
                              <option value="">-- Choose Pump --</option>
                              {data.pumps.map(p => (
                                <option key={p.id} value={p.id}>{p.name} (Pin {p.pin})</option>
                              ))}
                            </select>
                          </div>
                          
                          <div>
                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">Pots / Moisture Sensors</label>
                            <div className="border border-zinc-200 rounded-lg bg-white p-2.5 max-h-36 overflow-y-auto space-y-1.5">
                              {data.sensors.filter(s => s.type === 'moisture').length === 0 ? (
                                <span className="text-[10px] text-zinc-400 italic">No moisture sensors configured.</span>
                              ) : (
                                data.sensors.filter(s => s.type === 'moisture').map(s => {
                                  const checked = flowSensorIds.includes(s.id);
                                  return (
                                    <label key={s.id} className="flex items-center gap-2 cursor-pointer select-none">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => {
                                          if (checked) {
                                            setFlowSensorIds(prev => prev.filter(v => v !== s.id));
                                          } else {
                                            setFlowSensorIds(prev => [...prev, s.id].sort());
                                          }
                                        }}
                                        className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                                      />
                                      <span className="text-[10px] font-semibold text-zinc-700">{s.name} (Pin {s.pin})</span>
                                    </label>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-1">
                        {editingFlowId && (
                          <button
                            onClick={() => {
                              setEditingFlowId(null);
                              setFlowName('');
                              setFlowPumpId('');
                              setFlowSensorIds([]);
                            }}
                            className="bg-white border border-zinc-200 px-3 py-1.5 text-xs font-semibold rounded-lg"
                          >
                            Cancel
                          </button>
                        )}
                        <button
                          onClick={handleFlowSave}
                          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-3 py-1.5 text-xs rounded-lg active:scale-95 transition-all shadow-sm cursor-pointer"
                        >
                          {editingFlowId ? 'Update Flow' : 'Add Flow'}
                        </button>
                      </div>
                    </div>

                    {/* Flows List */}
                    <div className="space-y-2">
                      <span className="font-bold text-zinc-700 block text-[10px] uppercase tracking-wider">Configured Flows (Zones)</span>
                      {(!data.flows || data.flows.length === 0) ? (
                        <div className="text-center py-4 text-xs text-zinc-400 italic">No watering flows configured yet.</div>
                      ) : (
                        data.flows.map(flow => (
                          <div key={flow.id} className="flex justify-between items-center text-xs bg-white border border-zinc-200 p-3 rounded-xl shadow-sm">
                            <div>
                              <span className="font-bold text-zinc-800 block">{flow.name}</span>
                              <span className="text-[10px] text-zinc-400 font-mono">
                                Output: {flow.pump_name} | Inputs: {flow.sensor_names || 'None'}
                              </span>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setEditingFlowId(flow.id);
                                  setFlowName(flow.name);
                                  setFlowPumpId(flow.pump_id.toString());
                                  setFlowSensorIds(flow.sensor_ids || []);
                                }}
                                className="p-1.5 border border-zinc-100 hover:border-zinc-200 hover:bg-zinc-50 rounded-lg text-zinc-600 transition"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleFlowDelete(flow.id)}
                                className="p-1.5 border border-zinc-100 hover:border-zinc-200 hover:bg-red-50 text-red-500 rounded-lg transition"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* 4. LOCATION & TIME TAB */}
                {configTab === 'location' && (
                  <div className="space-y-6">
                    <h4 className="text-xs font-bold text-zinc-700 uppercase tracking-wider border-b pb-1.5">Location & Time Configuration</h4>
                    
                    {/* Timezone Card */}
                    <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-4">
                      <div className="flex items-center gap-2 border-b pb-2 text-zinc-800">
                        <Clock className="w-4 h-4 text-blue-500" />
                        <h5 className="text-[11px] font-bold uppercase tracking-wider">System Timezone</h5>
                      </div>
                      <p className="text-[11px] text-zinc-500">
                        Select the local timezone of the physical watering system. This ensures schedules are executed at the correct time.
                      </p>
                      <div className="flex gap-2">
                        <select
                          value={timezone}
                          onChange={(e) => setTimezone(e.target.value)}
                          className="flex-1 bg-zinc-50 border border-zinc-200 text-zinc-800 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-zinc-400 font-semibold cursor-pointer"
                        >
                          <option value="Europe/Bucharest">Europe/Bucharest (GMT+3)</option>
                          <option value="Europe/London">Europe/London (GMT+1)</option>
                          <option value="Europe/Paris">Europe/Paris (GMT+2)</option>
                          <option value="Europe/Athens">Europe/Athens (GMT+3)</option>
                          <option value="Europe/Budapest">Europe/Budapest (GMT+2)</option>
                          <option value="UTC">UTC (GMT+0)</option>
                        </select>
                        <button
                          onClick={handleTimezoneSave}
                          disabled={togglingConfig}
                          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-1.5 text-xs rounded-xl cursor-pointer shadow-sm active:scale-95 transition-all w-fit disabled:opacity-50"
                        >
                          Save Timezone
                        </button>
                      </div>
                      {!deviceStatus.active && (
                        <span className="text-[10px] text-amber-500 font-semibold mt-1.5 block">⚠️ Offline: Saved changes are pending sync</span>
                      )}
                    </div>

                    {/* City Location Weather search Card */}
                    <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-4">
                      <div className="flex items-center gap-2 border-b pb-2 text-zinc-800">
                        <CloudSun className="w-4 h-4 text-blue-500" />
                        <h5 className="text-[11px] font-bold uppercase tracking-wider">System Location (Weather Forecast)</h5>
                      </div>
                      <p className="text-[11px] text-zinc-500">
                        Specify where the system is placed to inject local weather data. This enables automatic rain skips when high precipitation is forecasted.
                      </p>
                      
                      {locationName && (
                        <div className="bg-emerald-50 border border-emerald-100 text-emerald-800 p-3 rounded-lg flex items-center justify-between">
                          <div>
                            <span className="block font-bold text-[8px] uppercase tracking-wider text-emerald-600">Active Location</span>
                            <span className="font-semibold text-xs">{locationName}</span>
                            <span className="block text-[8px] text-emerald-600 font-mono mt-0.5">({latitude.toFixed(4)}°, {longitude.toFixed(4)}°)</span>
                          </div>
                        </div>
                      )}
                      
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block">Search City/Town</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="e.g. Budapest, London, Munich..."
                            value={locationSearchQuery}
                            onChange={(e) => setLocationSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleLocationSearch()}
                            className="flex-1 bg-zinc-50 border border-zinc-200 rounded-lg py-1.5 px-3 text-xs text-zinc-800 focus:outline-none focus:border-zinc-400 font-semibold"
                          />
                          <button
                            onClick={handleLocationSearch}
                            disabled={togglingConfig}
                            className="bg-zinc-800 hover:bg-zinc-900 text-white font-semibold px-4 py-1.5 text-xs rounded-xl cursor-pointer shadow-sm active:scale-95 transition-all w-fit disabled:opacity-50"
                          >
                            Search
                          </button>
                        </div>
                      </div>

                      {/* Search Results List */}
                      {locationResults.length > 0 && (
                        <div className="border border-zinc-100 rounded-lg divide-y divide-zinc-50 overflow-hidden bg-white shadow-sm max-h-48 overflow-y-auto">
                          {locationResults.map((loc) => (
                            <button
                              key={loc.id}
                              type="button"
                              onClick={() => handleLocationSelect(loc)}
                              className="w-full text-left p-2.5 hover:bg-zinc-50 transition flex justify-between items-center text-xs"
                            >
                              <div>
                                <span className="font-semibold text-zinc-800 block">{loc.name}</span>
                                <span className="text-[10px] text-zinc-400 block">{loc.admin1 ? loc.admin1 + ', ' : ''}{loc.country}</span>
                              </div>
                              <span className="text-[9px] text-zinc-400 font-mono">({loc.latitude.toFixed(2)}°, {loc.longitude.toFixed(2)}°)</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 5. RESERVOIR SETTINGS TAB */}
                {configTab === 'reservoir' && (
                  <div className="space-y-6">
                    <h4 className="text-xs font-bold text-zinc-700 uppercase tracking-wider border-b pb-1.5">Water Reservoir Calibration</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-6 items-start">
                      
                      {/* Left: Input fields form (cols 3) */}
                      <div className="md:col-span-3 space-y-4">
                        <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">Tank Depth / Height (cm)</label>
                              <input
                                ref={heightInputRef}
                                type="number"
                                min="1"
                                value={reservoirHeight}
                                onChange={(e) => setReservoirHeight(Number(e.target.value))}
                                onFocus={() => setFocusedField('height')}
                                onBlur={() => setFocusedField(null)}
                                onMouseEnter={() => setFocusedField('height')}
                                onMouseLeave={() => setFocusedField(null)}
                                className="w-full bg-zinc-50 border border-zinc-200 rounded-lg py-1.5 px-3 font-mono text-xs text-zinc-800 focus:outline-none focus:border-zinc-400"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">Sensor Mounting Offset (cm)</label>
                              <input
                                ref={offsetInputRef}
                                type="number"
                                min="1"
                                value={reservoirSensorOffset}
                                onChange={(e) => setReservoirSensorOffset(Number(e.target.value))}
                                onFocus={() => setFocusedField('offset')}
                                onBlur={() => setFocusedField(null)}
                                onMouseEnter={() => setFocusedField('offset')}
                                onMouseLeave={() => setFocusedField(null)}
                                className="w-full bg-zinc-50 border border-zinc-200 rounded-lg py-1.5 px-3 font-mono text-xs text-zinc-800 focus:outline-none focus:border-zinc-400"
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block">Volume Calculation Method</label>
                            <div className="grid grid-cols-2 gap-2 mt-1">
                              <button
                                type="button"
                                onClick={() => setReservoirUseDimensions(false)}
                                className={`py-1.5 px-3 text-xs font-semibold rounded-lg border transition cursor-pointer ${
                                  !reservoirUseDimensions
                                    ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                                    : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50'
                                }`}
                              >
                                By Liter Capacity
                              </button>
                              <button
                                type="button"
                                onClick={() => setReservoirUseDimensions(true)}
                                className={`py-1.5 px-3 text-xs font-semibold rounded-lg border transition cursor-pointer ${
                                  reservoirUseDimensions
                                    ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                                    : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50'
                                }`}
                              >
                                By Tank Dimensions
                              </button>
                            </div>
                          </div>

                          {/* Conditional Options */}
                          {reservoirUseDimensions ? (
                            <div className="space-y-3 animate-in fade-in duration-200">
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">Tank Width (cm)</label>
                                  <input
                                    ref={widthInputRef}
                                    type="number"
                                    min="1"
                                    value={reservoirWidth}
                                    onChange={(e) => setReservoirWidth(Number(e.target.value))}
                                    onFocus={() => setFocusedField('width')}
                                    onBlur={() => setFocusedField(null)}
                                    onMouseEnter={() => setFocusedField('width')}
                                    onMouseLeave={() => setFocusedField(null)}
                                    className="w-full bg-zinc-50 border border-zinc-200 rounded-lg py-1.5 px-3 font-mono text-xs text-zinc-800 focus:outline-none focus:border-zinc-400"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">Tank Length (cm)</label>
                                  <input
                                    ref={lengthInputRef}
                                    type="number"
                                    min="1"
                                    value={reservoirLength}
                                    onChange={(e) => setReservoirLength(Number(e.target.value))}
                                    onFocus={() => setFocusedField('length')}
                                    onBlur={() => setFocusedField(null)}
                                    onMouseEnter={() => setFocusedField('length')}
                                    onMouseLeave={() => setFocusedField(null)}
                                    className="w-full bg-zinc-50 border border-zinc-200 rounded-lg py-1.5 px-3 font-mono text-xs text-zinc-800 focus:outline-none focus:border-zinc-400"
                                  />
                                </div>
                              </div>
                              <div className="bg-zinc-50 border border-zinc-200 p-2.5 rounded-lg text-center font-semibold text-zinc-600 text-xs">
                                Estimated Tank Volume: <span className="text-zinc-900 font-mono">{(Math.round((reservoirWidth * reservoirLength * reservoirHeight) / 100) / 10).toFixed(1)}L</span>
                              </div>
                            </div>
                          ) : (
                            <div className="animate-in fade-in duration-200">
                              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">Total Volume Capacity (Liters)</label>
                              <input
                                ref={volumeInputRef}
                                type="number"
                                min="1"
                                value={reservoirTotalVolume}
                                onChange={(e) => setReservoirTotalVolume(Number(e.target.value))}
                                className="w-full bg-zinc-50 border border-zinc-200 rounded-lg py-1.5 px-3 font-mono text-xs text-zinc-800 focus:outline-none focus:border-zinc-400"
                              />
                            </div>
                          )}

                          {/* Safety Limit */}
                          <div className="pt-2 border-t border-zinc-100">
                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">Minimum Safety Volume (Liters)</label>
                            <input
                              ref={minVolumeInputRef}
                              type="number"
                              step="0.5"
                              min="0.5"
                              value={reservoirMinVolume}
                              onChange={(e) => setReservoirMinVolume(parseFloat(e.target.value))}
                              onFocus={() => setFocusedField('min_volume')}
                              onBlur={() => setFocusedField(null)}
                              onMouseEnter={() => setFocusedField('min_volume')}
                              onMouseLeave={() => setFocusedField(null)}
                              className="w-full bg-zinc-50 border border-zinc-200 rounded-lg py-1.5 px-3 font-mono text-xs text-zinc-800 focus:outline-none focus:border-zinc-400"
                            />
                            <p className="text-[9px] text-zinc-400 mt-1">
                              Pumps will lock and scheduled/manual triggers will block if volume falls below this level to prevent dry-running.
                            </p>
                          </div>
                        </div>

                        <button
                          onClick={handleReservoirSave}
                          disabled={togglingConfig}
                          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 text-xs rounded-xl cursor-pointer shadow-sm active:scale-95 transition-all w-fit disabled:opacity-50 mt-2"
                        >
                          Save Reservoir Settings
                        </button>
                        {!deviceStatus.active && (
                          <span className="text-[10px] text-amber-500 font-semibold mt-2 block">⚠️ Offline: Saved changes are pending sync</span>
                        )}
                      </div>

                      {/* Right: SVG Diagram (cols 2) */}
                      {(() => {
                        // Proportional SVG Calculations
                        const sensorY = 50;
                        const bottomY = 280;
                        const maxOffsetCm = Math.max(reservoirSensorOffset, 1);
                        const scale = 230 / maxOffsetCm; // scale pixels per cm
                        
                        // Calculate top of tank (H_tank)
                        const tankHeightCm = Math.max(reservoirHeight, 1);
                        const tankHeightSvg = Math.min(tankHeightCm * scale, 210); // cap to prevent overlapping sensor
                        const topY = bottomY - tankHeightSvg;
                        
                        // Calculate safety volume height
                        const totalVolumeLiters = reservoirUseDimensions
                          ? (reservoirWidth * reservoirLength * reservoirHeight) / 1000
                          : Math.max(reservoirTotalVolume, 1);
                        
                        const safetyRatio = Math.min(reservoirMinVolume / Math.max(totalVolumeLiters, 1), 1.0);
                        const safetyHeightSvg = tankHeightSvg * safetyRatio;
                        const safetyY = bottomY - safetyHeightSvg;

                        // Calculate current water level representation (e.g. 65% full for demonstration)
                        const waterHeightSvg = tankHeightSvg * 0.65;
                        const waterY = bottomY - waterHeightSvg;

                        return (
                          <div className="md:col-span-2 flex flex-col items-center justify-center bg-zinc-50/50 border border-zinc-100 rounded-xl p-4 shadow-inner">
                            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Visual Calibration Guide</span>
                            
                            <svg viewBox="0 0 260 320" className="w-full max-w-[240px] mx-auto select-none">
                              <defs>
                                <linearGradient id="waterGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.45" />
                                  <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.65" />
                                </linearGradient>
                                <filter id="glowBlue" filterUnits="userSpaceOnUse" x="0" y="0" width="260" height="320">
                                  <feGaussianBlur stdDeviation="3" result="blur" />
                                  <feMerge>
                                    <feMergeNode in="blur" />
                                    <feMergeNode in="SourceGraphic" />
                                  </feMerge>
                                </filter>
                              </defs>

                              {/* Ground Line */}
                              <line x1="10" y1="280" x2="250" y2="280" stroke="#e4e4e7" strokeWidth="2" strokeDasharray="4 4" />

                              {/* Tank Outline */}
                              <path d={`M 50 ${topY} L 50 280 L 170 280 L 170 ${topY}`} fill="none" stroke="#71717a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                              <line x1="42" y1={topY} x2="58" y2={topY} stroke="#71717a" strokeWidth="3" />
                              <line x1="162" y1={topY} x2="178" y2={topY} stroke="#71717a" strokeWidth="3" />

                              {/* Water Level representation */}
                              <rect x="52" y={waterY} width="116" height={waterHeightSvg - 2} fill="url(#waterGrad)" rx="2" />
                              <path d={`M 52 ${waterY} Q 80 ${waterY - 2} 110 ${waterY} T 168 ${waterY}`} fill="none" stroke="#2563eb" strokeWidth="2" />

                              {/* Sensor representation */}
                              <path d={`M 110 20 L 110 ${sensorY}`} fill="none" stroke="#71717a" strokeWidth="2" />
                              <rect x="90" y="20" width="40" height="4" fill="#a1a1aa" rx="1" />
                              <rect x="95" y={sensorY - 4} width="30" height="12" fill="#3f3f46" rx="2" />
                              <circle cx="102" cy={sensorY + 6} r="4" fill="#18181b" />
                              <circle cx="118" cy={sensorY + 6} r="4" fill="#18181b" />
                              
                              {/* Acoustic waves */}
                              <path d={`M 100 ${sensorY + 14} Q 110 ${sensorY + 18} 120 ${sensorY + 14}`} fill="none" stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
                              <path d={`M 96 ${sensorY + 20} Q 110 ${sensorY + 26} 124 ${sensorY + 20}`} fill="none" stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />

                              {/* Dimensions lines */}
                              
                              {/* 1. Sensor Mounting Offset */}
                              <g 
                                className="cursor-pointer"
                                onMouseEnter={() => setFocusedField('offset')}
                                onMouseLeave={() => setFocusedField(null)}
                                onClick={() => offsetInputRef.current?.focus()}
                              >
                                <line 
                                  x1="210" y1={sensorY} x2="210" y2="280" 
                                  stroke={focusedField === 'offset' ? '#f59e0b' : '#a1a1aa'} 
                                  strokeWidth={focusedField === 'offset' ? '3' : '1.5'}
                                  filter={focusedField === 'offset' ? 'url(#glowBlue)' : ''}
                                />
                                <path d={`M 206 ${sensorY + 6} L 210 ${sensorY} L 214 ${sensorY + 6}`} fill="none" stroke={focusedField === 'offset' ? '#f59e0b' : '#a1a1aa'} strokeWidth="1.5" />
                                <path d="M 206 274 L 210 280 L 214 274" fill="none" stroke={focusedField === 'offset' ? '#f59e0b' : '#a1a1aa'} strokeWidth="1.5" />
                                <text 
                                  x="220" y="160" 
                                  fill={focusedField === 'offset' ? '#d97706' : '#71717a'} 
                                  fontSize="9" 
                                  fontWeight={focusedField === 'offset' ? 'bold' : 'normal'}
                                  transform="rotate(90, 220, 160)"
                                  textAnchor="middle"
                                >
                                  Sensor Offset ({reservoirSensorOffset} cm)
                                </text>
                              </g>

                              {/* 2. Tank Height */}
                              <g 
                                className="cursor-pointer"
                                onMouseEnter={() => setFocusedField('height')}
                                onMouseLeave={() => setFocusedField(null)}
                                onClick={() => heightInputRef.current?.focus()}
                              >
                                <line 
                                  x1="24" y1={topY} x2="24" y2="280" 
                                  stroke={focusedField === 'height' ? '#3b82f6' : '#a1a1aa'} 
                                  strokeWidth={focusedField === 'height' ? '3' : '1.5'}
                                  filter={focusedField === 'height' ? 'url(#glowBlue)' : ''}
                                />
                                <path d={`M 20 ${topY + 6} L 24 ${topY} L 28 ${topY + 6}`} fill="none" stroke={focusedField === 'height' ? '#3b82f6' : '#a1a1aa'} strokeWidth="1.5" />
                                <path d="M 20 274 L 24 280 L 28 274" fill="none" stroke={focusedField === 'height' ? '#3b82f6' : '#a1a1aa'} strokeWidth="1.5" />
                                <text 
                                  x="14" y="210" 
                                  fill={focusedField === 'height' ? '#2563eb' : '#71717a'} 
                                  fontSize="9" 
                                  fontWeight={focusedField === 'height' ? 'bold' : 'normal'}
                                  transform="rotate(-90, 14, 210)"
                                  textAnchor="middle"
                                >
                                  Tank Depth ({reservoirHeight} cm)
                                </text>
                              </g>

                              {/* 3. Safety Minimum Limit */}
                              <g
                                className="cursor-pointer"
                                onMouseEnter={() => setFocusedField('min_volume')}
                                onMouseLeave={() => setFocusedField(null)}
                                onClick={() => minVolumeInputRef.current?.focus()}
                              >
                                <line 
                                  x1="52" y1={safetyY} x2="168" y2={safetyY} 
                                  stroke="#ef4444" 
                                  strokeWidth={focusedField === 'min_volume' ? '2.5' : '1.5'}
                                  strokeDasharray="3 2"
                                />
                                <text 
                                  x="110" y={safetyY - 6} 
                                  fill="#ef4444" 
                                  fontSize="8" 
                                  fontWeight="bold"
                                  textAnchor="middle"
                                >
                                  Min Safety ({reservoirMinVolume}L)
                                </text>
                              </g>

                              {/* 4. Tank Width */}
                              {reservoirUseDimensions && (
                                <g
                                  className="cursor-pointer"
                                  onMouseEnter={() => setFocusedField('width')}
                                  onMouseLeave={() => setFocusedField(null)}
                                  onClick={() => widthInputRef.current?.focus()}
                                >
                                  <line 
                                    x1="50" y1="294" x2="170" y2="294" 
                                    stroke={focusedField === 'width' ? '#3b82f6' : '#d4d4d8'} 
                                    strokeWidth={focusedField === 'width' ? '2' : '1'}
                                  />
                                  <path d="M 56 290 L 50 294 L 56 298" fill="none" stroke={focusedField === 'width' ? '#3b82f6' : '#d4d4d8'} strokeWidth="1" />
                                  <path d="M 164 290 L 170 294 L 164 298" fill="none" stroke={focusedField === 'width' ? '#3b82f6' : '#d4d4d8'} strokeWidth="1" />
                                  <text 
                                    x="110" y="306" 
                                    fill={focusedField === 'width' ? '#2563eb' : '#a1a1aa'} 
                                    fontSize="8"
                                    fontWeight={focusedField === 'width' ? 'bold' : 'normal'}
                                    textAnchor="middle"
                                  >
                                    Width ({reservoirWidth} cm)
                                  </text>
                                </g>
                              )}
                            </svg>
                          </div>
                        );
                      })()}

                    </div>
                  </div>
                )}

                {/* 6. SYSTEM SETTINGS TAB */}
                {configTab === 'system' && (
                  <div className="space-y-6">
                    <h4 className="text-xs font-bold text-zinc-700 uppercase tracking-wider border-b pb-1.5">System Settings & Safety</h4>
                    
                    {/* Fetch Sync Interval Card */}
                    <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-4">
                      <div className="flex items-center gap-2 border-b pb-2 text-zinc-800">
                        <RefreshCw className="w-4 h-4 text-blue-500" />
                        <h5 className="text-[11px] font-bold uppercase tracking-wider">Data Fetch & Sync Interval</h5>
                      </div>
                      <p className="text-[11px] text-zinc-500">
                        Configure how often the ESP32 watering controller wakes up to report telemetry and synchronise settings with this cloud dashboard.
                      </p>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="1"
                          max="1440"
                          value={customInterval}
                          onChange={(e) => setCustomInterval(e.target.value)}
                          className="w-20 bg-zinc-50 border border-zinc-200 text-zinc-800 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-zinc-400 text-center font-mono font-semibold"
                        />
                        <select
                          value={intervalUnit}
                          onChange={(e) => setIntervalUnit(e.target.value)}
                          className="bg-zinc-50 border border-zinc-200 text-zinc-800 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-zinc-400 font-semibold cursor-pointer"
                        >
                          <option value="minutes">Minutes</option>
                          <option value="hours">Hours</option>
                        </select>
                        <button
                          onClick={handleCustomIntervalSave}
                          disabled={togglingConfig}
                          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 text-xs rounded-xl cursor-pointer shadow-sm active:scale-95 transition-all w-fit disabled:opacity-50"
                        >
                          Save Interval
                        </button>
                      </div>
                      {!deviceStatus.active && (
                        <span className="text-[10px] text-amber-500 font-semibold mt-1.5 block">⚠️ Offline: Saved changes are pending sync</span>
                      )}
                    </div>

                    {/* Moisture skip trigger Card */}
                    <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-4">
                      <div className="flex items-center gap-2 border-b pb-2 text-zinc-800">
                        <Sprout className="w-4 h-4 text-blue-500" />
                        <h5 className="text-[11px] font-bold uppercase tracking-wider">Soil Moisture Automation Skip</h5>
                      </div>
                      <p className="text-[11px] text-zinc-500">
                        Pumps will automatically skip scheduled events if the average soil moisture exceeds this percentage.
                      </p>
                      
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block">Moisture Skip Threshold</label>
                          <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg">
                            {moistureSkipThreshold === 100 ? 'Disabled' : `${moistureSkipThreshold}%`}
                          </span>
                        </div>
                        <div className="flex gap-4 items-center">
                          <input
                            type="range"
                            min="10"
                            max="100"
                            step="5"
                            value={moistureSkipThreshold}
                            onChange={(e) => setMoistureSkipThreshold(parseInt(e.target.value, 10))}
                            className="flex-1 accent-blue-600 cursor-pointer"
                          />
                          <button
                            onClick={handleMoistureSkipSave}
                            disabled={togglingConfig}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-1.5 text-xs rounded-xl cursor-pointer shadow-sm active:scale-95 transition-all w-fit disabled:opacity-50"
                          >
                            Save Threshold
                          </button>
                        </div>
                        {!deviceStatus.active && (
                          <span className="text-[10px] text-amber-500 font-semibold mt-1.5 block">⚠️ Offline: Saved changes are pending sync</span>
                        )}
                      </div>
                    </div>

                    {/* Watchdog Safety Card */}
                    <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-4">
                      <div className="flex items-center gap-2 border-b pb-2 text-zinc-800">
                        <Settings className="w-4 h-4 text-blue-500" />
                        <h5 className="text-[11px] font-bold uppercase tracking-wider">Pump Safety Watchdog</h5>
                      </div>
                      <p className="text-[11px] text-zinc-500">
                        The maximum safety duration a pump is allowed to run continuously. The ESP32 will force-shut the valve if this threshold is crossed to prevent flooding.
                      </p>
                      
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block">Max Run Watchdog Timeout</label>
                          <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg">
                            {pumpSafetyTimeout} seconds
                          </span>
                        </div>
                        <div className="flex gap-4 items-center">
                          <input
                            type="number"
                            min="10"
                            max="3600"
                            step="10"
                            value={pumpSafetyTimeout}
                            onChange={(e) => setPumpSafetyTimeout(parseInt(e.target.value, 10) || 300)}
                            className="flex-1 bg-zinc-50 border border-zinc-200 rounded-lg py-1.5 px-3 focus:outline-none font-mono text-xs text-zinc-800 focus:border-zinc-400 font-semibold"
                          />
                          <button
                            onClick={handlePumpSafetyTimeoutSave}
                            disabled={togglingConfig}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-1.5 text-xs rounded-xl cursor-pointer shadow-sm active:scale-95 transition-all w-fit disabled:opacity-50"
                          >
                            Save Timeout
                          </button>
                        </div>
                        {!deviceStatus.active && (
                          <span className="text-[10px] text-amber-500 font-semibold mt-1.5 block">⚠️ Offline: Saved changes are pending sync</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* 5. DYNAMIC WATERING SCHEDULES CONFIGURATION TAB */}
                {configTab === 'schedules' && (
                  <div className="space-y-6">
                    <h4 className="text-xs font-bold text-zinc-700 uppercase tracking-wider border-b pb-1.5">Manage Watering Schedules</h4>

                    {/* Schedule Form */}
                    <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 space-y-3 text-xs">
                      <span className="font-bold text-zinc-700 block text-[11px] uppercase tracking-wider">
                        {editingScheduleId ? 'Edit Watering Schedule' : 'Add Custom Watering Schedule'}
                      </span>
                      
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[9px] font-semibold text-zinc-500 uppercase">Time of Day</label>
                          <input
                            type="time"
                            value={schedTime}
                            onChange={(e) => setSchedTime(e.target.value)}
                            className="w-full bg-white border border-zinc-200 rounded-lg py-1 px-2 mt-0.5 focus:outline-none font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-semibold text-zinc-500 uppercase">Duration (Seconds)</label>
                          <input
                            type="number"
                            min="5"
                            max="600"
                            value={schedDuration}
                            onChange={(e) => setSchedDuration(parseInt(e.target.value, 10))}
                            className="w-full bg-white border border-zinc-200 rounded-lg py-1 px-2 mt-0.5 focus:outline-none font-mono"
                          />
                        </div>
                      </div>

                      {/* Multi-flow Selection Toggles */}
                      {data.flows && data.flows.length > 0 && (
                        <div className="space-y-1.5">
                          <label className="text-[9px] font-semibold text-zinc-500 uppercase block">Target Watering Flows (Zones)</label>
                          <div className="flex flex-wrap gap-1.5 mt-0.5">
                            {data.flows.map(f => {
                              const isSelected = schedFlowIds.includes(f.id);
                              return (
                                <button
                                  key={f.id}
                                  type="button"
                                  onClick={() => {
                                    if (isSelected) {
                                      setSchedFlowIds(prev => prev.filter(v => v !== f.id));
                                    } else {
                                      setSchedFlowIds(prev => [...prev, f.id].sort());
                                      setSchedPumpIds([]); // Clear direct pumps to avoid mixing types
                                    }
                                  }}
                                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer ${
                                    isSelected ? 'bg-blue-600 border-blue-600 text-white shadow-sm' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                                  }`}
                                >
                                  {f.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Multi-pump Selection Toggles */}
                      <div className="space-y-1.5">
                        <label className="text-[9px] font-semibold text-zinc-500 uppercase block">Target Pumps (Direct Fallback)</label>
                        <div className="flex flex-wrap gap-1.5 mt-0.5">
                          {data.pumps.map(p => {
                            const isSelected = schedPumpIds.includes(p.id);
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => {
                                  if (isSelected) {
                                    setSchedPumpIds(prev => prev.filter(v => v !== p.id));
                                  } else {
                                    setSchedPumpIds(prev => [...prev, p.id].sort());
                                    setSchedFlowIds([]); // Clear flows to avoid mixing types
                                  }
                                }}
                                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer ${
                                  isSelected ? 'bg-blue-600 border-blue-600 text-white shadow-sm' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                                }`}
                              >
                                {p.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Pulse Watering: Cycles & Soak Settings */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[9px] font-semibold text-zinc-500 uppercase">Watering Cycles (Repeats)</label>
                          <input
                            type="number"
                            min="1"
                            max="10"
                            value={schedCycles}
                            onChange={(e) => setSchedCycles(Math.max(1, parseInt(e.target.value, 10) || 1))}
                            className="w-full bg-white border border-zinc-200 rounded-lg py-1.5 px-2.5 mt-0.5 focus:outline-none font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-semibold text-zinc-500 uppercase">Soak Duration (Seconds)</label>
                          <input
                            type="number"
                            min="0"
                            max="3600"
                            step="10"
                            value={schedSoak}
                            onChange={(e) => setSchedSoak(Math.max(0, parseInt(e.target.value, 10) || 0))}
                            className="w-full bg-white border border-zinc-200 rounded-lg py-1.5 px-2.5 mt-0.5 focus:outline-none font-mono"
                          />
                        </div>
                      </div>

                      {/* Days of Week Select Toggles */}
                      <div className="space-y-1.5">
                        <label className="text-[9px] font-semibold text-zinc-500 uppercase block">Active Days</label>
                        <div className="flex flex-wrap gap-1.5 mt-0.5">
                          {[
                            { val: 1, label: 'Mon' },
                            { val: 2, label: 'Tue' },
                            { val: 3, label: 'Wed' },
                            { val: 4, label: 'Thu' },
                            { val: 5, label: 'Fri' },
                            { val: 6, label: 'Sat' },
                            { val: 7, label: 'Sun' }
                          ].map(d => {
                            const isSelected = schedDays.includes(d.val);
                            return (
                              <button
                                key={d.val}
                                type="button"
                                onClick={() => {
                                  if (isSelected) {
                                    setSchedDays(prev => prev.filter(v => v !== d.val));
                                  } else {
                                    setSchedDays(prev => [...prev, d.val].sort());
                                  }
                                }}
                                className={`px-2.5 h-8 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer ${
                                  isSelected ? 'bg-blue-600 border-blue-600 text-white shadow-sm' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                                }`}
                              >
                                {d.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-1">
                        {editingScheduleId && (
                          <button
                            onClick={() => {
                              setEditingScheduleId(null);
                              setSchedPumpIds([]);
                              setSchedFlowIds([]);
                              setSchedTime('07:00');
                              setSchedDuration(120);
                              setSchedDays([1, 2, 3, 4, 5, 6, 7]);
                              setSchedEnabled(true);
                              setSchedCycles(1);
                              setSchedSoak(0);
                            }}
                            className="bg-white border border-zinc-200 px-3 py-1.5 text-xs font-semibold rounded-lg"
                          >
                            Cancel
                          </button>
                        )}
                        <button
                          onClick={handleScheduleSave}
                          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-3 py-1.5 text-xs rounded-lg active:scale-95 transition-all shadow-sm"
                        >
                          {editingScheduleId ? 'Update Schedule' : 'Add Schedule'}
                        </button>
                      </div>
                    </div>

                    {/* Schedules List */}
                    <div className="space-y-2">
                      <span className="font-bold text-zinc-700 block text-[10px] uppercase tracking-wider">Configured Schedules</span>
                      {data.schedules && data.schedules.length === 0 ? (
                        <div className="text-center py-4 text-xs text-zinc-400 italic">No schedules defined yet.</div>
                      ) : (
                        data.schedules?.map(sched => {
                          const daysMap = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };
                          const activeDaysStr = sched.days_of_week.map(d => daysMap[d]).join(', ');
                          
                          return (
                            <div key={sched.id} className="flex justify-between items-center text-xs bg-white border border-zinc-200 p-3 rounded-xl shadow-sm">
                              <div>
                                <span className={`font-bold block ${sched.enabled ? 'text-zinc-800' : 'text-zinc-400 line-through'}`}>
                                  {sched.flow_name ? `Zone: ${sched.flow_name}` : sched.pump_name} at {sched.time_of_day.substring(0, 5)}
                                </span>
                                <span className="text-[10px] text-zinc-400">
                                  Days: {activeDaysStr} | Duration: {sched.duration_seconds}s {sched.cycles > 1 ? `| Cycles: ${sched.cycles} (Soak: ${sched.soak_duration_seconds}s)` : ''}
                                </span>
                              </div>
                              <div className="flex items-center gap-3">
                                {/* Pause / Resume Switch */}
                                <button
                                  type="button"
                                  title={sched.enabled ? "Pause schedule" : "Resume schedule"}
                                  onClick={async () => {
                                    try {
                                      const nextEnabled = !sched.enabled;
                                      const res = await fetch('/api/schedule', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                          id: sched.id,
                                          pump_ids: sched.pump_ids,
                                          flow_ids: sched.flow_ids,
                                          time_of_day: sched.time_of_day,
                                          duration_seconds: sched.duration_seconds,
                                          days_of_week: sched.days_of_week,
                                          enabled: nextEnabled,
                                          cycles: sched.cycles || 1,
                                          soak_duration_seconds: sched.soak_duration_seconds || 0
                                        })
                                      });
                                      if (res.ok) {
                                        showToast(`Schedule ${nextEnabled ? 'enabled' : 'paused'}.`, 'success');
                                        fetchDashboardData();
                                      } else {
                                        showToast('Failed to toggle schedule status.', 'error');
                                      }
                                    } catch (err) {
                                      showToast('Error toggling schedule.', 'error');
                                    }
                                  }}
                                  className={`relative inline-flex h-4.5 w-8 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${sched.enabled ? 'bg-blue-600' : 'bg-zinc-200'}`}
                                >
                                  <span className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition duration-200 ease-in-out ${sched.enabled ? 'translate-x-3.5' : 'translate-x-0'}`} />
                                </button>
                                
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => {
                                      setEditingScheduleId(sched.id);
                                      setSchedPumpIds(sched.pump_ids || []);
                                      setSchedFlowIds(sched.flow_ids || []);
                                      setSchedTime(sched.time_of_day.substring(0, 5));
                                      setSchedDuration(sched.duration_seconds);
                                      setSchedDays(sched.days_of_week);
                                      setSchedEnabled(sched.enabled);
                                      setSchedCycles(sched.cycles || 1);
                                      setSchedSoak(sched.soak_duration_seconds || 0);
                                    }}
                                    className="p-1.5 border border-zinc-100 hover:border-zinc-200 hover:bg-zinc-50 rounded-lg text-zinc-600 transition"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleScheduleDelete(sched.id)}
                                    className="p-1.5 border border-zinc-100 hover:border-zinc-200 hover:bg-red-50 text-red-500 rounded-lg transition"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-zinc-100 bg-zinc-50/50 p-4 flex justify-end">
              <button
                onClick={() => { setIsConfigOpen(false); fetchDashboardData(); }}
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2 text-xs rounded-xl cursor-pointer shadow-sm active:scale-95 transition-all"
              >
                Done
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Dynamic Confirmation Modal */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-zinc-200 shadow-xl max-w-md w-full p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="space-y-1.5">
              <h4 className="text-sm font-semibold text-zinc-900">{confirmDialog.title}</h4>
              <p className="text-xs text-zinc-500 leading-normal">{confirmDialog.message}</p>
            </div>
            <div className="flex justify-end gap-2 text-xs pt-1">
              <button
                onClick={() => setConfirmDialog(null)}
                className="bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700 font-semibold px-3 py-1.5 rounded-lg cursor-pointer transition active:scale-95"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
                className={`text-white font-semibold px-3 py-1.5 rounded-lg cursor-pointer transition active:scale-95 ${
                  confirmDialog.type === 'danger'
                    ? 'bg-red-600 hover:bg-red-700'
                    : confirmDialog.type === 'warning'
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-zinc-900 hover:bg-zinc-800'
                }`}
              >
                {confirmDialog.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification Container */}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center gap-3 px-4 py-3 bg-white border rounded-xl shadow-lg transition-all duration-300 animate-in fade-in slide-in-from-bottom-2 ${
              toast.type === 'error'
                ? 'border-red-100 text-red-800'
                : toast.type === 'warning'
                ? 'border-amber-100 text-amber-800'
                : 'border-zinc-200 text-zinc-800'
            }`}
          >
            {toast.type === 'success' && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
            )}
            {toast.type === 'error' && (
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
            )}
            {toast.type === 'warning' && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
            )}
            <span className="text-xs font-medium">{toast.message}</span>
          </div>
        ))}
      </div>

      {/* Notes Modal */}
      <NotesModal isOpen={isNotesOpen} onClose={() => setIsNotesOpen(false)} />

    </div>
  );
}
