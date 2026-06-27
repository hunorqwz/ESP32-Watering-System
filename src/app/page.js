'use client';

import { useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';
import { Cylinder, Thermometer, Droplets, Sprout, RefreshCw, Settings, X, Plus, Trash2, Edit2, Wifi } from 'lucide-react';

export default function Dashboard() {
  const refreshIntervalRef = useRef(null);
  const [data, setData] = useState({
    sensors: [],
    pumps: [],
    latest_readings: {},
    history_readings: [],
    configs: {},
    device_status: { active: false, last_seen_seconds: null, interval_minutes: 15 }
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

  // Configuration Manager Modal States
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [configTab, setConfigTab] = useState('network'); // 'network', 'sensors', 'pumps', 'general'

  // Forms
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [customInterval, setCustomInterval] = useState(15);
  const [intervalUnit, setIntervalUnit] = useState('minutes');

  // Sensor Form
  const [editingSensorId, setEditingSensorId] = useState(null);
  const [sensorName, setSensorName] = useState('');
  const [sensorType, setSensorType] = useState('moisture');
  const [sensorPin, setSensorPin] = useState(32);
  const [sensorGroup, setSensorGroup] = useState('Soil Moisture');
  const [sensorDryLimit, setSensorDryLimit] = useState(3400);
  const [sensorWetLimit, setSensorWetLimit] = useState(1100);

  // Pump Form
  const [editingPumpId, setEditingPumpId] = useState(null);
  const [pumpName, setPumpName] = useState('');
  const [pumpPin, setPumpPin] = useState(25);

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
          if (json.configs) {
            setWifiSsid(json.configs['wifi_ssid'] || '');
            setWifiPassword(json.configs['wifi_password'] || '');
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
      }, 10000);
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

  // WebSockets Real-Time Push connection
  useEffect(() => {
    let client = null;
    let active = true;

    const initMqtt = async () => {
      try {
        const res = await fetch('/api/mqtt-auth');
        if (!res.ok) {
          throw new Error('MQTT credentials not found or not configured.');
        }
        const authData = await res.json();
        if (!authData.success || !authData.username || !authData.password) {
          throw new Error('MQTT credentials payload is incomplete.');
        }

        if (!active) return; // Prevent connecting if component unmounted while fetching

        const brokerUrl = 'wss://bcc1fdaf.ala.eu-central-1.emqxsl.com:8084/mqtt';
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
      const results = await Promise.all([
        fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'wifi_ssid', value: wifiSsid })
        }),
        fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'wifi_password', value: wifiPassword })
        })
      ]);

      const jsonResults = await Promise.all(results.map(r => r.json().catch(() => ({ success: false }))));
      const allSuccess = jsonResults.every(r => r.success);

      if (allSuccess) {
        showToast('WiFi settings updated successfully.', 'success');
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
          showToast(`Telemetry update rate set to ${customInterval} ${intervalUnit}.`, 'success');
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
    let totalMinutes = parseInt(customInterval, 10);
    if (isNaN(totalMinutes) || totalMinutes <= 0) {
      showToast('Please enter a valid positive telemetry sleep value.', 'error');
      return;
    }
    if (intervalUnit === 'hours') {
      totalMinutes = totalMinutes * 60;
    }

    setConfirmDialog({
      title: 'Update Telemetry Rate?',
      message: `Are you sure you want to change the sleep cycle of the ESP32 to run every ${customInterval} ${intervalUnit}? Shorter intervals fetch data quicker but draw more battery power and increase database write operations.`,
      confirmLabel: 'Update Rate',
      type: 'info',
      onConfirm: () => triggerCustomIntervalSave(totalMinutes)
    });
  };

  // Sensor Add/Edit Save
  const handleSensorSave = async () => {
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
          sensor_group: sensorGroup || 'General',
          dry_limit: sensorType === 'moisture' || sensorType === 'water_level' ? parseInt(sensorDryLimit, 10) : null,
          wet_limit: sensorType === 'moisture' || sensorType === 'water_level' ? parseInt(sensorWetLimit, 10) : null
        })
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          showToast(editingSensorId ? 'Sensor updated successfully.' : 'New sensor added successfully.', 'success');
          setEditingSensorId(null);
          setSensorName('');
          setSensorType('moisture');
          setSensorPin(32);
          setSensorGroup('Soil Moisture');
          setSensorDryLimit(3400);
          setSensorWetLimit(1100);
          await fetchDashboardData();
        } else {
          showToast(json.error || 'Failed to save sensor configuration.', 'error');
        }
      } else {
        showToast('Server failed to save sensor.', 'error');
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
          pin: parseInt(pumpPin, 10)
        })
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          showToast(editingPumpId ? 'Pump updated successfully.' : 'New pump added successfully.', 'success');
          setEditingPumpId(null);
          setPumpName('');
          setPumpPin(25);
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
    const emptyDist = waterSensor?.dry_limit || 100;
    const fullDist = waterSensor?.wet_limit || 0;
    const useDimensions = data.configs['reservoir_use_dimensions'] === 'true';
    const totalVolume = data.configs['reservoir_total_volume_liters'] ? parseFloat(data.configs['reservoir_total_volume_liters']) : 100;
    const width = data.configs['reservoir_width_cm'] ? parseFloat(data.configs['reservoir_width_cm']) : 60;
    const length = data.configs['reservoir_length_cm'] ? parseFloat(data.configs['reservoir_length_cm']) : 70;

    if (rawDistance === undefined || rawDistance === null) {
      return { percentage: 0, liters: 0, height: 0, capacity: totalVolume };
    }

    let span = 0;
    let height = 0;

    if (emptyDist > fullDist) {
      span = emptyDist - fullDist;
      height = emptyDist - rawDistance;
    } else {
      span = fullDist - emptyDist;
      height = rawDistance - emptyDist;
    }

    if (span <= 0) return { percentage: 0, liters: 0, height: 0, capacity: totalVolume };

    if (height < 0) height = 0;
    if (height > span) height = span;

    const percentage = Math.min(100, Math.max(0, Math.round((height / span) * 100)));
    let liters = 0;
    let capacity = totalVolume;

    if (useDimensions) {
      capacity = Math.round((width * length * span) / 100) / 10;
      liters = Math.round((width * length * height) / 100) / 10;
    } else {
      liters = Math.round((totalVolume * (percentage / 100)) * 10) / 10;
    }

    return {
      percentage,
      liters,
      height: Math.round(height * 10) / 10,
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

        {/* Middle Tier: Soil Moisture (Dynamic list) */}
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

        {/* Bottom Tier: Dynamic Pump Controls */}
        <div className="space-y-3">
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
                
                return (
                  <div key={pump.id} className={`border rounded-xl p-5 flex justify-between items-center ${isActive ? 'bg-emerald-50/40 border-emerald-200 shadow-sm' : 'bg-white border-zinc-200 shadow-sm'}`}>
                    <div className="flex items-center gap-3">
                      <svg className={`w-5 h-5 ${isActive ? 'text-emerald-500' : 'text-zinc-300'}`} fill="none" viewBox="0 0 24 24" strokeWidth="2.2" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 9h5v8H5z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 9V4h2v5M5 3h4" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 9l2-2h7a4 4 0 014 4v2a4 4 0 01-4 4h-7l-2-2v-6z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14 7.5v9" />
                      </svg>
                      <div>
                        <span className="text-sm font-semibold text-zinc-800 block leading-tight">{pump.name}</span>
                        <span className="text-[8px] text-zinc-400 font-mono">Pin: {pump.pin}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handlePumpToggle(pump.id, pump.pin)}
                      disabled={isToggling}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isActive ? 'bg-emerald-500' : 'bg-zinc-200'} ${isToggling ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition duration-200 ease-in-out ${isActive ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Settings */}
        <footer className="flex justify-between items-center text-[10px] text-zinc-400 pt-6 border-t border-zinc-200">
          <div>
            <span>Terrace Irrigation Control System Dashboard</span>
          </div>
          <button
            onClick={() => setIsConfigOpen(true)}
            className="flex items-center gap-1.5 hover:text-zinc-600 transition cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-zinc-500 bg-transparent border-0"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Configure Panel</span>
          </button>
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
                  { id: 'pumps', label: 'Pumps', icon: Settings },
                  { id: 'general', label: 'General Settings', icon: Cylinder }
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

                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="text-[9px] font-semibold text-zinc-500 uppercase">ESP32 Pin</label>
                          <input
                            type="number"
                            value={sensorPin}
                            onChange={(e) => setSensorPin(e.target.value)}
                            className="w-full bg-white border border-zinc-200 rounded-lg py-1 px-2.5 mt-0.5 focus:outline-none font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-semibold text-zinc-500 uppercase">Group Name</label>
                          <input
                            type="text"
                            placeholder="e.g. Soil Moisture"
                            value={sensorGroup}
                            onChange={(e) => setSensorGroup(e.target.value)}
                            className="w-full bg-white border border-zinc-200 rounded-lg py-1 px-2.5 mt-0.5 focus:outline-none"
                          />
                        </div>
                        {(sensorType === 'moisture' || sensorType === 'water_level') && (
                          <div className="flex gap-2 col-span-3">
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
                      </div>

                      <div className="flex justify-end gap-2 pt-1">
                        {editingSensorId && (
                          <button
                            onClick={() => {
                              setEditingSensorId(null);
                              setSensorName('');
                              setSensorPin(32);
                              setSensorGroup('Soil Moisture');
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
                              Type: {sensor.type} | Pin: {sensor.pin} | Group: {sensor.sensor_group}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setEditingSensorId(sensor.id);
                                setSensorName(sensor.name);
                                setSensorType(sensor.type);
                                setSensorPin(sensor.pin);
                                setSensorGroup(sensor.sensor_group);
                                setSensorDryLimit(sensor.dry_limit || 3400);
                                setSensorWetLimit(sensor.wet_limit || 1100);
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
                      <div className="grid grid-cols-2 gap-3">
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
                      </div>

                      <div className="flex justify-end gap-2 pt-1">
                        {editingPumpId && (
                          <button
                            onClick={() => {
                              setEditingPumpId(null);
                              setPumpName('');
                              setPumpPin(25);
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
                            <span className="text-[10px] text-zinc-400 font-mono">Pin Assignment: {pump.pin}</span>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setEditingPumpId(pump.id);
                                setPumpName(pump.name);
                                setPumpPin(pump.pin);
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

                {/* 4. GENERAL SYSTEM CONFIG TAB */}
                {configTab === 'general' && (
                  <div className="space-y-6">
                    <h4 className="text-xs font-bold text-zinc-700 uppercase tracking-wider border-b pb-1.5">General Config</h4>
                    
                    <div className="space-y-3">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">Telemetry Sleep Cycle</label>
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

    </div>
  );
}
