



import React, { useEffect, useState } from "react";
import { getLiveStatus } from "../api/client";

const LivePhasesView = () => {
  const [data, setData] = useState({ active: [], idle: [] });

  const load = async () => {
    const res = await getLiveStatus();
    setData(res);
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const formatLocal = (isoString) => {
    if (!isoString) return "N/A";
    return new Date(isoString + "Z").toLocaleString();
    // Adding "Z" forces browser to treat it as UTC → converted to local
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">

      <h2 className="text-2xl font-bold mb-4">Live Working Phases</h2>

      {/* ACTIVE */}
      <h3 className="text-xl font-semibold mt-4 mb-2">Active Now</h3>
      <div className="space-y-2">
        {data.active.map((a, i) => {
          const runningMin = Math.round(a.runningSeconds / 60);
          const plannedMin = Math.round(a.plannedTime);

          return (
            <div
              key={i}
              className={`p-3 rounded-md border ${
                a.isOverrun
                  ? "bg-red-100 border-red-400"
                  : "bg-green-100 border-green-400"
              }`}
            >
              <p><b>User:</b> {a.username}</p>
              <p><b>Sheet:</b> {a.productionSheetNumber}</p>
              <p><b>Product:</b> {a.productId}</p>
              <p><b>Phase:</b> {a.phaseId}</p>
              <p><b>Status:</b> {a.status}</p>
              <p><b>Running:</b> {runningMin} min</p>

              {a.isOverrun && (
                <p className="text-red-700 font-bold mt-1">
                  ⚠ Overrun! (Planned: {plannedMin} min — Actual: {runningMin} min)
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* IDLE */}
      <h3 className="text-xl font-semibold mt-6 mb-2">Idle Users</h3>
      <div className="space-y-2">
        {data.idle.map((u, i) => (
          <div
            key={i}
            className="p-3 rounded-md border bg-gray-100 border-gray-300"
          >
            <p><b>User:</b> {u.username}</p>
            <p><b>Last Sheet:</b> {u.lastSheetNumber}</p>
            <p><b>Last Phase:</b> {u.lastPhaseId}</p>
            <p><b>Finished:</b> {formatLocal(u.finishedAt)}</p>
            <p><b>Idle:</b> {Math.round(u.idleSeconds / 60)} min</p>
          </div>
        ))}
      </div>

    </div>
  );
};

export default LivePhasesView;
