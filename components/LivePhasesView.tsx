import React, { useEffect, useState } from "react";
import { getLiveStatus } from "../api/client";

const LivePhasesView = () => {
  const [data, setData] = useState<{ active: any[]; dead: any[]; idle: any[] }>({
    active: [],
    dead: [],
    idle: [],
  });

  const load = async () => {
    const res = await getLiveStatus();
    setData(res);
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const parsePgTimestamp = (ts: string) => {
    if (!ts) return null;
    let clean = ts.replace(" ", "T");
    if (!clean.endsWith("Z") && !clean.includes("+") && !clean.includes("-")) {
      clean += "Z";
    }
    const d = new Date(clean);
    return isNaN(d.getTime()) ? null : d;
  };

  const formatLocal = (ts: string) => {
    const d = parsePgTimestamp(ts);
    return d ? d.toLocaleString() : "Invalid Date";
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">Live Working Phases</h2>

      {/* ACTIVE PHASES */}
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

      {/* ACTIVE DEAD TIME */}
      <h3 className="text-xl font-semibold mt-6 mb-2">Active Dead Time</h3>
      <div className="space-y-2">
        {data.dead.map((d, i) => {
          const runningMin = Math.round(d.runningSeconds / 60);

          return (
            <div
              key={i}
              className="p-3 rounded-md border bg-yellow-100 border-yellow-400"
            >
              <p><b>User:</b> {d.username}</p>
              <p><b>Code:</b> {d.code} – {d.description}</p>

              {d.orderNumber && d.productionSheetNumber && (
                <p><b>Sheet:</b> {d.orderNumber}/{d.productionSheetNumber}</p>
              )}

              {d.productId && <p><b>Product:</b> {d.productId}</p>}

              <p><b>Running:</b> {runningMin} min</p>
            </div>
          );
        })}
      </div>

      {/* IDLE USERS */}
      <h3 className="text-xl font-semibold mt-6 mb-2">Idle Users</h3>
      <div className="space-y-2">
        {data.idle.map((u, i) => (
          <div
            key={i}
            className="p-3 rounded-md border bg-gray-100 border-gray-300"
          >
            <p><b>User:</b> {u.username}</p>

            {/* If last event was a phase */}
            {u.kind === "phase" && (
              <>
                <p><b>Last Sheet:</b> {u.lastSheetNumber}</p>
                <p><b>Last Phase:</b> {u.lastPhaseId}</p>
              </>
            )}

            {/* If last event was DEAD-TIME */}
            {u.kind === "dead" && (
              <>
                <p><b>Last Work:</b> Dead Time</p>
                <p><b>Code:</b> {u.deadCode} – {u.deadDescription}</p>

                {u.deadOrderNumber && u.deadProductionSheetNumber && (
                  <p>
                    <b>Sheet:</b> {u.deadOrderNumber}/{u.deadProductionSheetNumber}
                  </p>
                )}

                {u.deadProductId && (
                  <p><b>Product:</b> {u.deadProductId}</p>
                )}
              </>
            )}

            <p><b>Finished:</b> {formatLocal(u.finishedAt)}</p>
            <p><b>Idle:</b> {Math.round(u.idleSeconds / 60)} min</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default LivePhasesView;
