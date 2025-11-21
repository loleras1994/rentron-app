import React, { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "../hooks/useTranslation";
import * as api from "../api/client";
import type { ProductionSheetForOperator, Phase, PhaseLog, Material } from "../src/types";
import Scanner from "./Scanner";
import { useAuth } from "../hooks/useAuth";
import { useWarehouse } from "../hooks/useWarehouse";
import ConfirmModal from "../components/ConfirmModal";

function resolveMaterialsForPhase(
  sheet: ProductionSheetForOperator | null,
  materials: Material[]
): Material[] {
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

  return materials.filter(
    (wm) =>
      wm.materialCode &&
      candidates.has(String(wm.materialCode).toLowerCase())
  );
}

  // 🔹 Match against warehouse materials (materialCode = sku || name)
  return (
    materials.find(
      (wm) =>
        wm.materialCode &&
        candidates.has(String(wm.materialCode).toLowerCase())
    ) || null
  );
}

const MachineOperatorView: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { materials, loading: warehouseLoading } = useWarehouse();

  const [materialInfo, setMaterialInfo] = useState<Material[] | null>(null);
  const [viewState, setViewState] = useState<"idle" | "scanning" | "details">("idle");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [sheet, setSheet] = useState<ProductionSheetForOperator | null>(null);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [activeLog, setActiveLog] = useState<PhaseLog | null>(null);

  // ⏱️ Timers
  const setupTimer = useRef<number | null>(null);
  const productionTimer = useRef<number | null>(null);
  const findMaterialTimer = useRef<number | null>(null);

  const [setupSeconds, setSetupSeconds] = useState(0);
  const [productionSeconds, setProductionSeconds] = useState(0);
  const [findMaterialSeconds, setFindMaterialSeconds] = useState(0);

  // Modal
  const [modalData, setModalData] = useState({
    open: false,
    title: "",
    message: "",
    buttons: [],
    resolver: null as null | ((v: boolean) => void),
  });

  const openModal = (title, message, buttons) =>
    new Promise<boolean>((resolve) => {
      setModalData({
        open: true,
        title,
        message,
        buttons,
        resolver: resolve,
      });
    });

  const closeModal = (value) => {
    modalData.resolver?.(value);
    setModalData((m) => ({ ...m, open: false }));
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
      // 🟦 Auto-load material info if phase 2 or 30 exists and is not yet done
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
        setMaterialInfo(resolveMaterialsForPhase(data, materials));
      }
      setViewState("details");
    } catch (err) {
      setError((err as Error).message);
      setViewState("idle");
    } finally {
      setIsLoading(false);
    }
  };

  /* === TIMER LOGIC === */
  const startFindMaterial = async (phaseId: string) => {
    const ok = await ensurePreviousPhaseClosed();
    if (!ok) return;
    if (findMaterialTimer.current) return;
    console.log("🔍 Starting find material time for phase", phaseId);
    setFindMaterialSeconds(0);
    // LIVE: searching for materials
    try {
      const def = sheet?.product?.phases?.find((p) => p.phaseId === phaseId);
      if (def && sheet && user) {
        const remainingQty = computeRemainingForPhase(phaseId);
        const plannedTime =
          (def.setupTime || 0) +
          (def.productionTimePerPiece || 0) * remainingQty;

        api.startLivePhase({
          username: user.username,
          sheetId: sheet.id,
          productId: sheet.productId,
          phaseId,
          plannedTime,
          status: "search"
        });
      }
    } catch (e) {
      console.error("Live phase start failed:", e);
    }

    findMaterialTimer.current = window.setInterval(
      () => setFindMaterialSeconds((t) => t + 1),
      1000
    );
  };

  const stopFindMaterialAndStartSetup = (phaseId: string) => {
    if (!findMaterialTimer.current) return;
    clearInterval(findMaterialTimer.current);
    findMaterialTimer.current = null;
    console.log("✅ Finished find material time:", findMaterialSeconds, "s");
    startSetupForPhase(phaseId);
  };

  const startSetupForPhase = async (phaseId: string) => {
    const ok = await ensurePreviousPhaseClosed();
    if (!ok) return;
    // LIVE: starting setup after searching
    try {
      const def = sheet?.product?.phases?.find((p) => p.phaseId === phaseId);
      if (def && sheet && user) {
        const remainingQty = computeRemainingForPhase(phaseId);
        const plannedTime = def.setupTime || 0; // ✔ ONLY SETUP TIME

        api.startLivePhase({
          username: user.username,
          sheetId: sheet.id,
          productId: sheet.productId,
          phaseId,
          plannedTime,
          status: "setup"
        });
      }
    } catch (e) {
      console.error("Live update failed:", e);
    }    
    if (setupTimer.current) return;
    console.log("⏱️ Starting setup for phase:", phaseId);
    setSetupSeconds(0);
    setupTimer.current = window.setInterval(() => setSetupSeconds((t) => t + 1), 1000);
  };

  const stopSetupAndStartProduction = async (phaseId: string) => {
    const ok = await ensurePreviousPhaseClosed();
    if (!ok) return;
    if (!setupTimer.current) return;
    clearInterval(setupTimer.current);
    setupTimer.current = null;
    await handleStartPhase(phaseId, setupSeconds); // Save setup time to DB
    setSetupSeconds(0);

    setProductionSeconds(0);
    productionTimer.current = window.setInterval(() => setProductionSeconds((t) => t + 1), 1000);
  };

  const stopProduction = () => {
    if (productionTimer.current) {
      clearInterval(productionTimer.current);
      productionTimer.current = null;
    }
  };

  /* === PHASE START === */
  const handleStartPhase = async (phaseId: string, setupTime?: number) => {
    const ok = await ensurePreviousPhaseClosed();
    if (!ok) return;
    if (!sheet || !user) return;
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
        findMaterialTime: findMaterialSeconds,
        setupTime,
      });

      setActiveLog(newLog); // ✅ keep active log in memory

      // LIVE: starting production phase
    try {
      const def = sheet?.product?.phases?.find((p) => p.phaseId === phaseId);
      if (def && sheet && user) {
        const remainingQty = computeRemainingForPhase(phaseId);
        const plannedTime =
          (def.productionTimePerPiece || 0) * remainingQty;

        api.startLivePhase({
          username: user.username,
          sheetId: sheet.id,
          productId: sheet.productId,
          phaseId,
          plannedTime,
          status: "production"
        });
      }
    } catch (e) {
      console.error("Live phase start error:", e);
    }

      // 🔴 LIVE DASHBOARD INTEGRATION – END
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
      setFindMaterialSeconds(0);
    }
  };

  /** Compute how many pieces are still allowed for a given phase */
  const computeRemainingForPhase = (phaseId: string): number => {
    if (!sheet) return 0;
    const doneByPhase = new Map<string, number>();
    sheet.product.phases.forEach((p) => doneByPhase.set(p.phaseId, 0));
    sheet.phaseLogs.forEach((log) => {
      doneByPhase.set(log.phaseId, (doneByPhase.get(log.phaseId) || 0) + (log.quantityDone || 0));
    });

    const idx = sheet.product.phases.findIndex((p) => p.phaseId === phaseId);
    if (idx < 0) return 0;
    const upstreamDone =
      idx === 0 ? sheet.quantity : (doneByPhase.get(sheet.product.phases[idx - 1].phaseId) || 0);
    const alreadyDoneHere = doneByPhase.get(phaseId) || 0;
    return Math.max(0, upstreamDone - alreadyDoneHere);
  };

  const handleFinishPhase = async (isPartial: boolean) => {
    if (!activeLog || !sheet) return;

    const phaseId = activeLog.phaseId;
    const remainingForPhase = computeRemainingForPhase(phaseId);
    if (remainingForPhase <= 0) {
      alert(t("common.nothingToFinish") || "Nothing to finish for this phase.");
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

    stopProduction();

    setIsLoading(true);
    try {
      await api.finishPhase(
        activeLog.id,
        new Date().toISOString(),
        quantityDone,
        productionSeconds
      );

      // 🔴 LIVE DASHBOARD INTEGRATION – STOP
      if (user) {
        api
          .stopLivePhase(user.username)
          .catch((e) => console.error("Live phase stop failed:", e));
      }

      setActiveLog(null);
      setProductionSeconds(0);
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
    stopProduction();
    if (setupTimer.current) clearInterval(setupTimer.current);
    if (findMaterialTimer.current) clearInterval(findMaterialTimer.current);
    setSetupSeconds(0);
    setProductionSeconds(0);
    setFindMaterialSeconds(0);
    setViewState("idle");
  };

  /* === STATUS === */
  const phaseStatuses = useMemo(() => {
    if (!sheet) return new Map();
    const statuses = new Map<string, { done: number; total: number; inProgress: boolean }>();
    sheet.product.phases.forEach((p) =>
      statuses.set(p.phaseId, { done: 0, total: sheet.quantity, inProgress: false })
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
	  hasRelevantPhase && !isDone ? resolveMaterialsForPhase(sheet, materials) : null
	);
  }, [sheet, materials]);

  // 🔥 Check if user is currently in another phase
  // Shows modal options: finish partial / finish full / cancel
  const ensurePreviousPhaseClosed = async () => {
    if (!activeLog) return true;

    // Step 1 — ask full finish or go to step 2
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
      await handleFinishPhase(false); // full finish
      return true;
    }

    // Step 2 — ask partial or abort
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
      await handleFinishPhase(true); // partial
      return true;
    }

    return false; // abort
  };


  if (isLoading) return <div className="text-center p-8">{t("common.loading")}</div>;
  
  {modalData.open && (
  <ConfirmModal
    open={modalData.open}
    title={modalData.title}
    message={modalData.message}
    buttons={modalData.buttons}
    onClose={closeModal}
  />
)}

  if (viewState === "scanning")
    return (
      <div className="max-w-xl mx-auto">
        <Scanner onScanSuccess={handleScanSuccess} onScanError={(msg) => setError(msg)} />
        <button
          onClick={() => setViewState("idle")}
          className="mt-4 w-full bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600"
        >
          {t("common.cancel")}
        </button>
        {error && <p className="mt-4 text-red-500 bg-red-100 p-3 rounded-md">{error}</p>}
      </div>
    );

  if (viewState === "details" && sheet)
    return (
      <div className="bg-white p-6 rounded-lg shadow-lg max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">
          {t("machineOperator.sheetDetails")}
        </h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 p-4 bg-gray-50 rounded-md">
          <p><strong>{t("machineOperator.orderNum")}:</strong> {sheet.orderNumber}</p>
          <p><strong>{t("machineOperator.sheetNum")}:</strong> {sheet.productionSheetNumber}</p>
          <p><strong>{t("machineOperator.product")}:</strong> {sheet.productId}</p>
          <p><strong>{t("machineOperator.qty")}:</strong> {sheet.quantity}</p>
        </div>

        {/* 🔹 Material location and quantity info (only for phases 2 or 30) */}
		{Array.isArray(materialInfo) && materialInfo.length > 0 && (
		  <div className="p-4 my-4 border rounded-md bg-indigo-50">
			<h4 className="font-semibold text-indigo-700 mb-2">
			  {t("machineOperator.materialInfo") || "Material Information"}
			</h4>

			<div className="space-y-3">
			  {materialInfo.map((mat) => (
				<div key={mat.id} className="p-3 bg-white rounded-md border">
				  <p><strong>{t("common.material")}:</strong> {mat.materialCode}</p>
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
				  <p><strong>ID:</strong> {mat.id}</p>
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
              index === 0 || phaseStatuses.get(sheet.product.phases[index - 1].phaseId)!.done > 0;
            const canStartQty =
              Math.max(
                0,
                (index === 0
                  ? sheet.quantity
                  : phaseStatuses.get(sheet.product.phases[index - 1].phaseId)!.done) - status.done
              );
            const myActiveLog =
              (activeLog && !activeLog.endTime && activeLog.phaseId === phase.phaseId && activeLog.operatorUsername === user?.username)
                ? activeLog
                : sheet.phaseLogs.find(
                    (l) => !l.endTime && l.phaseId === phase.phaseId && l.operatorUsername === user?.username
                  );

            const hasSetup =
              !!(sheet.product.phases.find((p) => p.phaseId === phase.phaseId)?.setupTime &&
              sheet.product.phases.find((p) => p.phaseId === phase.phaseId)?.setupTime! > 0);

            return (
              <div
                key={phase.phaseId}
                className="p-3 border rounded-md flex justify-between items-center bg-white"
              >
                <div>
                  <p className="font-bold text-lg">
                    {phases.find((p) => p.id === phase.phaseId)?.name || `Phase ${phase.phaseId}`}
                  </p>
                  <div className="text-sm text-gray-600 space-y-1">
                    <p>
                      {t("machineOperator.status")}:{" "}
                      <span className="font-semibold">{status.done} / {sheet.quantity}</span>
                    </p>

                    {sheet.phaseLogs.some(l => !l.endTime && l.phaseId === phase.phaseId) && (
                      <p className="text-yellow-600">
                        🟡 In progress by{" "}
                        {sheet.phaseLogs
                          .filter(l => !l.endTime && l.phaseId === phase.phaseId)
                          .map(l => l.operatorUsername)
                          .join(", ")}
                      </p>
                    )}

                    {sheet.phaseLogs.some(l => l.endTime && l.phaseId === phase.phaseId) && (
                      <p className="text-green-700">
                        ✅ Done by{" "}
                        {sheet.phaseLogs
                          .filter(l => l.endTime && l.phaseId === phase.phaseId && l.quantityDone > 0)
                          .map(l => `${l.operatorUsername} (${l.quantityDone})`)
                          .join(", ")}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  {myActiveLog ? (
                    <div className="flex gap-2">
                      <button onClick={() => handleFinishPhase(true)} className="btn-secondary">
                        {t("machineOperator.finishPartial")}
                      </button>
                      <button onClick={() => handleFinishPhase(false)} className="btn-primary">
                        {t("machineOperator.finishFull")}
                      </button>
                    </div>
                  ) : (
                    canStartQty > 0 &&
                    isUnlocked && (
                      <div className="flex flex-col gap-2 items-end">
                        {/* 🔹 Special flow for Phase 2 or 30 */}
                        {(phase.phaseId === "2" || phase.phaseId === "30") ? (
                          <>
                            {!findMaterialTimer.current && !setupTimer.current && (
                              <button
                                onClick={() => startFindMaterial(phase.phaseId)}
                                className="btn-secondary"
                              >
                                Start Find Material
                              </button>
                            )}
                            {findMaterialTimer.current && !setupTimer.current && (
                              <button
                                onClick={() => stopFindMaterialAndStartSetup(phase.phaseId)}
                                className="btn-secondary"
                              >
                                Finish Find Material / Start Setup
                              </button>
                            )}
                            {setupTimer.current && (
                              <button
                                onClick={() => stopSetupAndStartProduction(phase.phaseId)}
                                className="btn-primary"
                              >
                                Start Production
                              </button>
                            )}
                          </>
                        ) : (
                          <>
                            {hasSetup && (
                              <button
                                onClick={() => startSetupForPhase(phase.phaseId)}
                                className={`btn-secondary ${setupTimer.current ? "opacity-50 cursor-not-allowed" : ""}`}
                                disabled={!!setupTimer.current}
                              >
                                Start Setup
                              </button>
                            )}
                            <button
                              onClick={() =>
                                hasSetup
                                  ? stopSetupAndStartProduction(phase.phaseId)
                                  : handleStartPhase(phase.phaseId)
                              }
                              className={`btn-primary ${hasSetup && !setupTimer.current ? "opacity-50 cursor-not-allowed" : ""}`}
                              disabled={hasSetup && !setupTimer.current}
                            >
                              {hasSetup ? "Start Production" : "Start Phase"}
                            </button>
                          </>
                        )}

                        {/* Display timer info */}
                        {(phase.phaseId === "2" || phase.phaseId === "30") && (
                          <p className="text-xs text-gray-500 mt-1">
                            {findMaterialTimer.current
                              ? `Finding Material: ${findMaterialSeconds}s`
                              : setupTimer.current
                              ? `Setup Time: ${setupSeconds}s`
                              : productionTimer.current
                              ? `Production Time: ${productionSeconds}s`
                              : ""}
                          </p>
                        )}
                      </div>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <button onClick={resetView} className="mt-6 w-full text-indigo-600 hover:underline">
          {t("operator.scanAnother")}
        </button>

        <style>{`
          .btn-primary { padding: 0.5rem 1rem; background-color: #4F46E5; color: white; border-radius: 0.375rem; font-weight: 500; }
          .btn-secondary { padding: 0.5rem 1rem; background-color: #E5E7EB; color: #374151; border-radius: 0.375rem; font-weight: 500; }
        `}</style>
      </div>
    );

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-md mx-auto text-center">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">{t("machineOperator.title")}</h2>
      <p className="text-gray-600 mb-6">{t("machineOperator.scanPrompt")}</p>
      <button
        onClick={() => setViewState("scanning")}
        className="w-full bg-indigo-600 text-white py-3 px-4 rounded-md hover:bg-indigo-700 font-semibold"
      >
        {t("machineOperator.startScan")}
      </button>
      {error && <p className="mt-4 text-red-500 bg-red-100 p-3 rounded-md">{error}</p>}
    </div>
  );
};

export default MachineOperatorView;
