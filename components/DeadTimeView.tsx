import React, { useEffect, useState, useRef } from "react";
import { useAuth } from "../hooks/useAuth";
import { useTranslation } from "../hooks/useTranslation";
import * as api from "../api/client";
import Scanner from "./Scanner";

type DeadCode = {
  code: number;
  label: string;
  requiresProductManual?: boolean; // 60
  requiresProductOrSheet?: boolean; // 70,100,130,140,150
};

const DEAD_CODES: DeadCode[] = [
  { code: 10, label: "ΕΛΛΕΙΨΗ ΥΛΙΚΟΥ" },
  { code: 20, label: "ΕΛΛΕΙΨΗ ΕΡΓΑΣΙΑΣ" },
  { code: 30, label: "ΒΟΗΘΗΤΙΚΕΣ ΕΡΓΑΣΙΕΣ" },
  { code: 40, label: "ΒΛΑΒΗ ΜΗΧΑΝΗΣ" },
  { code: 50, label: "ΣΥΝΤΗΡΗΣΗ - ΡΕΚΤΙΦΙΕ" },
  { code: 60, label: "ΠΑΡΑΓΩΓΗ ΔΕΙΓΜΑΤΟΣ", requiresProductManual: true },
  { code: 70, label: "ΠΟΙΟΤΙΚΑ ΠΡΟΒΛΗΜΑΤΑ", requiresProductOrSheet: true },
  { code: 80, label: "ΑΝΑΣΚΕΥΕΣ" },
  { code: 90, label: "ΦΟΡΤ. - ΕΚΦΟΡΤ. - ΜΕΤΑΚ.ΥΛΙΚΩΝ" },
  { code: 100, label: "ΚΑΤΕΒΑΣΜΑ ΑΠΟ ΦΟΥΡΝΟ", requiresProductOrSheet: true },
  { code: 110, label: "RACKS" },
  { code: 120, label: "ΚΟΠΗ ΥΛΙΚΟΥ" },
  { code: 130, label: "ΣΥΣΚΕΥΑΣΙΑ ΓΙΑ ΦΑΣΟΝ", requiresProductOrSheet: true },
  { code: 140, label: "ΕΡΓΑΣΙΕΣ Μ/Τ ΓΙΑ ΦΟΥΡΝΟ", requiresProductOrSheet: true },
  { code: 150, label: "ΕΠΙΠΡΟΣΘΕΤΗ ΕΡΓΑΣΙΑ ΣΕ ΕΝΤΟΛΗ ΠΑΡΑΓ.", requiresProductOrSheet: true },
  { code: 160, label: "ΕΚΠΑΙΔΕΥΣΗ - ΣΥΣΚΕΨΕΙΣ" },
  { code: 170, label: "ΕΛΛΕΙΨΗ ΕΡΓΑΛΕΙΟΥ" },
  { code: 180, label: "ΤΑΜΠΕΛΕΣ ΧΩΡΙΣ ΕΝΤΟΛΗ" },
];

interface ActiveDeadTime {
  id: string;
  code: number;
  description: string;
  productId?: string;
  sheetId?: string;
  orderNumber?: string;
  productionSheetNumber?: string;
  runningSeconds: number;
}

interface ActivePhase {
  username: string;
  sheetId: string;
  productionSheetNumber: string;
  productId: string;
  phaseId: string;
  runningSeconds: number;
}

const DeadTimeView: React.FC = () => {
  const { user } = useAuth();
  const { t } = useTranslation();

  const [selectedCode, setSelectedCode] = useState<number | null>(null);
  const [manualProductId, setManualProductId] = useState("");
  const [useScanner, setUseScanner] = useState(false);

  const [scannedSheetId, setScannedSheetId] = useState<string | null>(null);
  const [scannedOrderNumber, setScannedOrderNumber] = useState<string | null>(null);
  const [scannedSheetNumber, setScannedSheetNumber] = useState<string | null>(null);
  const [scannedProductId, setScannedProductId] = useState<string | null>(null);

  const [activeDead, setActiveDead] = useState<ActiveDeadTime | null>(null);
  const [activePhase, setActivePhase] = useState<ActivePhase | null>(null);

  const [loading, setLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const timerRef = useRef<number | null>(null);
  const [seconds, setSeconds] = useState(0);

  // helper: format mm:ss
  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // restart timer whenever activeDead changes
  useEffect(() => {
    if (!activeDead) {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setSeconds(0);
      return;
    }

    setSeconds(activeDead.runningSeconds || 0);

    if (timerRef.current) {
      window.clearInterval(timerRef.current);
    }
    timerRef.current = window.setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [activeDead]);

  // initial load: check if user has active dead-time OR active phase-time
  useEffect(() => {
    const load = async () => {
      if (!user) return;
      try {
        const status = await api.getLiveStatus();

        const myDead = (status.dead || []).find(
          (d: any) => d.username === user.username
        );
        if (myDead) {
          setActiveDead({
            id: myDead.id,
            code: myDead.code,
            description: myDead.description,
            productId: myDead.productId,
            sheetId: myDead.sheetId,
            orderNumber: myDead.orderNumber,
            productionSheetNumber: myDead.productionSheetNumber,
            runningSeconds: myDead.runningSeconds,
          });
          setActivePhase(null);
          return;
        }

        const myPhase = (status.active || []).find(
          (a: any) => a.username === user.username
        );
        if (myPhase) {
          setActivePhase({
            username: myPhase.username,
            sheetId: myPhase.sheetId,
            productionSheetNumber: myPhase.productionSheetNumber,
            productId: myPhase.productId,
            phaseId: myPhase.phaseId,
            runningSeconds: myPhase.runningSeconds,
          });
        } else {
          setActivePhase(null);
        }
      } catch (e) {
        console.error("DeadTimeView load error:", e);
      }
    };

    load();
  }, [user]);

  const currentCodeMeta = DEAD_CODES.find((c) => c.code === selectedCode);

  const requiresProductManual = currentCodeMeta?.requiresProductManual;
  const requiresProductOrSheet = currentCodeMeta?.requiresProductOrSheet;

  const handleScanSuccess = async (decodedText: string) => {
    try {
      setScanError(null);

      // Χρησιμοποιούμε ήδη το endpoint που έχεις για QR
      const raw = await api.getProductionSheetByQr(decodedText);

      setScannedSheetId(raw.id);
      setScannedOrderNumber(raw.orderNumber);
      setScannedSheetNumber(raw.productionSheetNumber);
      setScannedProductId(raw.productId);

      setUseScanner(false);
    } catch (err: any) {
      console.error("DeadTime scan error:", err);
      setScanError(err.message || "Failed to read QR");
    }
  };

  const canStart = () => {
    if (!selectedCode) return false;

    if (requiresProductManual) {
      return manualProductId.trim().length > 0;
    }

    if (requiresProductOrSheet) {
      return (
        manualProductId.trim().length > 0 ||
        !!scannedSheetId ||
        !!scannedProductId
      );
    }

    return true;
  };

  const handleStart = async () => {
    if (!user || !selectedCode) return;
    if (!canStart()) {
      alert("Please provide required product / scan details.");
      return;
    }

    // αν υπάρχει activeDead -> δεν ξεκινάμε δεύτερο
    if (activeDead) {
      alert("You already have an active dead-time.");
      return;
    }

    // αν υπάρχει activePhase -> respect rule (backend επίσης το ελέγχει)
    if (activePhase) {
      alert(
        "You already have an active phase-time. Finish it before starting dead-time."
      );
      return;
    }

    const meta = DEAD_CODES.find((c) => c.code === selectedCode);
    if (!meta) return;

    const payload: any = {
      username: user.username,
      code: selectedCode,
      description: meta.label,
    };

    // προτεραιότητα: manual product > scanned product
    if (manualProductId.trim()) {
      payload.productId = manualProductId.trim();
    } else if (scannedProductId) {
      payload.productId = scannedProductId;
    }

    if (scannedSheetId) {
      payload.sheetId = scannedSheetId;
    }
    if (scannedOrderNumber) {
      payload.orderNumber = scannedOrderNumber;
    }
    if (scannedSheetNumber) {
      payload.productionSheetNumber = scannedSheetNumber;
    }

    setLoading(true);
    try {
      const started = await api.startDeadTime(payload);

      setActiveDead({
        id: started.id,
        code: started.code,
        description: started.description,
        productId: started.product_id,
        sheetId: started.sheet_id,
        orderNumber: started.order_number,
        productionSheetNumber: started.production_sheet_number,
        runningSeconds: 0,
      });

      // reset inputs
      setManualProductId("");
      setScannedSheetId(null);
      setScannedOrderNumber(null);
      setScannedSheetNumber(null);
      setScannedProductId(null);
    } catch (err: any) {
      console.error("startDeadTime error:", err);
      alert(err.message || "Failed to start dead-time");
    } finally {
      setLoading(false);
    }
  };

  const handleFinish = async () => {
    if (!activeDead) return;

    setLoading(true);
    try {
      await api.finishDeadTime(activeDead.id);
      setActiveDead(null);

      // μετά το finish μπορούμε να ξαναφορτώσουμε live status για να δούμε αν είναι idle
      if (user) {
        const status = await api.getLiveStatus();
        const myPhase = (status.active || []).find(
          (a: any) => a.username === user.username
        );
        setActivePhase(myPhase || null);
      }
    } catch (err: any) {
      console.error("finishDeadTime error:", err);
      alert(err.message || "Failed to finish dead-time");
    } finally {
      setLoading(false);
    }
  };

  // ---------- UI ----------

  // Αν έχει ενεργό DEAD TIME
  if (activeDead) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-lg max-w-md mx-auto">
        <h2 className="text-2xl font-bold mb-4">Active Dead Time</h2>
        <p className="mb-2">
          <b>Code:</b> {activeDead.code} – {activeDead.description}
        </p>
        {activeDead.orderNumber && activeDead.productionSheetNumber && (
          <p className="mb-1">
            <b>Sheet:</b> {activeDead.orderNumber}/
            {activeDead.productionSheetNumber}
          </p>
        )}
        {activeDead.productId && (
          <p className="mb-1">
            <b>Product:</b> {activeDead.productId}
          </p>
        )}
        <p className="mb-4">
          <b>Time:</b> {formatDuration(seconds)}
        </p>
        <button
          onClick={handleFinish}
          disabled={loading}
          className="w-full bg-red-600 text-white py-3 rounded-md"
        >
          Finish
        </button>
      </div>
    );
  }

  // Αν έχει ενεργό PHASE TIME (άλλο tab)
  if (activePhase) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-lg max-w-md mx-auto">
        <h2 className="text-2xl font-bold mb-4">Active Phase Time</h2>
        <p className="mb-1">
          <b>Sheet:</b> {activePhase.productionSheetNumber}
        </p>
        <p className="mb-1">
          <b>Product:</b> {activePhase.productId}
        </p>
        <p className="mb-1">
          <b>Phase:</b> {activePhase.phaseId}
        </p>
        <p className="mb-4">
          <b>Running:</b> {Math.round(activePhase.runningSeconds / 60)} min
        </p>
        <p className="text-sm text-gray-600 mb-4">
          You cannot start dead-time while a phase is running.
          Finish it from the Machine Operator tab.
        </p>
      </div>
    );
  }

  // Default UI: επιλογή κωδικού + product/QR options
  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">Dead Time</h2>

      {/* Select code */}
      <div className="mb-4">
        <label className="block mb-1 font-semibold">Select Code</label>
        <select
          className="w-full border rounded px-3 py-2"
          value={selectedCode ?? ""}
          onChange={(e) => {
            const v = e.target.value ? Number(e.target.value) : null;
            setSelectedCode(v);
            // reset fields on code change
            setManualProductId("");
            setScannedSheetId(null);
            setScannedOrderNumber(null);
            setScannedSheetNumber(null);
            setScannedProductId(null);
            setUseScanner(false);
            setScanError(null);
          }}
        >
          <option value="">-- choose --</option>
          {DEAD_CODES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} – {c.label}
            </option>
          ))}
        </select>
      </div>

      {selectedCode && (
        <>
          {/* Requirements info */}
          {requiresProductManual && (
            <p className="text-sm text-gray-600 mb-2">
              This code requires a <b>manual Product ID</b>.
            </p>
          )}
          {requiresProductOrSheet && (
            <p className="text-sm text-gray-600 mb-2">
              This code requires a <b>Product</b>, either by scanning QR
              or entering Product ID.
            </p>
          )}

          {/* Manual product ID if needed or allowed */}
          {(requiresProductManual || requiresProductOrSheet) && (
            <div className="mb-4">
              <label className="block mb-1 font-semibold">Product ID (manual)</label>
              <input
                type="text"
                className="w-full border rounded px-3 py-2"
                value={manualProductId}
                onChange={(e) => setManualProductId(e.target.value)}
                placeholder="Enter product code"
              />
            </div>
          )}

          {/* Scanner if allowed for this code */}
          {requiresProductOrSheet && (
            <div className="mb-4">
              <label className="block mb-1 font-semibold">Scan QR (optional)</label>
              {!useScanner && (
                <button
                  type="button"
                  onClick={() => setUseScanner(true)}
                  className="w-full bg-indigo-600 text-white py-2 rounded-md mb-2"
                >
                  Start Scanner
                </button>
              )}

              {useScanner && (
                <div className="mb-2">
                  <Scanner
                    onScanSuccess={handleScanSuccess}
                    onScanError={(msg) => setScanError(msg)}
                  />
                  <button
                    type="button"
                    onClick={() => setUseScanner(false)}
                    className="w-full bg-gray-500 text-white py-2 rounded-md mt-2"
                  >
                    Close Scanner
                  </button>
                </div>
              )}

              {scanError && (
                <p className="text-sm text-red-600 mt-2">{scanError}</p>
              )}

              {(scannedSheetId || scannedProductId) && (
                <div className="mt-2 text-sm text-green-700 bg-green-50 p-2 rounded">
                  <p>
                    <b>Scanned Sheet:</b>{" "}
                    {scannedOrderNumber && scannedSheetNumber
                      ? `${scannedOrderNumber}/${scannedSheetNumber}`
                      : scannedSheetId}
                  </p>
                  {scannedProductId && (
                    <p>
                      <b>Product:</b> {scannedProductId}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <button
        type="button"
        onClick={handleStart}
        disabled={loading || !selectedCode || !canStart()}
        className="w-full bg-indigo-600 text-white py-3 rounded-md disabled:opacity-50"
      >
        Start Dead Time
      </button>
    </div>
  );
};

export default DeadTimeView;
