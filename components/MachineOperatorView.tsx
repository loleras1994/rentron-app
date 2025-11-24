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

type StageType = "find" | "setup" | "production";

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
    if (typeof m === "string") {
      candidates.add(m.toLowerCase());
    } else if (m) {
      if (m.materialId) candidates.add(String(m.materialId).toLowerCase());
      if (m.materialCode) candidates.add(String(m.materialCode).toLowerCase());
      if (m.sku) candidates.add(String(m.sku).toLowerCase());
      if (m.name) candidates.add(String(m.name).toLowerCase());
    }
  }

  return (
    materials.filter(
      (wm) =>
        wm.materialCode &&
        candidates.has(String(wm.materialCode).toLowerCase())
    ) || []
  );
};

const MachineOperatorView: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { materials, loading: warehouseLoading } = useWarehouse();

  const [materialInfo, setMaterialInfo] = useState<Material[] | null>(null);
  const [viewState, setViewState] =
    useState<"idle" | "scanning" | "details">("idle");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [sheet, setSheet] = useState<ProductionSheetForOperator | null>(null);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [activeLog, setActiveLog] = useState<PhaseLog | null>(null);

  // 🔹 ΕΝΙΑΙΟ STAGE TIMER (για find/setup/production)
  const [currentStage, setCurrentStage] = useState<StageType | null>(null);
  const [currentStagePhaseId, setCurrentStagePhaseId] = useState<string | null>(
    null
  );
  const stageTimerRef = useRef<number | null>(null);
  const [stageSeconds, setStageSeconds] = useState(0);

  // Μαζεμένοι χρόνοι για κάθε phase, που θα σταλούν στο επόμενο startProduction
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

  useEffect(() => {
    api.getPhases().then(setPhases).catch(console.error);
  }, []);

  const handleScanSuccess = async (decodedText: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getProductionSheetByQr(decodedText);
      setSheet(data);

      // Check if the sheet contains phase 2 or 30 (find material)
      const hasPhase2or30 = data.product?.phases?.some((p) =>
        ["2", "30"].includes(p.phaseId)
      );

      const phase2or30Done = data.phaseLogs?.some(
        (l) =>
          ["2", "30"].includes(l.phaseId) &&
          l.endTime &&
          l.quantityDone >= data.quantity
      );

      if (hasPhase2or30 && !phase2or30Done) {
        const freshMaterials = await api.getMaterials();
        setMaterialInfo(resolveMaterialsForPhase(data, freshMaterials));
      } else {
        setMaterialInfo(null);
      }

      // reset local stage state
      clearStageTimer();
      setCurrentStage(null);
      setCurrentStagePhaseId(null);
      setStageSeconds(0);
      setPendingStageTimes({});
      setActiveLog(null);

      setViewState("details");
    } catch (err) {
      setError((err as Error).message);
      setViewState("idle");
    } finally {
      setIsLoading(false);
    }
  };

  /** Υπολογίζει πόσα κομμάτια ΜΠΟΡΟΥΜΕ ακόμα να τελειώσουμε σε ένα phase */
  const computeRemainingForPhase = (phaseId: string): number => {
    if (!sheet) return 0;
    const doneByPhase = new Map<string, number>();
    sheet.product.phases.forEach((p) => doneByPhase.set(p.phaseId, 0));
    sheet.phaseLogs.forEach((log) => {
      doneByPhase.set(
        log.phaseId,
        (doneByPhase.get(log.phaseId) || 0) + (log.quantityDone || 0)
      );
    });

    const idx = sheet.product.phases.findIndex((p) => p.phaseId === phaseId);
    if (idx < 0) return 0;

    const upstreamDone =
      idx === 0
        ? sheet.quantity
        : doneByPhase.get(sheet.product.phases[idx - 1].phaseId) || 0;
    const alreadyDoneHere = doneByPhase.get(phaseId) || 0;
    return Math.max(0, upstreamDone - alreadyDoneHere);
  };

  // 🔥 Έλεγχος αν τρέχει ήδη άλλο production phase για αυτόν τον χρήστη
  // (ώστε να ζητήσουμε partial/full finish πριν ξεκινήσει άλλο)
  const ensurePreviousPhaseClosed = async () => {
    if (!activeLog) return true;

    // Step 1 — Full finish ή επόμενο βήμα
    const firstChoice = await openModal(
      "Previous Phase Still Running",
      "⚠ You are already working on another phase.\n\n" +
        "Choose what to do with the previous phase:",
      [
        {
          label: "Finish FULLY",
          type: "primary",
          onClick: () => closeModal(true),
        },
        {
          label: "Next Options…",
          type: "secondary",
          onClick: () => closeModal(false),
        },
      ]
    );

    if (firstChoice) {
      await finishProductionStage(false);
      return true;
    }

    // Step 2 — Partial ή Abort
    const secondChoice = await openModal(
      "Finish Partially or Abort",
      "Choose how to handle the previous phase:",
      [
        {
          label: "Finish PARTIALLY",
          type: "primary",
          onClick: () => closeModal(true),
        },
        {
          label: "Abort",
          type: "danger",
          onClick: () => closeModal(false),
        },
      ]
    );

    if (secondChoice) {
      await finishProductionStage(true);
      return true;
    }

    return false;
  };

  /* === START STAGE (find/setup) === */
  const startSimpleStage = async (phaseId: string, stage: StageType) => {
    if (stage === "production") return;

    if (currentStage) {
      alert(
        t("machineOperator.finishCurrentStage") ||
          "Finish the current stage first."
      );
      return;
    }

    const ok = await ensurePreviousPhaseClosed();
    if (!ok) return;
    if (!sheet || !user) return;

    const remainingForPhase = computeRemainingForPhase(phaseId);
    if (remainingForPhase <= 0) {
      alert(
        t("common.nothingToStart") || "Nothing to start for this phase."
      );
      return;
    }

    setCurrentStage(stage);
    setCurrentStagePhaseId(phaseId);
    setStageSeconds(0);

    // LIVE DASHBOARD για search/setup
    try {
      const def = sheet.product?.phases?.find((p) => p.phaseId === phaseId);
      if (def) {
        const plannedTime =
          (def.setupTime || 0) +
          (def.productionTimePerPiece || 0) * remainingForPhase;

        await api.startLivePhase({
          username: user.username,
          sheetId: sheet.id,
          productId: sheet.productId,
          phaseId,
          plannedTime,
          status: stage === "find" ? "search" : "setup",
        });
      }
    } catch (e) {
      console.error("Live phase start failed:", e);
    }

    stageTimerRef.current = window.setInterval(() => {
      setStageSeconds((s) => s + 1);
    }, 1000);
  };

  /* === FINISH STAGE (find/setup) === */
  const finishSimpleStage = async () => {
    if (!currentStage || !currentStagePhaseId) return;
    if (currentStage === "production") return;

    clearStageTimer();
    const phaseId = currentStagePhaseId;
    const seconds = stageSeconds;

    setPendingStageTimes((prev) => {
      const prevData = prev[phaseId] || { find: 0, setup: 0 };
      if (currentStage === "find") {
        return {
          ...prev,
          [phaseId]: { ...prevData, find: prevData.find + seconds },
        };
      } else {
        return {
          ...prev,
          [phaseId]: { ...prevData, setup: prevData.setup + seconds },
        };
      }
    });

    try {
      if (user) {
        await api.stopLivePhase(user.username);
      }
    } catch (e) {
      console.error("Live phase stop failed:", e);
    }

    setStageSeconds(0);
    setCurrentStage(null);
    setCurrentStagePhaseId(null);
  };

  /* === START PRODUCTION === */
  const startProductionStage = async (phaseId: string) => {
    if (currentStage) {
      alert(
        t("machineOperator.finishCurrentStage") ||
          "Finish the current stage first."
      );
      return;
    }
    const ok = await ensurePreviousPhaseClosed();
    if (!ok) return;
    if (!sheet || !user) return;

    const remainingForPhase = computeRemainingForPhase(phaseId);
    if (remainingForPhase <= 0) {
      alert(
        t("common.nothingToStart") || "Nothing to start for this phase."
      );
      return;
    }

    const times = pendingStageTimes[phaseId] || { find: 0, setup: 0 };

    setIsLoading(true);
    try {
      const newLog = await api.startPhase({
        operatorUsername: user.username,
        orderNumber: sheet.orderNumber,
        productionSheetNumber: sheet.productionSheetNumber,
        productId: sheet.productId,
        phaseId,
        startTime: new Date().toISOString(),
        totalQuantity: sheet.quantity,
        findMaterialTime: times.find,
        setupTime: times.setup,
      });

      setActiveLog(newLog);

      // Καθαρίζουμε τους pending times για αυτό το phase
      setPendingStageTimes((prev) => {
        const copy = { ...prev };
        delete copy[phaseId];
        return copy;
      });

      // LIVE: production
      try {
        const def = sheet.product?.phases?.find((p) => p.phaseId === phaseId);
        if (def) {
          const plannedTime =
            (def.productionTimePerPiece || 0) * remainingForPhase;
          await api.startLivePhase({
            username: user.username,
            sheetId: sheet.id,
            productId: sheet.productId,
            phaseId,
            plannedTime,
            status: "production",
          });
        }
      } catch (e) {
        console.error("Live phase start error:", e);
      }

      // Timer για production
      setCurrentStage("production");
      setCurrentStagePhaseId(phaseId);
      setStageSeconds(0);
      stageTimerRef.current = window.setInterval(() => {
        setStageSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  /* === FINISH PRODUCTION (partial/full) === */
  const finishProductionStage = async (isPartial: boolean) => {
    if (!activeLog || !sheet) return;
    const phaseId = activeLog.phaseId;
    const remainingForPhase = computeRemainingForPhase(phaseId);

    if (remainingForPhase <= 0) {
      alert(
        t("common.nothingToFinish") || "Nothing to finish for this phase."
      );
      return;
    }

    let quantityDone = remainingForPhase;
    if (isPartial) {
      const qtyStr = prompt(t("machineOperator.enterPartialQty"));
      const qty = parseInt(qtyStr || "0", 10);
      if (qty <= 0 || qty > remainingForPhase) {
        alert(t("common.invalidQuantity") || "Invalid quantity");
        return;
      }
      quantityDone = qty;
    }

    clearStageTimer();
    const productionSeconds = stageSeconds;

    setIsLoading(true);
    try {
      await api.finishPhase(
        Number(activeLog.id),
        new Date().toISOString(),
        quantityDone,
        productionSeconds
      );

      if (user) {
        api
          .stopLivePhase(user.username)
          .catch((e) => console.error("Live phase stop failed:", e));
      }

      setActiveLog(null);
      setStageSeconds(0);
      setCurrentStage(null);
      setCurrentStagePhaseId(null);

      // ξαναφορτώνουμε το sheet για να δούμε updated logs / quantities
      await handleScanSuccess(sheet.qrValue);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

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

  /* === STATUS === */
  const phaseStatuses = useMemo(() => {
    if (!sheet) return new Map();
    const statuses = new Map<
      string,
      { done: number; total: number; inProgress: boolean }
    >();
    sheet.product.phases.forEach((p) =>
      statuses.set(p.phaseId, {
        done: 0,
        total: sheet.quantity,
        inProgress: false,
      })
    );
    sheet.phaseLogs.forEach((log) => {
      const status = statuses.get(log.phaseId)!;
      status.done += log.quantityDone;
      if (!log.endTime) status.inProgress = true;
    });
    return statuses;
  }, [sheet]);

  useEffect(() => {
    if (!sheet) return setMaterialInfo(null);

    const phaseIdsToCheck = ["2", "30"];
    const hasRelevantPhase = sheet.product?.phases?.some((p) =>
      phaseIdsToCheck.includes(p.phaseId)
    );
    const isDone = sheet.phaseLogs?.some(
      (l) =>
        phaseIdsToCheck.includes(l.phaseId) &&
        l.endTime &&
        l.quantityDone >= sheet.quantity
    );

    setMaterialInfo(
      hasRelevantPhase && !isDone
        ? resolveMaterialsForPhase(sheet, materials)
        : null
    );
  }, [sheet, materials]);

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
            className="mt-4 w-full bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600"
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

  if (viewState === "details" && sheet)
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
          <h2 className="text-2xl font-bold text-gray-800 mb-4">
            {t("machineOperator.sheetDetails")}
          </h2>

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

          {/* 🔹 Material location and quantity info (only for phases 2 or 30) */}
          {Array.isArray(materialInfo) && materialInfo.length > 0 && (
            <div className="p-4 my-4 border rounded-md bg-indigo-50">
              <h4 className="font-semibold text-indigo-700 mb-2">
                {t("machineOperator.materialInfo") || "Material Information"}
              </h4>

              <div className="space-y-3">
                {materialInfo.map((mat) => (
                  <div
                    key={mat.id}
                    className="p-3 bg-white rounded-md border"
                  >
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

          <h3 className="text-xl font-semibold text-gray-700 mb-2">
            {t("machineOperator.phases")}
          </h3>

          <div className="space-y-3">
            {sheet.product.phases.map((phase, index) => {
              const status = phaseStatuses.get(phase.phaseId)!;
              const isUnlocked =
                index === 0 ||
                phaseStatuses.get(sheet.product.phases[index - 1].phaseId)!
                  .done > 0;
              const canStartQty = Math.max(
                0,
                (index === 0
                  ? sheet.quantity
                  : phaseStatuses.get(
                      sheet.product.phases[index - 1].phaseId
                    )!.done) - status.done
              );
              const hasSetup = !!(
                sheet.product.phases.find(
                  (p) => p.phaseId === phase.phaseId
                )?.setupTime &&
                sheet.product.phases.find(
                  (p) => p.phaseId === phase.phaseId
                )!.setupTime! > 0
              );

              const isPhaseLocked = canStartQty <= 0;

              const isMyCurrentPhase =
                currentStagePhaseId === phase.phaseId && currentStage !== null;
              const isRunningFind =
                isMyCurrentPhase && currentStage === "find";
              const isRunningSetup =
                isMyCurrentPhase && currentStage === "setup";
              const isRunningProduction =
                isMyCurrentPhase && currentStage === "production";

              return (
                <div
                  key={phase.phaseId}
                  className="p-3 border rounded-md flex justify-between items-center bg-white"
                >
                  <div>
                    <p className="font-bold text-lg">
                      {phases.find((p) => p.id === phase.phaseId)?.name ||
                        `Phase ${phase.phaseId}`}
                    </p>
                    <div className="text-sm text-gray-600 space-y-1">
                      <p>
                        {t("machineOperator.status")}:{" "}
                        <span className="font-semibold">
                          {status.done} / {sheet.quantity}
                        </span>
                      </p>

                      {sheet.phaseLogs.some(
                        (l) => !l.endTime && l.phaseId === phase.phaseId
                      ) && (
                        <p className="text-yellow-600">
                          🟡 In progress by{" "}
                          {sheet.phaseLogs
                            .filter(
                              (l) =>
                                !l.endTime && l.phaseId === phase.phaseId
                            )
                            .map((l) => l.operatorUsername)
                            .join(", ")}
                        </p>
                      )}

                      {sheet.phaseLogs.some(
                        (l) => l.endTime && l.phaseId === phase.phaseId
                      ) && (
                        <p className="text-green-700">
                          ✅ Done by{" "}
                          {sheet.phaseLogs
                            .filter(
                              (l) =>
                                l.endTime &&
                                l.phaseId === phase.phaseId &&
                                l.quantityDone > 0
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

                  <div>
                    {/* Αν τρέχει FIND ή SETUP σε αυτό το phase → μόνο Finish */}
                    {isRunningFind || isRunningSetup ? (
                      <div className="flex flex-col items-end gap-1">
                        <button
                          onClick={finishSimpleStage}
                          className="btn-secondary"
                        >
                          {t("machineOperator.finish") || "Finish"}
                        </button>
                        <p className="text-xs text-gray-500 mt-1">
                          {currentStage === "find"
                            ? `Finding Material: ${stageSeconds}s`
                            : `Setup Time: ${stageSeconds}s`}
                        </p>
                      </div>
                    ) : null}

                    {/* Αν τρέχει PRODUCTION σε αυτό το phase → Partial + Full Finish */}
                    {isRunningProduction ? (
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
                        <p className="text-xs text-gray-500 mt-1">
                          {`Production Time: ${stageSeconds}s`}
                        </p>
                      </div>
                    ) : null}

                    {/* Αν δεν τρέχει κανένα stage αυτή τη στιγμή */}
                    {!currentStage && !isPhaseLocked && isUnlocked && (
                      <div className="flex flex-col gap-2 items-end">
                        {(phase.phaseId === "2" ||
                          phase.phaseId === "30") && (
                          <button
                            onClick={() =>
                              startSimpleStage(phase.phaseId, "find")
                            }
                            className="btn-secondary"
                          >
                            Start Find Material
                          </button>
                        )}

                        {hasSetup && (
                          <button
                            onClick={() =>
                              startSimpleStage(phase.phaseId, "setup")
                            }
                            className="btn-secondary"
                          >
                            Start Setup
                          </button>
                        )}

                        <button
                          onClick={() =>
                            startProductionStage(phase.phaseId)
                          }
                          className="btn-primary"
                        >
                          Start Production
                        </button>
                      </div>
                    )}

                    {/* Αν τρέχει stage σε άλλο phase → μήνυμα ότι είναι απασχολημένος */}
                    {currentStage && !isMyCurrentPhase && (
                      <p className="text-xs text-gray-400">
                        {t("machineOperator.busyOnAnotherPhase") ||
                          "You are currently working on another phase."}
                      </p>
                    )}

                    {/* Αν phase είναι κλειδωμένο */}
                    {isPhaseLocked && (
                      <p className="text-xs text-gray-400">
                        {t("machineOperator.phaseLocked") ||
                          "Phase completed."}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <button
            onClick={resetView}
            className="mt-6 w-full text-indigo-600 hover:underline"
          >
            {t("operator.scanAnother")}
          </button>

          <style>{`
            .btn-primary { padding: 0.5rem 1rem; background-color: #4F46E5; color: white; border-radius: 0.375rem; font-weight: 500; }
            .btn-secondary { padding: 0.5rem 1rem; background-color: #E5E7EB; color: #374151; border-radius: 0.375rem; font-weight: 500; }
          `}</style>
        </div>
      </>
    );

  // Default / idle view
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
        <h2 className="text-2xl font-bold text-gray-800 mb-4">
          {t("machineOperator.title")}
        </h2>
        <p className="text-gray-600 mb-6">
          {t("machineOperator.scanPrompt")}
        </p>
        <button
          onClick={() => setViewState("scanning")}
          className="w-full bg-indigo-600 text-white py-3 px-4 rounded-md hover:bg-indigo-700 font-semibold"
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
