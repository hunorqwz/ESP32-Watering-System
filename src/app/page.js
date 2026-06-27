'use client';

import { useState, useEffect } from 'react';
import { Cylinder, Thermometer, Droplets, Sprout, RefreshCw, Settings, X } from 'lucide-react';

export default function Dashboard() {
  const [data, setData] = useState({ current: null });
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState({
    active: false,
    last_seen_seconds: null,
    interval_minutes: 15
  });
  const [togglingConfig, setTogglingConfig] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pumps, setPumps] = useState({
    1: false,
    2: false,
    3: false,
    4: false
  });
  const [togglingPumps, setTogglingPumps] = useState({
    1: false,
    2: false,
    3: false,
    4: false
  });
  const [configs, setConfigs] = useState({});
  const [isCalibrateOpen, setIsCalibrateOpen] = useState(false);
  const [tempConfigs, setTempConfigs] = useState({});
  const [isReservoirOpen, setIsReservoirOpen] = useState(false);

  const fetchDashboardData = async () => {
    try {
      const res = await fetch('/api/dashboard');
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setData({ current: json.current });
          setConnected(true);
          
          if (json.device_status) {
            setDeviceStatus(json.device_status);
          }
          if (json.configs) {
            setConfigs(json.configs);
          }
          
          // Sync state from active command log logs if successful
          if (json.commands && json.commands.length > 0) {
            const pumpState = { 1: false, 2: false, 3: false, 4: false };
            const seen = new Set();
            for (const cmd of json.commands) {
              if (cmd.status === 'success' && !seen.has(cmd.pump)) {
                pumpState[cmd.pump] = cmd.state === 1;
                seen.add(cmd.pump);
              }
            }
            setPumps(pumpState);
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

  useEffect(() => {
    fetchDashboardData();
    // Poll every 10 seconds for real-time telemetry updates
    const interval = setInterval(() => {
      fetchDashboardData();
    }, 10000);

    // Register service worker for PWA support only in production.
    // In development, actively unregister any service workers to prevent cache lockups.
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
              window.location.reload();
            });
          }
        });
      }
    }

    return () => clearInterval(interval);
  }, []);

  const handlePumpToggle = async (pumpId) => {
    if (togglingPumps[pumpId]) return;
    
    const nextState = !pumps[pumpId];
    
    // Set toggling state
    setTogglingPumps(prev => ({ ...prev, [pumpId]: true }));
    
    try {
      const res = await fetch('/api/command', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          pump: parseInt(pumpId),
          state: nextState ? 1 : 0
        })
      });
      
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setPumps(prev => ({ ...prev, [pumpId]: nextState }));
        } else {
          console.error('Command rejected:', json.error);
        }
      }
    } catch (err) {
      console.error('Failed to send command:', err);
    } finally {
      setTogglingPumps(prev => ({ ...prev, [pumpId]: false }));
    }
  };

  const handleIntervalChange = async (newInterval) => {
    if (togglingConfig) return;
    
    setTogglingConfig(true);
    
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          key: 'telemetry_interval_minutes',
          value: String(newInterval)
        })
      });
      
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setDeviceStatus(prev => ({ 
            ...prev, 
            interval_minutes: parseInt(newInterval, 10) 
          }));
          // Immediately trigger status refresh
          fetchDashboardData();
        }
      }
    } catch (err) {
      console.error('Failed to update telemetry interval:', err);
    } finally {
      setTogglingConfig(false);
    }
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    
    setRefreshing(true);
    try {
      const res = await fetch('/api/refresh', {
        method: 'POST'
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          // Immediately trigger dashboard data fetch to retrieve the latest state
          await fetchDashboardData();
        } else {
          console.error('Refresh command rejected:', json.error);
        }
      }
    } catch (err) {
      console.error('Failed to trigger telemetry refresh:', err);
    } finally {
      setRefreshing(false);
    }
  };

  const handleConfigSave = async (key, val) => {
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ key, value: String(val) })
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setConfigs(prev => ({ ...prev, [key]: String(val) }));
        }
      }
    } catch (err) {
      console.error('Failed to update config setting:', err);
    }
  };

  const handleConfigSaveAll = async () => {
    try {
      const keysToSave = Object.keys(tempConfigs);
      if (keysToSave.length > 0) {
        await Promise.all(
          keysToSave.map(key =>
            fetch('/api/config', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ key, value: String(tempConfigs[key]) })
            })
          )
        );
        setConfigs(prev => ({ ...prev, ...tempConfigs }));
      }
      setIsCalibrateOpen(false);
      setIsReservoirOpen(false);
      setTempConfigs({});
    } catch (err) {
      console.error('Failed to save all configurations:', err);
    }
  };

  const getReservoirStats = (rawDistance) => {
    if (rawDistance === undefined || rawDistance === null) {
      return { percentage: 0, liters: 0, height: 0, capacity: 100 };
    }

    const emptyDist = configs['reservoir_empty_distance_cm'] 
      ? parseFloat(configs['reservoir_empty_distance_cm']) 
      : 100;
    const fullDist = configs['reservoir_full_distance_cm'] 
      ? parseFloat(configs['reservoir_full_distance_cm']) 
      : 0;
    const useDimensions = configs['reservoir_use_dimensions'] === 'true';
    const totalVolume = configs['reservoir_total_volume_liters'] 
      ? parseFloat(configs['reservoir_total_volume_liters']) 
      : 100;
    const width = configs['reservoir_width_cm'] 
      ? parseFloat(configs['reservoir_width_cm']) 
      : 60;
    const length = configs['reservoir_length_cm'] 
      ? parseFloat(configs['reservoir_length_cm']) 
      : 70;

    let span = 0;
    let height = 0;

    if (emptyDist > fullDist) {
      // Top-mounted distance sensor (reading decreases as water rises)
      span = emptyDist - fullDist;
      height = emptyDist - rawDistance;
    } else {
      // Bottom-mounted height sensor or direct reading (reading increases as water rises)
      span = fullDist - emptyDist;
      height = rawDistance - emptyDist;
    }

    if (span <= 0) {
      return { percentage: 0, liters: 0, height: 0, capacity: totalVolume };
    }

    if (height < 0) height = 0;
    if (height > span) height = span;

    // Percentage of water
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

  const current = data.current;
  const isStale = !connected || !deviceStatus.active;
  const resStats = getReservoirStats(current?.water_level);

  const renderLastSeenText = () => {
    const elapsed = deviceStatus.last_seen_seconds;
    if (elapsed === null) return 'Never seen';
    if (elapsed < 60) return 'Just now';
    if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`;
    return `${Math.floor(elapsed / 3600)}h ago`;
  };

  const mapMoistureToPercentage = (rawValue, sensorKey) => {
    if (rawValue === undefined || rawValue === null) return 0;
    
    // Fallback defaults: Dry = 3400 (Max), Wet = 1100 (Min)
    const dryLimit = configs[`sensor_${sensorKey}_dry`] 
      ? parseInt(configs[`sensor_${sensorKey}_dry`], 10) 
      : 3400;
    const wetLimit = configs[`sensor_${sensorKey}_wet`] 
      ? parseInt(configs[`sensor_${sensorKey}_wet`], 10) 
      : 1100;
      
    if (dryLimit === wetLimit) return 0;
    
    if (dryLimit > wetLimit) {
      if (rawValue >= dryLimit) return 0;
      if (rawValue <= wetLimit) return 100;
      const percentage = ((dryLimit - rawValue) / (dryLimit - wetLimit)) * 100;
      return Math.round(percentage);
    } else {
      if (rawValue <= dryLimit) return 0;
      if (rawValue >= wetLimit) return 100;
      const percentage = ((rawValue - dryLimit) / (wetLimit - dryLimit)) * 100;
      return Math.round(percentage);
    }
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

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex justify-between items-center border-b border-zinc-200 pb-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Terrace System</h1>
            <p className="text-xs text-zinc-500">Live Telemetry & Irrigation Controls</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="flex items-center justify-end gap-1.5">
                <span className={`w-2 h-2 rounded-full ${connected && deviceStatus.active ? 'bg-green-500' : 'bg-zinc-300 animate-pulse'}`}></span>
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                  {!connected 
                    ? 'Syncing' 
                    : deviceStatus.active 
                      ? 'ESP32 Active' 
                      : 'ESP32 Offline'}
                </span>
              </div>
              <span className="text-[10px] text-zinc-400 font-medium block mt-0.5">
                Last Report: {renderLastSeenText()}
              </span>
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing || !connected}
              className="flex items-center gap-1.5 bg-white border border-zinc-200 hover:border-zinc-300 text-zinc-700 hover:text-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 px-3 py-1.5 text-xs font-semibold rounded-lg shadow-sm active:scale-95 disabled:active:scale-100 cursor-pointer"
              title="Request telemetry update from ESP32"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} strokeWidth={2.2} />
              <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
          </div>
        </header>

        {/* Top Tier: Summary metrics (Reservoir Level, Temp, Humidity) */}
        <div className={`grid grid-cols-3 gap-4 transition-opacity duration-300 ${isStale ? 'opacity-60' : ''}`}>
          {/* Reservoir Level */}
          <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-2 relative overflow-hidden flex flex-col justify-between">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-black uppercase tracking-wider font-semibold block">Reservoir Level</span>
                  <button 
                    onClick={() => {
                      setTempConfigs({});
                      setIsReservoirOpen(true);
                    }}
                    className="text-zinc-400 hover:text-zinc-600 transition-colors cursor-pointer p-0.5 rounded hover:bg-zinc-50"
                    title="Open Reservoir Settings"
                  >
                    <Settings className="w-3 h-3" />
                  </button>
                </div>
                {loading || !current || current.water_level === undefined || current.water_level === null ? (
                  <div className="h-8 w-20 bg-zinc-100 rounded animate-pulse mt-1"></div>
                ) : (
                  <div className="text-2xl font-bold tracking-tight text-zinc-900 mt-1">
                    {resStats.percentage}%
                  </div>
                )}
              </div>
              <Cylinder className={`w-6 h-6 ${resStats.percentage < 20 ? 'text-red-500' : 'text-zinc-400'}`} />
            </div>
            
            {/* Subtext info row */}
            {!loading && current && current.water_level !== undefined && current.water_level !== null && (
              <div className="text-[10px] text-zinc-500 font-medium flex justify-between items-center w-full mt-1">
                <span>{resStats.liters}L / {resStats.capacity}L</span>
                <span className="text-zinc-300">|</span>
                <span>{resStats.height} cm height</span>
              </div>
            )}

            {resStats.percentage < 20 && !loading && current && (
              <span className="text-[9px] text-red-500 font-semibold block animate-pulse">Low Water Alert</span>
            )}
          </div>

          {/* Temp */}
          <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-1 relative overflow-hidden">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] text-black uppercase tracking-wider font-semibold block">Temperature</span>
                {loading || !current || current.temp === undefined || current.temp === null ? (
                  <div className="h-8 w-20 bg-zinc-100 rounded animate-pulse mt-1"></div>
                ) : (
                  <div className="text-2xl font-bold tracking-tight text-zinc-900 mt-1">{Number(current.temp).toFixed(1)}°C</div>
                )}
              </div>
              <Thermometer className="w-6 h-6 text-zinc-400" />
            </div>
          </div>

          {/* Humidity */}
          <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-1 relative overflow-hidden">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] text-black uppercase tracking-wider font-semibold block">Humidity</span>
                {loading || !current || current.hum === undefined || current.hum === null ? (
                  <div className="h-8 w-20 bg-zinc-100 rounded animate-pulse mt-1"></div>
                ) : (
                  <div className="text-2xl font-bold tracking-tight text-zinc-900 mt-1">{Number(current.hum).toFixed(1)}%</div>
                )}
              </div>
              <Droplets className="w-6 h-6 text-zinc-400" />
            </div>
          </div>
        </div>

        {/* Middle Tier: 5 uniform data cards for Soil Moisture (Zones 1-5) */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-[10px] text-black uppercase tracking-wider font-bold">Soil Moisture</h2>
            <button 
              onClick={() => {
                setTempConfigs({});
                setIsCalibrateOpen(true);
              }}
              className="text-zinc-400 hover:text-zinc-600 transition-colors cursor-pointer p-0.5 rounded hover:bg-zinc-100"
              title="Open Moisture Calibration Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className={`grid grid-cols-1 sm:grid-cols-5 gap-4 transition-opacity duration-300 ${isStale ? 'opacity-60' : ''}`}>
            {[
              { id: 1, key: 'm1', label: 'Zone 1' },
              { id: 2, key: 'm2', label: 'Zone 2' },
              { id: 3, key: 'm3', label: 'Zone 3' },
              { id: 4, key: 'm4', label: 'Zone 4' },
              { id: 5, key: 'm5', label: 'Zone 5' },
            ].map((zone) => {
              const val = current ? current[zone.key] : undefined;
              const hasVal = val !== undefined && val !== null;
              const percentage = hasVal ? mapMoistureToPercentage(Number(val), zone.key) : 0;
              const status = getMoistureStatus(percentage);
              const barColor = getProgressBarColorClass(percentage);
              
              return (
                <div key={zone.id} className="bg-white border border-zinc-200 rounded-xl p-4 shadow-sm space-y-3 flex flex-col justify-between">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-[9px] font-bold text-black uppercase tracking-wider">{zone.label}</span>
                      {loading || !hasVal ? (
                        <div className="h-6 w-12 bg-zinc-100 rounded animate-pulse mt-0.5"></div>
                      ) : (
                        <div className="flex items-baseline gap-1 mt-0.5">
                          <span className="text-lg font-bold text-zinc-800">{percentage}%</span>
                          <span className={`text-[9px] uppercase tracking-wider ${status.color}`}>{status.label}</span>
                        </div>
                      )}
                    </div>
                    <Sprout className="w-5 h-5 text-zinc-400" />
                  </div>
                  <div className="w-full bg-zinc-100 rounded-full h-1 mt-1">
                    {loading || !hasVal ? (
                      <div className="h-1 bg-zinc-200 rounded-full w-1/2 animate-pulse"></div>
                    ) : (
                      <div 
                        className={`${barColor} h-1 rounded-full transition-all duration-500`} 
                        style={{ width: `${percentage}%` }}
                      ></div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom Tier: 4 distinct toggle switches for Pump Controls */}
        <div className="space-y-3">
          <h2 className="text-[10px] text-black uppercase tracking-wider font-bold">Pump Controls</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { id: 1, label: 'Pump 1' },
              { id: 2, label: 'Pump 2' },
              { id: 3, label: 'Pump 3' },
              { id: 4, label: 'Pump 4' },
            ].map((pump) => {
              const isActive = pumps[pump.id];
              const isToggling = togglingPumps[pump.id];
              
              return (
                <div 
                  key={pump.id} 
                  className={`border rounded-xl p-5 flex justify-between items-center ${
                    isActive 
                      ? 'bg-emerald-50/40 border-emerald-200 shadow-sm' 
                      : 'bg-white border-zinc-200 shadow-sm'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <svg className={`w-5 h-5 ${isActive ? 'text-emerald-500' : 'text-zinc-300'}`} fill="none" viewBox="0 0 24 24" strokeWidth="2.2" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 9h5v8H5z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9V4h2v5M5 3h4" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12H2v2h3M1 11v4" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 9l2-2h7a4 4 0 014 4v2a4 4 0 01-4 4h-7l-2-2v-6z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14 7.5v9M17 7v10M20 8.5v7" />
                    </svg>
                    <div>
                      <span className="text-sm font-semibold text-zinc-800 block">{pump.label}</span>
                      <span className={`text-[9px] uppercase tracking-wider font-bold ${
                        isActive ? 'text-emerald-600' : 'text-zinc-400'
                      }`}>
                        {isActive ? 'On' : 'Off'}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handlePumpToggle(pump.id)}
                    disabled={isToggling}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      isActive ? 'bg-emerald-500' : 'bg-zinc-200'
                    } ${isToggling ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition duration-200 ease-in-out ${
                        isActive ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* System Configuration settings card */}
        <div className="space-y-3">
          <h2 className="text-[10px] text-black uppercase tracking-wider font-bold">System Configuration</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm flex justify-between items-center h-fit">
              <div>
                <span className="text-sm font-medium text-zinc-800 block">Telemetry Update Rate</span>
                <span className="text-[10px] text-zinc-400 block mt-0.5">Frequency of ESP32 sleep-wake reports</span>
              </div>
              <select
                value={deviceStatus.interval_minutes}
                disabled={togglingConfig}
                onChange={(e) => handleIntervalChange(e.target.value)}
                className="bg-zinc-50 border border-zinc-200 text-zinc-800 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-zinc-400 font-semibold cursor-pointer disabled:opacity-50"
              >
                <option value="5">Every 5 minutes</option>
                <option value="10">Every 10 minutes</option>
                <option value="15">Every 15 minutes</option>
                <option value="30">Every 30 minutes</option>
                <option value="60">Every 60 minutes</option>
              </select>
            </div>
          </div>
        </div>

      </div>

      {/* Moisture Calibration Dialog Modal */}
      {isCalibrateOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full border border-zinc-200 shadow-xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex justify-between items-center border-b border-zinc-100 p-5">
              <div>
                <h3 className="font-semibold text-zinc-900 text-sm">Moisture Calibration</h3>
                <p className="text-[10px] text-zinc-500 mt-0.5">Set the Dry (Air) and Wet (Water) analog limits</p>
              </div>
              <button 
                onClick={() => setIsCalibrateOpen(false)}
                className="text-zinc-400 hover:text-zinc-600 cursor-pointer p-1 rounded-lg hover:bg-zinc-50 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
              {[
                { key: 'm1', label: 'Zone 1' },
                { key: 'm2', label: 'Zone 2' },
                { key: 'm3', label: 'Zone 3' },
                { key: 'm4', label: 'Zone 4' },
                { key: 'm5', label: 'Zone 5' }
              ].map((sensor) => {
                const rawVal = current ? current[sensor.key] : null;
                const dryKey = `sensor_${sensor.key}_dry`;
                const wetKey = `sensor_${sensor.key}_wet`;
                
                const dry = tempConfigs[dryKey] !== undefined ? tempConfigs[dryKey] : (configs[dryKey] || '3400');
                const wet = tempConfigs[wetKey] !== undefined ? tempConfigs[wetKey] : (configs[wetKey] || '1100');

                return (
                  <div key={sensor.key} className="flex justify-between items-center text-xs border-b border-zinc-100 pb-3 last:border-0 last:pb-0">
                    <div>
                      <span className="font-semibold text-zinc-700 block">{sensor.label}</span>
                      <span className="text-[10px] text-zinc-400 font-mono">Raw: {rawVal !== null ? rawVal : 'N/A'}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <label className="text-[10px] text-black font-medium">Wet:</label>
                        <input 
                          type="number"
                          value={wet}
                          onChange={(e) => setTempConfigs(prev => ({ ...prev, [wetKey]: e.target.value }))}
                          className="w-16 bg-zinc-50 border border-zinc-200 rounded text-center py-1 px-1.5 font-mono text-[11px] focus:outline-none focus:border-zinc-400"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <label className="text-[10px] text-black font-medium">Dry:</label>
                        <input 
                          type="number"
                          value={dry}
                          onChange={(e) => setTempConfigs(prev => ({ ...prev, [dryKey]: e.target.value }))}
                          className="w-16 bg-zinc-50 border border-zinc-200 rounded text-center py-1 px-1.5 font-mono text-[11px] focus:outline-none focus:border-zinc-400"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="border-t border-zinc-100 bg-zinc-50/50 p-4 flex justify-end gap-2.5">
              <button
                onClick={() => setIsCalibrateOpen(false)}
                className="bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700 hover:text-zinc-955 font-semibold px-4 py-2 text-xs rounded-xl cursor-pointer shadow-sm active:scale-95 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleConfigSaveAll}
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 text-xs rounded-xl cursor-pointer shadow-sm active:scale-95 transition-all"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reservoir Calibration Dialog Modal */}
      {isReservoirOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full border border-zinc-200 shadow-xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex justify-between items-center border-b border-zinc-100 p-5">
              <div>
                <h3 className="font-semibold text-zinc-900 text-sm">Reservoir Settings</h3>
                <p className="text-[10px] text-zinc-500 mt-0.5">Configure tank specs & sensor bounds</p>
              </div>
              <button 
                onClick={() => setIsReservoirOpen(false)}
                className="text-zinc-400 hover:text-zinc-600 cursor-pointer p-1 rounded-lg hover:bg-zinc-50 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4">
              {/* Raw distance info */}
              <div className="flex justify-between items-center bg-zinc-50 rounded-xl p-3 border border-zinc-100 text-xs">
                <span className="text-zinc-500">Current Sensor Distance:</span>
                <span className="font-mono font-bold text-zinc-800">
                  {current && current.water_level !== null ? `${current.water_level} cm` : 'N/A'}
                </span>
              </div>

              {/* Min / Max bounds */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-black uppercase tracking-wider block font-bold">Empty Level (cm)</label>
                  <input 
                    type="number"
                    value={tempConfigs['reservoir_empty_distance_cm'] !== undefined ? tempConfigs['reservoir_empty_distance_cm'] : (configs['reservoir_empty_distance_cm'] || '100')}
                    onChange={(e) => setTempConfigs(prev => ({ ...prev, reservoir_empty_distance_cm: e.target.value }))}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-lg py-1.5 px-3 font-mono text-xs text-zinc-800 focus:outline-none focus:border-zinc-400"
                  />
                  <span className="text-[9px] text-zinc-400 block">Sensor to bottom</span>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-black uppercase tracking-wider block font-bold">Full Level (cm)</label>
                  <input 
                    type="number"
                    value={tempConfigs['reservoir_full_distance_cm'] !== undefined ? tempConfigs['reservoir_full_distance_cm'] : (configs['reservoir_full_distance_cm'] || '0')}
                    onChange={(e) => setTempConfigs(prev => ({ ...prev, reservoir_full_distance_cm: e.target.value }))}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-lg py-1.5 px-3 font-mono text-xs text-zinc-800 focus:outline-none focus:border-zinc-400"
                  />
                  <span className="text-[9px] text-zinc-400 block">Sensor to full level</span>
                </div>
              </div>

              {/* Mode Select */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-black uppercase tracking-wider block font-bold">Capacity Calculation Mode</label>
                <select
                  value={tempConfigs['reservoir_use_dimensions'] !== undefined ? tempConfigs['reservoir_use_dimensions'] : (configs['reservoir_use_dimensions'] || 'false')}
                  onChange={(e) => setTempConfigs(prev => ({ ...prev, reservoir_use_dimensions: e.target.value }))}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-lg py-1.5 px-2.5 text-xs text-zinc-850 focus:outline-none focus:border-zinc-400 cursor-pointer"
                >
                  <option value="false">Direct Volume (Liters)</option>
                  <option value="true">Tank Dimensions (Width & Length)</option>
                </select>
              </div>

              {/* Conditional Inputs */}
              {(tempConfigs['reservoir_use_dimensions'] !== undefined ? tempConfigs['reservoir_use_dimensions'] === 'true' : configs['reservoir_use_dimensions'] === 'true') ? (
                <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-1 duration-150">
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-black uppercase tracking-wider block font-bold">Width (cm)</label>
                    <input 
                      type="number"
                      value={tempConfigs['reservoir_width_cm'] !== undefined ? tempConfigs['reservoir_width_cm'] : (configs['reservoir_width_cm'] || '60')}
                      onChange={(e) => setTempConfigs(prev => ({ ...prev, reservoir_width_cm: e.target.value }))}
                      className="w-full bg-zinc-50 border border-zinc-200 rounded-lg py-1.5 px-3 font-mono text-xs text-zinc-800 focus:outline-none focus:border-zinc-400"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-black uppercase tracking-wider block font-bold">Length (cm)</label>
                    <input 
                      type="number"
                      value={tempConfigs['reservoir_length_cm'] !== undefined ? tempConfigs['reservoir_length_cm'] : (configs['reservoir_length_cm'] || '70')}
                      onChange={(e) => setTempConfigs(prev => ({ ...prev, reservoir_length_cm: e.target.value }))}
                      className="w-full bg-zinc-50 border border-zinc-200 rounded-lg py-1.5 px-3 font-mono text-xs text-zinc-800 focus:outline-none focus:border-zinc-400"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-1 animate-in fade-in slide-in-from-top-1 duration-150">
                  <label className="text-[10px] font-semibold text-black uppercase tracking-wider block font-bold">Total Volume Capacity (Liters)</label>
                  <input 
                    type="number"
                    value={tempConfigs['reservoir_total_volume_liters'] !== undefined ? tempConfigs['reservoir_total_volume_liters'] : (configs['reservoir_total_volume_liters'] || '100')}
                    onChange={(e) => setTempConfigs(prev => ({ ...prev, reservoir_total_volume_liters: e.target.value }))}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-lg py-1.5 px-3 font-mono text-xs text-zinc-800 focus:outline-none focus:border-zinc-400"
                  />
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-zinc-100 bg-zinc-50/50 p-4 flex justify-end gap-2.5">
              <button
                onClick={() => setIsReservoirOpen(false)}
                className="bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700 hover:text-zinc-955 font-semibold px-4 py-2 text-xs rounded-xl cursor-pointer shadow-sm active:scale-95 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleConfigSaveAll}
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 text-xs rounded-xl cursor-pointer shadow-sm active:scale-95 transition-all"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
