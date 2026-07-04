'use client';

import { Activity, CheckCircle2, XCircle, Clock } from 'lucide-react';

export default function ActivityLog({ commands = [], loading = false }) {
  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-zinc-500" />
          <h3 className="text-sm font-semibold text-zinc-800">Recent System Activity</h3>
        </div>
        <span className="text-[10px] text-zinc-400 font-medium">Last 10 Actions</span>
      </div>

      {loading ? (
        <div className="space-y-2 py-4">
          <div className="h-4 bg-zinc-100 rounded w-3/4 animate-pulse"></div>
          <div className="h-4 bg-zinc-100 rounded w-1/2 animate-pulse"></div>
          <div className="h-4 bg-zinc-100 rounded w-2/3 animate-pulse"></div>
        </div>
      ) : commands.length === 0 ? (
        <div className="text-center py-6 text-xs text-zinc-400 italic">
          No recent activity logs found.
        </div>
      ) : (
        <div className="flow-root">
          <ul className="-mb-8">
            {commands.map((log, index) => {
              const isSuccess = log.status === 'success';
              const name = log.pump_name || `Pump ${log.pump || '?'}`;
              const pin = log.pump_pin !== null ? `Pin ${log.pump_pin}` : 'No Pin';

              return (
                <li key={log.id}>
                  <div className="relative pb-6">
                    {index !== commands.length - 1 && (
                      <span className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-zinc-100" aria-hidden="true" />
                    )}
                    <div className="relative flex space-x-3">
                      <div>
                        <span className={`h-8 w-8 rounded-full flex items-center justify-center ring-8 ring-white ${isSuccess ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                          {isSuccess ? (
                            <CheckCircle2 className="w-4 h-4" strokeWidth={2.2} />
                          ) : (
                            <XCircle className="w-4 h-4" strokeWidth={2.2} />
                          )}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0 pt-1.5 flex justify-between space-x-4">
                        <div>
                          <p className="text-xs text-zinc-700">
                            <span className="font-semibold text-zinc-900">{name}</span>{' '}
                            <span className="text-zinc-400">({pin})</span>{' '}
                            was triggered{' '}
                            <span className={`font-semibold ${log.state === 1 ? 'text-blue-600' : 'text-zinc-500'}`}>
                              {log.state === 1 ? 'ON' : 'OFF'}
                            </span>
                          </p>
                          {!isSuccess && log.error_details && (
                            <p className="text-[10px] text-red-500 mt-0.5 font-mono max-w-md break-all leading-relaxed">
                              Error: {log.error_details}
                            </p>
                          )}
                        </div>
                        <div className="text-right text-[10px] whitespace-nowrap text-zinc-400 font-medium flex items-center gap-1">
                          <Clock className="w-3 h-3 text-zinc-300" />
                          <time dateTime={log.created_at}>{formatTime(log.created_at)}</time>
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
