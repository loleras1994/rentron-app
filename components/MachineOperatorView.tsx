import React, { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "../hooks/useTranslation";
import * as api from "../api/client";
import type {
  ProductionSheetForOperator,
  Phase,
  PhaseLog,
  Material,
} from "../src/types";
import Scanner from "./Scanner";
import { useAuth } from "../hooks/useAuth";
import { useWarehouse } from "../hooks/useWarehouse";
import ConfirmModal from "../components/ConfirmModal";
import { mapPhaseLog } from "../src/mapPhaseLog";

type StageType = "find" | "setup" | "production";

/* ---------------------------------------------------------
   HELPERS
--------------------------------------------------------- */

const safeInt = (v: any, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
};


// phases in product snapshot may use id / phase_id / phaseId
const normalizeProductPhases = (rawProduct: any | null | undefined) => {
  if (!rawProduct) return { ...rawProduct, phases: [] as any[] };

  const phasesArr = Array.isArray(rawProduct.phases)
    ? rawProduct.phases
    : [];

  const normalizedPhases = phasesArr.map((p: any) => ({
    ...p,
    phaseId: String(p.phaseId ?? p.phase_id ?? p.id),
  }));

  return {
    ...rawProduct,
    phases: normalizedPhases,
  };
};

/* ---------------------------------------------------------
   SAFELY RESOLVE MATERIALS
--------------------------------------------------------- */
const resolveMaterialsForPhase = (
  sheet: ProductionSheetForOperator | null,
  materials: Material[]
): Material[] => {
  if (!sheet) return [];

  const candidates = new Set<string>();
  const p = sheet.product;

  if (sheet.productId) candidates.add(String(sheet.productId).toLowerCase());
  if (p?.id) candidates.add(String(p.id).toLowerCase());

  const pm = Array.isArray(p?.materials) ? p.materials : [];
  for (const m of pm as any[]) {
    if (typeof m === "string") candidates.add(m.toLowerCase());
    else if (m) {
      if (m.materialId) candidates.add(String(m.materialId).toLowerCase());
      if (m.materialCode) candidates.add(String(m.materialCode).toLowerCase());
      if (m.sku) candidates.add(String(m.sku).toLowerCase());
      if (m.name) candidates.add(String(m.name).toLowerCase());
    }
  }

  return materials.filter(
    (wm) =>
      wm.materialCode &&
      candidates.has(String(wm.materialCode).toLowerCase())
  );
};

/* ---------------------------------------------------------
   MAIN COMPONENT
--------------------------------------------------------- */
const MachineOperatorView: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { materials } = useWarehouse();

  const [materialInfo, setMaterialInfo] = useState<Material[] | null>(null);
  const [viewState, setViewState] =
    useState<"idle" | "scanning" | "details">("idle");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [sheet, setSheet] = useState<ProductionSheetForOperator | null>(null);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [activeLog, setActiveLog] = useState<PhaseLog | null>(null);

  const [currentStage, setCurrentStage] = useState<StageType | null>(null);
  const [currentStagePhaseId, setCurrentStagePhaseId] = useState<string | null>(
    null
  );
  const stageTimerRef = useRef<number | null>(null);
  const [stageSeconds, setStageSeconds] = useState(0);

  const [pendingStageTimes, setPendingStageTimes] = useState<
    Record<string, { find: number; setup: number }>
  >({});

  // Modal
  const [modalData, setModalData] = useState<{
    open: boolean;
    title: string;
    message: string;
    buttons: any[];
    resolver: null | ((v: boolean) => void);
  }>({
    open: false,
    title: "",
    message: "",
    buttons: [],
    resolver: null,
  });

  const openModal = (title: string, message: string, buttons: any[]) =>
    new Promise<boolean>((resolve) => {
      setModalData({
        open: true,
        title,
        message,
        buttons,
        resolver: resolve,
      });
    });

  const closeModal = (value: boolean) => {
    modalData.resolver?.(value);
    setModalData((m) => ({ ...m, open: false }));
  };

  const clearStageTimer = () => {
    if (stageTimerRef.current) {
      window.clearInterval(stageTimerRef.current);
      stageTimerRef.current = null;
    }
  };

  // Clear timer on unmount, just in case
  useEffect(() => {
    return () => {
      clearStageTimer();
    };
  }, []);

  /* ---------------------------------------------------------
     LOAD PHASE DEFINITIONS
  --------------------------------------------------------- */
  useEffect(() => {
    api.getPhases().then(setPhases).catch(console.error);
  }, []);

  /* ---------------------------------------------------------
     SAFE NORMALIZER FOR SHEET
  --------------------------------------------------------- */
  const normalizeSheet = (raw: any): ProductionSheetForOperator => {
    const product = normalizeProductPhases(raw.product || null);

    const rawLogs = Array.isArray(raw.phaseLogs)
      ? raw.phaseLogs
      : raw.phase_logs || [];

    const phaseLogs = rawLogs.map(mapPhaseLog);

    return {
      ...raw,
      phaseLogs,
      product,
    };
  };

  /* ---------------------------------------------------------
     SCAN SUCCESS
  --------------------------------------------------------- */
  const handleScanSuccess = async (decodedText: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const raw = await api.getProductionSheetByQr(decodedText);
      const data = normalizeSheet(raw);

      setSheet(data);

      const resumeActivePhase = async (freshSheet: ProductionSheetForOperator) => {
        if (!user) return false;

        // 1) Prefer live_phase_log (most reliable for "running_seconds")
        try {
          const status = await api.getLiveStatus();
          const active = status.active.find(
            (l: any) => l.username === user.username
          );

          if (active && String(active.sheet_id) !== String(freshSheet.id)) {
            await openModal(
              "Active job in progress",
              "You already have a running job on another production sheet. Please return to it and finish it first.",
              [
                {
                  label: "OK",
                  type: "primary",
                  onClick: () => closeModal(false),
                },
              ]
            );

            return true; // IMPORTANT: prevents UI reset
          }

          if (active?.phase_log_id) {
            const log = freshSheet.phaseLogs.find((l) => String(l.id) === String(active.phase_log_id));
            if (log) {
              setActiveLog(log);
              setCurrentStage(log.stage as StageType);
              setCurrentStagePhaseId(String(log.phaseId));
              setStageSeconds(active.running_seconds || 0);

              clearStageTimer();
              stageTimerRef.current = window.setInterval(() => setStageSeconds((s) => s + 1), 1000);
              return true;
            }
          }
        } catch (e) {
          console.error("resumeActivePhase live status failed:", e);
        }

        // 2) Fallback: if live_phase_log is missing, resume from phase_logs directly
        const openLog = freshSheet.phaseLogs.find(
          (l) => l.operatorUsername === user.username && !l.endTime
        );

        if (!openLog) return false;

        const startMs = new Date(openLog.startTime as any).getTime();
        const nowMs = Date.now();
        const secs = startMs ? Math.max(0, Math.floor((nowMs - startMs) / 1000)) : 0;

        setActiveLog(openLog);
        setCurrentStage(openLog.stage as StageType);
        setCurrentStagePhaseId(String(openLog.phaseId));
        setStageSeconds(secs);

        clearStageTimer();
        stageTimerRef.current = window.setInterval(() => setStageSeconds((s) => s + 1), 1000);

        return true;
      };



      const hasPhase2or30 = data.product?.phases?.some((p: any) =>
        ["2", "30"].includes(String(p.phaseId))
      );

      const phase2or30Done = data.phaseLogs.some(
        (l) =>
          ["2", "30"].includes(String(l.phaseId)) &&
          l.endTime &&
          (l.quantityDone || 0) >= data.quantity
      );

      if (hasPhase2or30 && !phase2or30Done) {
        const freshMaterials = await api.getMaterials();
        setMaterialInfo(resolveMaterialsForPhase(data, freshMaterials));
      } else {
        setMaterialInfo(null);
      }

      const resumed = await resumeActivePhase(data);

      if (!resumed) {
        /*clearStageTimer();
        setCurrentStage(null);
        setCurrentStagePhaseId(null);
        setStageSeconds(0);
        setPendingStageTimes({});
        setActiveLog(null);*/
      }


      setViewState("details");
    } catch (err) {
      setError((err as Error).message);
      setViewState("idle");
    } finally {
      setIsLoading(false);
    }
  };

  /* ---------------------------------------------------------
     SAFE remaining calculation
  --------------------------------------------------------- */
  const computeRemainingForPhase = (phaseId: string): number => {
    if (!sheet) return 0;

    const phasesArr = sheet.product?.phases ?? [];
    const logs = sheet.phaseLogs ?? [];

    const doneByPhase = new Map<string, number>();
    phasesArr.forEach((p: any) =>
      doneByPhase.set(String(p.phaseId), 0)
    );

    logs.forEach((log) => {
      const key = String(log.phaseId);
      doneByPhase.set(
        key,
        (doneByPhase.get(key) || 0) + (log.quantityDone || 0)
      );
    });

    const idx = phasesArr.findIndex(
      (p: any) => String(p.phaseId) === String(phaseId)
    );
    if (idx < 0) return 0;

    const upstreamDone =
      idx === 0
        ? sheet.quantity
        : doneByPhase.get(String(phasesArr[idx - 1].phaseId)) || 0;

    const alreadyDoneHere = doneByPhase.get(String(phaseId)) || 0;
    return Math.max(0, upstreamDone - alreadyDoneHere);
  };

  /* ---------------------------------------------------------
     SAFE STATUS MAP
  --------------------------------------------------------- */
  const phaseStatuses = useMemo(() => {
    if (!sheet) return new Map();

    const phasesArr = sheet.product?.phases ?? [];
    const logs = sheet.phaseLogs ?? [];

    const statuses = new Map<
      string,
      { done: number; total: number; inProgress: boolean }
    >();

    phasesArr.forEach((p: any) =>
      statuses.set(String(p.phaseId), {
        done: 0,
        total: sheet.quantity,
        inProgress: false,
      })
    );

    logs.forEach((log) => {
      const key = String(log.phaseId);
      const st = statuses.get(key);
      if (!st) return;
      st.done += log.quantityDone || 0;
      if (!log.endTime) st.inProgress = true;
    });

    return statuses;
  }, [sheet]);

  /* ---------------------------------------------------------
     FINISH PREVIOUS PHASE DIALOG
  --------------------------------------------------------- */
  const ensurePreviousPhaseClosed = async () => {
    if (!activeLog) return true;

    const runningStage = (activeLog as any).stage as StageType | undefined;

    const stageLabel =
      runningStage === "find" ? "Find material" :
      runningStage === "setup" ? "Setup" :
      "Production";

    const confirm = await openModal(
      `${stageLabel} still running`,
      `You already have an active ${stageLabel} log. Finish it first?`,
      [
        { label: "Finish it", type: "primary", onClick: () => closeModal(true) },
        { label: "Cancel", type: "secondary", onClick: () => closeModal(false) },
      ]
    );

    if (!confirm) return false;

    if (runningStage === "production") await finishProductionStage(false);
    else await finishSimpleStage();

    return true;
  };



  /* ---------------------------------------------------------
     START SIMPLE STAGES (find/setup)
  --------------------------------------------------------- */
  const startSimpleStage = async (phaseId: string, stage: StageType) => {
    if (stage === "production") return;
    if (!sheet || !user?.username) return;

    const ok = await ensurePreviousPhaseClosed();
    if (!ok) return;

    const remainingForPhase = computeRemainingForPhase(phaseId);
    if (remainingForPhase <= 0) return alert("Nothing to start.");

    setIsLoading(true);
    setError(null);

    try {
      // 1) create the log FIRST
      const newLog = await api.startPhase({
        operatorUsername: user.username,
        orderNumber: sheet.orderNumber,
        productionSheetNumber: sheet.productionSheetNumber,
        productId: sheet.productId,
        phaseId,
        startTime: new Date().toISOString(),
        // ⚠️ see note below about totalQuantity=0
        totalQuantity: 0,
        stage,
      });

      setActiveLog(mapPhaseLog(newLog));

      // 2) start live phase
      const def: any = sheet.product?.phases?.find((p: any) => String(p.phaseId) === String(phaseId));
      const plannedTime =
        (def?.setupTime || 0) + (def?.productionTimePerPiece || 0) * remainingForPhase;

      await api.startLivePhase({
        username: user.username,
        sheetId: sheet.id,
        productId: sheet.productId,
        phaseId,
        plannedTime,
        status: stage === "find" ? "search" : "setup",
      });

      // 3) only now start UI timer
      setCurrentStage(stage);
      setCurrentStagePhaseId(phaseId);
      setStageSeconds(0);

      clearStageTimer();
      stageTimerRef.current = window.setInterval(() => {
        setStageSeconds((s) => s + 1);
      }, 1000);
    } catch (e) {
      console.error("startSimpleStage error:", e);
      setError((e as Error).message);
      // ✅ ensure UI isn't stuck
      clearStageTimer();
      setCurrentStage(null);
      setCurrentStagePhaseId(null);
      setStageSeconds(0);
    } finally {
      setIsLoading(false);
    }
  };

  /* ---------------------------------------------------------
     FINISH SIMPLE STAGES
  --------------------------------------------------------- */
  const finishSimpleStage = async () => {
    if (!currentStage || !currentStagePhaseId) return;

    clearStageTimer();

    const phaseId = currentStagePhaseId;
    const seconds = stageSeconds;

    // snapshot the log id NOW (state may change async)
    const logId = activeLog?.id;

    setIsLoading(true);
    try {
      if (!logId) {
        throw new Error("No activeLog to finish (startPhase probably failed).");
      }

      await api.finishPhase(logId, new Date().toISOString(), 0, seconds);

      if (user?.username) {
        await api.stopLivePhase(user.username);
      }

      setActiveLog(null);
    } catch (e) {
      console.error("finishSimpleStage error:", e);
      setError((e as Error).message);
    } finally {
      // ✅ ALWAYS unlock UI
      setStageSeconds(0);
      setCurrentStage(null);
      setCurrentStagePhaseId(null);
      setIsLoading(false);
    }
  };


  /* ---------------------------------------------------------
     START PRODUCTION (FULLY PATCHED)
  --------------------------------------------------------- */
  const startProductionStage = async (phaseId: string) => {
    const ok = await ensurePreviousPhaseClosed();
    if (!ok) return;
    if (!sheet || !user) return;

    const remainingForPhase = computeRemainingForPhase(phaseId);
    if (remainingForPhase <= 0) return alert("Nothing to start.");

    const times = pendingStageTimes[phaseId] || { find: 0, setup: 0 };
    setIsLoading(true);

    const phase = sheet.product.phases.find((p: any) => String(p.phaseId) === String(phaseId));
    console.log("Phase position:", phase?.position); // Check if position exists

    try {
      const newLog = await api.startPhase({
        operatorUsername: user.username,
        orderNumber: sheet.orderNumber,
        productionSheetNumber: sheet.productionSheetNumber,
        productId: sheet.productId,
        phaseId,
        startTime: new Date().toISOString(),
        totalQuantity: remainingForPhase, // ⭐ key fix
        findMaterialTime: times.find || 0,
        setupTime: times.setup || 0,
        stage: 'production',
      });

      const normalizedLog = mapPhaseLog(newLog);
      setActiveLog(normalizedLog);

      setPendingStageTimes((prev) => {
        const copy = { ...prev };
        delete copy[phaseId];
        return copy;
      });

      // Start live
      try {
        const def: any = sheet.product?.phases?.find(
          (p: any) => String(p.phaseId) === String(phaseId)
        );
        if (def) {
          const planned =
            (def.productionTimePerPiece || 0) * remainingForPhase;

          await api.startLivePhase({
            username: user.username,
            sheetId: sheet.id,
            productId: sheet.productId,
            phaseId,
            plannedTime: planned,
            status: "production",
          });
        }
      } catch (e) {
        console.error("startProductionStage live start error:", e);
      }

      clearStageTimer();
      setCurrentStage("production");
      setCurrentStagePhaseId(phaseId);
      setStageSeconds(0);

      stageTimerRef.current = window.setInterval(() => {
        setStageSeconds((s) => s + 1);
      }, 1000);
    } finally {
      setIsLoading(false);
    }
  };

  /* ---------------------------------------------------------
     FINISH PRODUCTION (FULL / PARTIAL)
  --------------------------------------------------------- */
  const finishProductionStage = async (isPartial: boolean) => {
    if (!activeLog || !sheet) return;

    const phaseId = String(activeLog.phaseId);
    const remaining = computeRemainingForPhase(phaseId);

    if (remaining <= 0) {
      alert("Nothing remaining to finish.");
      return;
    }

    let quantityDone = remaining;

    if (isPartial) {
      const qtyStr = prompt(`Enter quantity (1–${remaining}):`);
      if (qtyStr === null) return; // user cancelled

      const qty = parseInt(qtyStr.trim(), 10);
      if (!Number.isFinite(qty) || qty <= 0 || qty > remaining) {
        alert("Invalid quantity.");
        return;
      }
      quantityDone = qty;
    }

    clearStageTimer();
    const productionSeconds = stageSeconds;

    setIsLoading(true);
    try {
      await api.finishPhase(
        activeLog.id, // UUID string
        new Date().toISOString(),
        quantityDone,
        productionSeconds
      );

      if (user) {
        api.stopLivePhase(user.username).catch((e) =>
          console.error("finishProductionStage stop live error:", e)
        );
      }

      setActiveLog(null);
      setStageSeconds(0);
      setCurrentStage(null);
      setCurrentStagePhaseId(null);

      // Reload sheet with fresh, normalized logs
      const updatedRaw = await api.getProductionSheetByQr(sheet.qrValue);
      const updated = normalizeSheet(updatedRaw);
      setSheet(updated);
    } finally {
      setIsLoading(false);
    }
  };

  /* ---------------------------------------------------------
     RESET
  --------------------------------------------------------- */
  const resetView = () => {
    setSheet(null);
    setError(null);
    setActiveLog(null);
    clearStageTimer();
    setStageSeconds(0);
    setCurrentStage(null);
    setCurrentStagePhaseId(null);
    setPendingStageTimes({});
    setViewState("idle");
  };

  /* ---------------------------------------------------------
     LOADING
  --------------------------------------------------------- */
  if (isLoading)
    return (
      <>
        <ConfirmModal
          open={modalData.open}
          title={modalData.title}
          message={modalData.message}
          buttons={modalData.buttons}
          onClose={closeModal}
        />
        <div className="text-center p-8">{t("common.loading")}</div>
      </>
    );

  /* ---------------------------------------------------------
     SCANNING
  --------------------------------------------------------- */
  if (viewState === "scanning")
    return (
      <>
        <ConfirmModal
          open={modalData.open}
          title={modalData.title}
          message={modalData.message}
          buttons={modalData.buttons}
          onClose={closeModal}
        />
        <div className="max-w-xl mx-auto">
          <Scanner
            onScanSuccess={handleScanSuccess}
            onScanError={(msg) => setError(msg)}
          />
          <button
            onClick={() => setViewState("idle")}
            className="mt-4 w-full bg-gray-500 text-white py-2 rounded-md"
          >
            {t("common.cancel")}
          </button>

          {error && (
            <p className="mt-4 text-red-500 bg-red-100 p-3 rounded-md">
              {error}
            </p>
          )}
        </div>
      </>
    );

  /* ---------------------------------------------------------
     DETAILS GUARDS
  --------------------------------------------------------- */
  if (viewState === "details") {
    if (!sheet) return <div style={{ padding: 20 }}>DEBUG: no sheet</div>;

    if (!sheet.product || !Array.isArray(sheet.product.phases))
      return (
        <div style={{ padding: 20 }}>
          Invalid sheet structure
          <br />
          {JSON.stringify(sheet, null, 2)}
        </div>
      );
  }

  /* ---------------------------------------------------------
     DETAILS VIEW
  --------------------------------------------------------- */
  if (viewState === "details" && sheet) {
    const logs = sheet.phaseLogs ?? [];

    return (
      <>
        <ConfirmModal
          open={modalData.open}
          title={modalData.title}
          message={modalData.message}
          buttons={modalData.buttons}
          onClose={closeModal}
        />

        <div className="bg-white p-6 rounded-lg shadow-lg max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold mb-4">
            {t("machineOperator.sheetDetails")}
          </h2>

          {/* SHEET INFO */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 p-4 bg-gray-50 rounded-md">
            <p>
              <strong>{t("machineOperator.orderNum")}:</strong>{" "}
              {sheet.orderNumber}
            </p>
            <p>
              <strong>{t("machineOperator.sheetNum")}:</strong>{" "}
              {sheet.productionSheetNumber}
            </p>
            <p>
              <strong>{t("machineOperator.product")}:</strong>{" "}
              {sheet.productId}
            </p>
            <p>
              <strong>{t("machineOperator.qty")}:</strong> {sheet.quantity}
            </p>
          </div>

          {/* MATERIAL INFO */}
          {Array.isArray(materialInfo) && materialInfo.length > 0 && (
            <div className="p-4 my-4 border rounded-md bg-indigo-50">
              <h4 className="font-semibold mb-2">
                {t("machineOperator.materialInfo")}
              </h4>

              <div className="space-y-3">
                {materialInfo.map((mat) => (
                  <div key={mat.id} className="p-3 bg-white border rounded-md">
                    <p>
                      <strong>{t("common.material")}:</strong>{" "}
                      {mat.materialCode}
                    </p>
                    <p>
                      <strong>{t("common.quantity")}:</strong>{" "}
                      {mat.currentQuantity} / {mat.initialQuantity}
                    </p>
                    <p>
                      <strong>{t("common.location")}:</strong>{" "}
                      {mat.location
                        ? `${mat.location.area}, Pos ${mat.location.position}`
                        : t("common.na")}
                    </p>
                    <p>
                      <strong>ID:</strong> {mat.id}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PHASES */}
          <h3 className="text-xl font-semibold mb-2">
            {t("machineOperator.phases")}
          </h3>

          <div className="space-y-3">
            {sheet.product.phases.map((phase: any, index: number) => {
              const phaseId = String(phase.phaseId);

              const status = phaseStatuses.get(phaseId) || {
                done: 0,
                total: sheet.quantity,
                inProgress: false,
              };

              const isUnlocked =
                index === 0 ||
                (phaseStatuses.get(
                  String(sheet.product.phases[index - 1].phaseId)
                )?.done || 0) > 0;

              const prevDone =
                index === 0
                  ? sheet.quantity
                  : phaseStatuses.get(
                      String(sheet.product.phases[index - 1].phaseId)
                    )?.done || 0;

              const canStartQty = Math.max(0, prevDone - status.done);

              const hasSetup =
                (sheet.product.phases.find(
                  (p: any) => String(p.phaseId) === phaseId
                )?.setupTime || 0) > 0;

              const isPhaseLocked = canStartQty <= 0;

              const isMyCurrentPhase =
                currentStagePhaseId === phaseId && currentStage !== null;
              const isRunningFind =
                isMyCurrentPhase && currentStage === "find";
              const isRunningSetup =
                isMyCurrentPhase && currentStage === "setup";
              const isRunningProduction =
                isMyCurrentPhase && currentStage === "production";

              return (
                <div
                  key={phaseId}
                  className="p-3 border rounded-md flex justify-between items-center bg-white"
                >
                  {/* LEFT SIDE */}
                  <div>
                    <p className="font-bold text-lg">
                      {phases.find((p) => String(p.id) === phaseId)?.name ||
                        `Phase ${phaseId}`}
                    </p>

                    <div className="text-sm text-gray-600 space-y-1">
                      <p>
                        {t("machineOperator.status")}{" "}
                        <span className="font-semibold">
                          {status.done} / {sheet.quantity}
                        </span>
                      </p>

                      {/* IN PROGRESS */}
                      {logs.some(
                        (l) => !l.endTime && String(l.phaseId) === phaseId
                      ) && (
                        <p className="text-yellow-600">
                          🟡 In progress by{" "}
                          {logs
                            .filter(
                              (l) =>
                                !l.endTime &&
                                String(l.phaseId) === phaseId
                            )
                            .map((l) => l.operatorUsername)
                            .join(", ")}
                        </p>
                      )}

                      {/* DONE */}
                      {logs.some(
                        (l) => l.endTime && String(l.phaseId) === phaseId
                      ) && (
                        <p className="text-green-700">
                          ✅ Done by{" "}
                          {logs
                            .filter(
                              (l) =>
                                l.endTime &&
                                String(l.phaseId) === phaseId &&
                                (l.quantityDone || 0) > 0
                            )
                            .map(
                              (l) =>
                                `${l.operatorUsername} (${l.quantityDone})`
                            )
                            .join(", ")}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* RIGHT SIDE */}
                  <div className="flex flex-col items-end gap-2">
                    {/* FIND / SETUP */}
                    {(isRunningFind || isRunningSetup) && (
                      <div className="flex flex-col items-end gap-1">
                        <button
                          onClick={finishSimpleStage}
                          className="btn-secondary"
                        >
                          {t("machineOperator.finish")}
                        </button>
                        <p className="text-xs text-gray-500">
                          {currentStage === "find"
                            ? `Finding Material: ${stageSeconds}s`
                            : `Setup: ${stageSeconds}s`}
                        </p>
                      </div>
                    )}

                    {/* PRODUCTION */}
                    {isRunningProduction && (
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex gap-2">
                          <button
                            onClick={() => finishProductionStage(true)}
                            className="btn-secondary"
                          >
                            {t("machineOperator.finishPartial")}
                          </button>
                          <button
                            onClick={() => finishProductionStage(false)}
                            className="btn-primary"
                          >
                            {t("machineOperator.finishFull")}
                          </button>
                        </div>

                        <p className="text-xs text-gray-500">
                          Production: {stageSeconds}s
                        </p>
                      </div>
                    )}

                    {/* START BUTTONS */}
                    {!currentStage && !isPhaseLocked && isUnlocked && (
                      <div className="flex flex-col items-end gap-2">
                        {(phaseId === "2" || phaseId === "30") && (
                          <button
                            onClick={() =>
                              startSimpleStage(phaseId, "find")
                            }
                            className="btn-secondary"
                          >
                            Find Material
                          </button>
                        )}

                        {hasSetup && (
                          <button
                            onClick={() =>
                              startSimpleStage(phaseId, "setup")
                            }
                            className="btn-secondary"
                          >
                            Start Setup
                          </button>
                        )}

                        <button
                          onClick={() => startProductionStage(phaseId)}
                          className="btn-primary"
                        >
                          Start Production
                        </button>
                      </div>
                    )}

                    {/* BUSY */}
                    {currentStage && !isMyCurrentPhase && (
                      <p className="text-xs text-gray-400">
                        Busy on another phase…
                      </p>
                    )}

                    {/* DONE PHASE */}
                    {isPhaseLocked && (
                      <p className="text-xs text-gray-400">
                        Phase complete
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* BOTTOM BUTTON */}
          <button
            onClick={resetView}
            className="mt-6 w-full text-indigo-600 hover:underline"
          >
            {t("operator.scanAnother")}
          </button>

          {/* BUTTON STYLES */}
          <style>{`
            .btn-primary{
              padding:.5rem 1rem;
              background:#4F46E5;
              color:#fff;
              border-radius:6px;
              font-weight:500;
            }
            .btn-secondary{
              padding:.5rem 1rem;
              background:#E5E7EB;
              color:#374151;
              border-radius:6px;
              font-weight:500;
            }
          `}</style>
        </div>
      </>
    );
  }

  /* ---------------------------------------------------------
     DEFAULT IDLE
  --------------------------------------------------------- */
  return (
    <>
      <ConfirmModal
        open={modalData.open}
        title={modalData.title}
        message={modalData.message}
        buttons={modalData.buttons}
        onClose={closeModal}
      />

      <div className="bg-white p-6 rounded-lg shadow-lg max-w-md mx-auto text-center">
        <h2 className="text-2xl font-bold mb-4">{t("machineOperator.title")}</h2>
        <p className="text-gray-600 mb-6">{t("machineOperator.scanPrompt")}</p>

        <button
          onClick={() => setViewState("scanning")}
          className="w-full bg-indigo-600 text-white py-3 rounded-md"
        >
          {t("machineOperator.startScan")}
        </button>

        {error && (
          <p className="mt-4 text-red-500 bg-red-100 p-3 rounded-md">
            {error}
          </p>
        )}
      </div>
    </>
  );
};

export default MachineOperatorView;
