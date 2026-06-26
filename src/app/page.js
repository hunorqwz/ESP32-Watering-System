'use client';

import { useState, useEffect } from 'react';

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

    // Register service worker for PWA support
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) =>
        console.error('Service Worker registration failed:', err)
      );
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

  const current = data.current;
  const isStale = !connected || !deviceStatus.active;

  const renderLastSeenText = () => {
    const elapsed = deviceStatus.last_seen_seconds;
    if (elapsed === null) return 'Never seen';
    if (elapsed < 60) return 'Just now';
    if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`;
    return `${Math.floor(elapsed / 3600)}h ago`;
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
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${connected && deviceStatus.active ? 'bg-green-500' : 'bg-zinc-300 animate-pulse'}`}></span>
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                {!connected 
                  ? 'Syncing' 
                  : deviceStatus.active 
                    ? 'ESP32 Active' 
                    : 'ESP32 Offline'}
              </span>
            </div>
            <span className="text-[10px] text-zinc-400 font-medium">
              Last Report: {renderLastSeenText()}
            </span>
          </div>
        </header>

        {/* Top Tier: Summary metrics (Reservoir Level, Temp, Humidity) */}
        <div className={`grid grid-cols-3 gap-4 transition-opacity duration-300 ${isStale ? 'opacity-60' : ''}`}>
          {/* Reservoir Level */}
          <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-1">
            <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-semibold block">Reservoir Level</span>
            {loading || !current || current.water_level === undefined || current.water_level === null ? (
              <div className="h-8 w-20 bg-zinc-100 rounded animate-pulse mt-1"></div>
            ) : (
              <div className="text-2xl font-semibold tracking-tight">{Math.round(current.water_level)}%</div>
            )}
          </div>

          {/* Temp */}
          <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-1">
            <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-semibold block">Temperature</span>
            {loading || !current || current.temp === undefined || current.temp === null ? (
              <div className="h-8 w-20 bg-zinc-100 rounded animate-pulse mt-1"></div>
            ) : (
              <div className="text-2xl font-semibold tracking-tight">{Number(current.temp).toFixed(1)}°C</div>
            )}
          </div>

          {/* Humidity */}
          <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-1">
            <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-semibold block">Humidity</span>
            {loading || !current || current.hum === undefined || current.hum === null ? (
              <div className="h-8 w-20 bg-zinc-100 rounded animate-pulse mt-1"></div>
            ) : (
              <div className="text-2xl font-semibold tracking-tight">{Number(current.hum).toFixed(1)}%</div>
            )}
          </div>
        </div>

        {/* Middle Tier: 5 uniform data cards for Soil Moisture (Zones 1-5) */}
        <div className="space-y-3">
          <h2 className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold">Soil Moisture</h2>
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
              
              return (
                <div key={zone.id} className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-semibold text-zinc-400 uppercase">{zone.label}</span>
                    {loading || !hasVal ? (
                      <div className="h-4 w-8 bg-zinc-100 rounded animate-pulse"></div>
                    ) : (
                      <span className="text-sm font-semibold text-zinc-800">{Math.round(Number(val))}%</span>
                    )}
                  </div>
                  <div className="w-full bg-zinc-100 rounded-full h-1">
                    {loading || !hasVal ? (
                      <div className="h-1 bg-zinc-200 rounded-full w-1/2 animate-pulse"></div>
                    ) : (
                      <div 
                        className="bg-zinc-700 h-1 rounded-full transition-all duration-500" 
                        style={{ width: `${Math.min(100, Math.max(0, Math.round(Number(val))))}%` }}
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
          <h2 className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold">Pump Controls</h2>
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
                <div key={pump.id} className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm flex justify-between items-center">
                  <div>
                    <span className="text-sm font-medium text-zinc-800 block">{pump.label}</span>
                    <span className={`text-[10px] uppercase font-semibold ${isActive ? 'text-green-600' : 'text-zinc-400'}`}>
                      {isActive ? 'Active' : 'Standby'}
                    </span>
                  </div>
                  <button
                    onClick={() => handlePumpToggle(pump.id)}
                    disabled={isToggling}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isActive ? 'bg-green-500' : 'bg-zinc-200'} ${isToggling ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition duration-200 ease-in-out ${isActive ? 'translate-x-5' : 'translate-x-0'}`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* System Configuration settings card */}
        <div className="space-y-3">
          <h2 className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold">System Configuration</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm flex justify-between items-center">
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
    </div>
  );
}
