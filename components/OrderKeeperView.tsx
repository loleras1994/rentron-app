import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "../hooks/useTranslation";
import * as api from "../api/client";
import type { Product, ProductForUI, ProductionSheet, Phase } from "../src/types";
import { QRCodeSVG } from "qrcode.react";
import { renderToStaticMarkup } from "react-dom/server";

// --- Reusable Product Definition Section ---
const ProductDefinition: React.FC<{
  product: ProductForUI;
  updateProduct: (p: ProductForUI) => void;
  phasesList: Phase[];
}> = ({ product, updateProduct, phasesList }) => {
  const { t } = useTranslation();
  const qty = (product as any).quantity || 0;

  const updateField = (
    field: "materials" | "phases",
    index: number,
    key: string,
    value: any
  ) => {
    const copy: any = { ...product };

    // ---- MATERIALS ----
    if (field === "materials" && key === "totalQuantity") {
      const total = parseFloat(value) || 0;
      copy.materials[index].totalQuantity = parseFloat(total.toFixed(2));
      copy.materials[index].quantityPerPiece =
        qty > 0 ? parseFloat((total / qty).toFixed(2)) : 0;

      copy.materials[index].position = String((index + 1) * 10);
    }

    // ---- PHASE PRODUCTION TIME ----
    else if (field === "phases" && key === "totalProductionTime") {
      const total = parseFloat(value) || 0;
      copy.phases[index].totalProductionTime = parseFloat(total.toFixed(2));
      copy.phases[index].productionTimePerPiece =
        qty > 0 ? parseFloat((total / qty).toFixed(2)) : 0;

      copy.phases[index].position = String((product.materials.length + index + 1) * 10);
    }

    // ---- PHASE SETUP TIME ----
    else if (field === "phases" && key === "totalSetupTime") {
      const total = parseFloat(value) || 0;
      copy.phases[index].totalSetupTime = parseFloat(total.toFixed(2));
      copy.phases[index].setupTime = parseFloat(total.toFixed(2));

      copy.phases[index].position = String((product.materials.length + index + 1) * 10);
    }

    // ---- DIRECT FIELD ----
    else {
      copy[field][index][key] = value;
    }

    updateProduct(copy);
  };

  const addField = (field: "materials" | "phases") => {
    const copy: any = { ...product };
    if (field === "materials") {
      copy.materials.push({
        materialId: "",
        quantityPerPiece: 0,
        totalQuantity: 0,
        position: String((copy.materials.length + 1) * 10),
      });
    } else {
      copy.phases.push({
        phaseId: phasesList[0]?.id || "",
        setupTime: 0,
        totalSetupTime: 0,
        productionTimePerPiece: 0,
        totalProductionTime: 0,
        position: String((copy.materials.length + copy.phases.length + 1) * 10),
      });
    }
    updateProduct(copy);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
      {/* --- MATERIALS --- */}
      <div>
        <h4 className="font-semibold text-gray-700 mb-2">
          {t("orderkeeper.materials")} (per piece)
        </h4>

        {product.materials.map((m: any, i: number) => {
          const totalQty =
            m.totalQuantity !== undefined ? m.totalQuantity : m.quantityPerPiece * qty;

          return (
            <div key={i} className="grid grid-cols-2 gap-2 mb-2">
              <input
                type="text"
                placeholder={t("orderkeeper.materialId")}
                value={m.materialId}
                onChange={(e) => updateField("materials", i, "materialId", e.target.value)}
                className="input-style"
              />

              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  {t("orderkeeper.qtyPerPiece")}: {Number(m.quantityPerPiece || 0).toFixed(2)}
                </label>
                <input
                  type="number"
                  placeholder="Total qty"
                  value={totalQty}
                  onChange={(e) => updateField("materials", i, "totalQuantity", e.target.value)}
                  className="input-style"
                />
              </div>
            </div>
          );
        })}

        <button onClick={() => addField("materials")} className="btn-secondary text-sm">
          {t("orderkeeper.addMaterial")}
        </button>
      </div>

      {/* --- PHASES --- */}
      <div>
        <h4 className="font-semibold text-gray-700 mb-2">
          {t("orderkeeper.phases")} (per piece)
        </h4>

        {product.phases.map((p: any, i: number) => {
          const totalProd =
            p.totalProductionTime !== undefined
              ? p.totalProductionTime
              : p.productionTimePerPiece * qty;

          const totalSetup = p.totalSetupTime !== undefined ? p.totalSetupTime : p.setupTime;

          return (
            <div key={i} className="grid grid-cols-3 gap-2 mb-2">
              <select
                value={p.phaseId}
                onChange={(e) => updateField("phases", i, "phaseId", e.target.value)}
                className="input-style"
              >
                {phasesList.map((phase) => (
                  <option key={phase.id} value={phase.id}>
                    {phase.name}
                  </option>
                ))}
              </select>

              {/* SETUP TIME */}
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  Setup (per phase): {Number(p.setupTime || 0).toFixed(1)} min
                </label>
                <input
                  type="number"
                  placeholder="Setup (min)"
                  value={totalSetup}
                  onChange={(e) => updateField("phases", i, "totalSetupTime", e.target.value)}
                  className="input-style"
                />
              </div>

              {/* PRODUCTION TIME */}
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  Prod (per piece): {Number(p.productionTimePerPiece || 0).toFixed(2)} min
                </label>
                <input
                  type="number"
                  placeholder="Total (min)"
                  value={totalProd}
                  onChange={(e) =>
                    updateField("phases", i, "totalProductionTime", e.target.value)
                  }
                  className="input-style"
                />
              </div>
            </div>
          );
        })}

        <button onClick={() => addField("phases")} className="btn-secondary text-sm">
          {t("orderkeeper.addPhase")}
        </button>
      </div>
    </div>
  );
};

export { ProductDefinition };

// --- Main OrderKeeperView Component ---
type Mode = "idle" | "create" | "update" | "reprint";

const OrderKeeperView: React.FC = () => {
  const { t } = useTranslation();

  const [mode, setMode] = useState<Mode>("idle");
  const [modeLocked, setModeLocked] = useState(false);

  const [orderNumber, setOrderNumber] = useState("");
  const [orderLocked, setOrderLocked] = useState(false);

  // ✅ NEW: for update mode - target a single sheet instead of loading all
  const [targetSheetNumber, setTargetSheetNumber] = useState("");
  const [sheetLocked, setSheetLocked] = useState(false);

  const [sheets, setSheets] = useState<
    { number: string; productId: string; quantity: string; productDef: ProductForUI }[]
  >([]);

  const [generatedSheets, setGeneratedSheets] = useState<ProductionSheet[]>([]);
  const [existingSheetsForReprint, setExistingSheetsForReprint] = useState<ProductionSheet[]>(
    []
  );
  const [selectedSheetsToReprint, setSelectedSheetsToReprint] = useState<string[]>([]);

  const [existingProducts, setExistingProducts] = useState<Product[]>([]);
  const [phasesList, setPhasesList] = useState<Phase[]>([]);

  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    api.getProducts().then(setExistingProducts);
    api.getPhases().then(setPhasesList);
  }, []);

  // ✅ NEW: update mode requires sheetLocked too
  const canProceed = useMemo(() => {
    if (!modeLocked || !orderLocked) return false;
    if (mode === "update") return sheetLocked;
    return true;
  }, [modeLocked, orderLocked, sheetLocked, mode]);

  const resetAll = () => {
    setOrderNumber("");
    setOrderLocked(false);
    setTargetSheetNumber("");
    setSheetLocked(false);
    setMode("idle");
    setModeLocked(false);
    setSheets([]);
    setExistingSheetsForReprint([]);
    setSelectedSheetsToReprint([]);
    setGeneratedSheets([]);
  };

  const addSheet = () => {
    setSheets((prev) => [
      ...prev,
      {
        number: "",
        productId: "",
        quantity: "",
        productDef: { id: "", name: "", quantity: 0, materials: [], phases: [] },
      },
    ]);
  };

  const updateSheet = (index: number, field: keyof (typeof sheets)[0], value: any) => {
    const newSheets = [...sheets];
    const sheet = { ...newSheets[index] };
    (sheet as any)[field] = value;

    const qty = Math.max(
      0,
      parseInt(field === "quantity" ? value : sheet.quantity || "0", 10) || 0
    );

    if (field === "productId" || field === "quantity") {
      const base = existingProducts.find((p) => p.id === sheet.productId);
      if (base) {
        const copy: any = JSON.parse(JSON.stringify(base));
        copy.name = base.name;
        copy.quantity = qty;

        copy.materials = (copy.materials || []).map((m: any, i: number) => {
          const total = m.totalQuantity ?? m.quantityPerPiece * qty;
          return {
            ...m,
            totalQuantity: total,
            quantityPerPiece: qty > 0 ? total / qty : m.quantityPerPiece,
            position: String((i + 1) * 10),
          };
        });

        copy.phases = (copy.phases || []).map((p: any, i: number) => {
          const totalProd = p.totalProductionTime ?? p.productionTimePerPiece * qty;
          const totalSetup = p.totalSetupTime ?? p.setupTime;
          return {
            ...p,
            totalProductionTime: totalProd,
            productionTimePerPiece: qty > 0 ? totalProd / qty : p.productionTimePerPiece,
            totalSetupTime: totalSetup,
            setupTime: totalSetup,
            position: String((copy.materials.length + i + 1) * 10),
          };
        });

        sheet.productDef = copy;
      }
    }

    newSheets[index] = sheet;
    setSheets(newSheets);
  };

  const toProductDefDTO = (p: ProductForUI): any => ({
    id: p.id,
    name: p.name || p.id,
    materials: (p.materials || []).map((m: any, i: number) => ({
      materialId: m.materialId,
      quantityPerPiece: Number(m.quantityPerPiece || 0),
      totalQuantity: m.totalQuantity != null ? Number(m.totalQuantity) : undefined,
      position: m.position != null ? String(m.position) : String((i + 1) * 10),
    })),
    phases: (p.phases || []).map((ph: any, i: number) => ({
      phaseId: ph.phaseId,
      setupTime: Number(ph.setupTime || 0),
      productionTimePerPiece: Number(ph.productionTimePerPiece || 0),
      totalSetupTime: ph.totalSetupTime != null ? Number(ph.totalSetupTime) : undefined,
      totalProductionTime:
        ph.totalProductionTime != null ? Number(ph.totalProductionTime) : undefined,
      position:
        ph.position != null
          ? String(ph.position)
          : String(((p.materials?.length || 0) + i + 1) * 10),
    })),
  });

  const handleSave = async () => {
    if (!orderNumber.trim() || sheets.length === 0) return;
    setIsSaving(true);

    try {
      // 1) upsert products
      for (const sheet of sheets) {
        const qty = parseInt(sheet.quantity || "0", 10);
        if (!sheet.productId || qty <= 0 || !sheet.productDef) continue;

        const base: any = sheet.productDef;

        const normalizedProduct: Product = {
          id: base.id || sheet.productId,
          name: base.name || sheet.productId,
          materials: (base.materials || []).map((m: any) => {
            const total =
              m.totalQuantity != null
                ? parseFloat(String(m.totalQuantity))
                : (m.quantityPerPiece || 0) * qty;
            return {
              materialId: m.materialId,
              quantityPerPiece: qty > 0 ? total / qty : 0,
            };
          }),
          phases: (base.phases || []).map((p: any) => {
            const totalProd =
              p.totalProductionTime != null
                ? parseFloat(String(p.totalProductionTime))
                : (p.productionTimePerPiece || 0) * qty;
            const setup =
              p.totalSetupTime != null ? parseFloat(String(p.totalSetupTime)) : p.setupTime || 0;
            return {
              phaseId: p.phaseId,
              setupTime: setup,
              productionTimePerPiece: qty > 0 ? totalProd / qty : 0,
            };
          }),
        };

        await api.saveProduct(normalizedProduct);
      }

      // refresh once
      const fresh = await api.getProducts();
      setExistingProducts(fresh);

      // 2) build DTOs
      const sheetDtos = sheets
        .filter((s) => s.productId && parseInt(s.quantity, 10) > 0)
        .map((s) => ({
          productionSheetNumber: s.number,
          productId: s.productId,
          quantity: parseInt(s.quantity, 10),
          orderNumber,
          productDef: toProductDefDTO(s.productDef),
        }));

      if (sheetDtos.length === 0) return;

      // 3) MODE ACTIONS
      if (mode === "update") {
        const results = [];

        for (const sh of sheetDtos) {
          const r = await api.updateProductionSheetForOrder(orderNumber.trim(), sh.productionSheetNumber, {
            quantity: sh.quantity,
            productDef: sh.productDef,
          });

          console.log("✅ UPDATED SHEET RESPONSE:", r);
          results.push(r);
        }

        // If any phases were locked, tell the user clearly
        const locked = results
          .flatMap((r: any) => r?.lockedPhases || [])
          .filter(Boolean);

        if (locked.length > 0) {
          alert(
            `Updated, but some phases were locked (already started): ${[...new Set(locked)].join(
              ", "
            )}`
          );
        } else {
          alert("Order updated successfully.");
        }

        // ✅ Refresh ONLY that one sheet (no loading 100s)
        const refreshed: any = await api.getProductionSheetForOrder(
          orderNumber.trim(),
          sheetDtos[0].productionSheetNumber
        );

        const snap = refreshed.productSnapshot || null;
        const qty = Number(refreshed.quantity || 0);

        const base = snap
          ? {
              id: snap.id || refreshed.productId,
              name: snap.name || (snap.id || refreshed.productId),
              materials: Array.isArray(snap.materials) ? snap.materials : [],
              phases: Array.isArray(snap.phases) ? snap.phases : [],
            }
          : (() => {
              const p = existingProducts.find((x) => x.id === refreshed.productId);
              return {
                id: p?.id || refreshed.productId,
                name: p?.name || refreshed.productId,
                materials: p?.materials || [],
                phases: p?.phases || [],
              };
            })();

        const productDef: any = {
          id: base.id,
          name: base.name,
          quantity: qty,
          materials: (base.materials || []).map((m: any, i: number) => {
            const qpp = Number(m.quantityPerPiece ?? 0);
            const total = Number(m.totalQuantity ?? qpp * qty);
            return {
              materialId: m.materialId,
              quantityPerPiece: qty > 0 ? total / qty : 0,
              totalQuantity: total,
              position: String((i + 1) * 10),
            };
          }),
          phases: (base.phases || []).map((p: any, i: number) => {
            const prodPerPiece = Number(p.productionTimePerPiece ?? 0);
            const totalProd = Number(p.totalProductionTime ?? prodPerPiece * qty);
            const setup = Number(p.totalSetupTime ?? p.setupTime ?? 0);
            return {
              phaseId: p.phaseId,
              setupTime: setup,
              totalSetupTime: setup,
              productionTimePerPiece: qty > 0 ? totalProd / qty : 0,
              totalProductionTime: totalProd,
              position: String(((base.materials?.length || 0) + i + 1) * 10),
            };
          }),
        };

        setSheets([
          {
            number: refreshed.productionSheetNumber,
            productId: refreshed.productId,
            quantity: String(qty),
            productDef,
          },
        ]);

        return; // ✅ don't clear sheets
      } else if (mode === "create") {
        const newSheets = await api.createOrderAndSheets(orderNumber, sheetDtos);
        setGeneratedSheets(newSheets);
      }
    } catch (error) {
      console.error("Failed to save order:", error);
      alert((error as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const printSheets = (sheetsToPrint: ProductionSheet[], layout: "sticker" | "full") => {
    if (sheetsToPrint.length === 0) return;
    const printWindow = window.open("", "_blank", "height=1000,width=800");
    if (!printWindow) return;

    const cellHeight = layout === "full" ? 37.125 : 33.9;
    const verticalPadding = layout === "full" ? 0 : 12.9;

    printWindow.document.write(`
      <html><head><title>Print Production Sheets</title>
      <style>
        @page { size: A4 portrait; margin: 0; }
        @media print { body { -webkit-print-color-adjust: exact; } }
        html, body { margin: 0 !important; padding: 0 !important; background: white; }
        .page {
          display: grid;
          grid-template-columns: repeat(3, 70mm);
          grid-template-rows: repeat(8, ${cellHeight}mm);
          width: 210mm;
          height: 297mm;
          padding: ${verticalPadding}mm 0;
          box-sizing: border-box;
        }
        .cell {
          width: 70mm; height: ${cellHeight}mm;
          display: flex; flex-direction: column;
          justify-content: center; align-items: center;
          text-align: center;
          box-sizing: border-box;
          padding: 2mm; overflow: hidden;
        }
        .cell svg { width: 22mm; height: 22mm; }
        .cell p { margin: 1mm 0 0 0; font-size: 10px; line-height: 1.1; font-weight: bold; }
      </style></head><body><div class="page">`);

    sheetsToPrint.forEach((sheet) => {
      const svg = renderToStaticMarkup(<QRCodeSVG value={sheet.qrValue} size={128} />);
      printWindow.document.write(
        `<div class="cell">${svg}<p>${sheet.productId}</p><p>${sheet.productionSheetNumber}</p></div>`
      );
    });

    printWindow.document.write(`</div></body></html>`);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 350);
  };

  const confirmMode = () => {
    if (mode === "idle") return;
    setModeLocked(true);

    // if create mode, start with one empty sheet
    if (mode === "create") setSheets([]);

    if (mode === "update") {
      setSheets([]);
      setTargetSheetNumber("");
      setSheetLocked(false);
    }

    if (mode === "reprint") {
      setSheets([]);
      setExistingSheetsForReprint([]);
      setSelectedSheetsToReprint([]);
      setTargetSheetNumber("");
      setSheetLocked(false);
    }
  };

  const changeMode = () => {
    setMode("idle");
    setModeLocked(false);
    setOrderNumber("");
    setOrderLocked(false);
    setTargetSheetNumber("");
    setSheetLocked(false);
    setSheets([]);
    setExistingSheetsForReprint([]);
    setSelectedSheetsToReprint([]);
  };

  const confirmOrder = async () => {
    if (!modeLocked) return;
    if (!orderNumber.trim()) return;

    setIsLoading(true);
    try {
      if (mode === "create") {
        // In create, we do NOT need to preload anything
        setOrderLocked(true);
        if (sheets.length === 0) addSheet();
        return;
      }

      if (mode === "update") {
        // ✅ In update: DON'T preload all sheets.
        setOrderLocked(true);
        setSheets([]);
        setTargetSheetNumber("");
        setSheetLocked(false);
        return;
      }

      if (mode === "reprint") {
        const sheetsFromApi = await api.getSheetsByOrderId(orderNumber.trim());

        if (!sheetsFromApi || sheetsFromApi.length === 0) {
          throw new Error("No production sheets found for this order.");
        }

        setExistingSheetsForReprint(sheetsFromApi);
        setOrderLocked(true);
        return;
      }
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  // ✅ NEW: confirm a single target sheet for update mode
  const confirmTargetSheet = async () => {
    if (!orderLocked || mode !== "update") return;
    if (!orderNumber.trim() || !targetSheetNumber.trim()) return;

    setIsLoading(true);
    try {
      const sheet: any = await api.getProductionSheetForOrder(
        orderNumber.trim(),
        targetSheetNumber.trim()
      );

      const snap = sheet.productSnapshot || null;
      const qty = Number(sheet.quantity || 0);

      const base = snap
        ? {
            id: snap.id || sheet.productId,
            name: snap.name || (snap.id || sheet.productId),
            materials: Array.isArray(snap.materials) ? snap.materials : [],
            phases: Array.isArray(snap.phases) ? snap.phases : [],
          }
        : (() => {
            const p = existingProducts.find((x) => x.id === sheet.productId);
            return {
              id: p?.id || sheet.productId,
              name: p?.name || sheet.productId,
              materials: p?.materials || [],
              phases: p?.phases || [],
            };
          })();

      const productDef: any = {
        id: base.id,
        name: base.name,
        quantity: qty,
        materials: (base.materials || []).map((m: any, i: number) => {
          const qpp = Number(m.quantityPerPiece ?? 0);
          const total = Number(m.totalQuantity ?? qpp * qty);
          return {
            materialId: m.materialId,
            quantityPerPiece: qty > 0 ? total / qty : 0,
            totalQuantity: total,
            position: String((i + 1) * 10),
          };
        }),
        phases: (base.phases || []).map((p: any, i: number) => {
          const prodPerPiece = Number(p.productionTimePerPiece ?? 0);
          const totalProd = Number(p.totalProductionTime ?? prodPerPiece * qty);
          const setup = Number(p.totalSetupTime ?? p.setupTime ?? 0);
          return {
            phaseId: p.phaseId,
            setupTime: setup,
            totalSetupTime: setup,
            productionTimePerPiece: qty > 0 ? totalProd / qty : 0,
            totalProductionTime: totalProd,
            position: String(((base.materials?.length || 0) + i + 1) * 10),
          };
        }),
      };

      setSheets([
        {
          number: sheet.productionSheetNumber,
          productId: sheet.productId,
          quantity: String(qty),
          productDef,
        },
      ]);

      setSheetLocked(true);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const changeOrder = () => {
    setOrderNumber("");
    setOrderLocked(false);
    setTargetSheetNumber("");
    setSheetLocked(false);
    setSheets([]);
    setExistingSheetsForReprint([]);
    setSelectedSheetsToReprint([]);
  };

  const handleToggleReprintSelection = (sheetId: string) => {
    setSelectedSheetsToReprint((prev) =>
      prev.includes(sheetId) ? prev.filter((id) => id !== sheetId) : [...prev, sheetId]
    );
  };

  const handlePrintSelected = (layout: "sticker" | "full") => {
    const toPrint = existingSheetsForReprint.filter((s) => selectedSheetsToReprint.includes(s.id));
    if (toPrint.length > 0) printSheets(toPrint, layout);
  };

  if (generatedSheets.length > 0) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-lg max-w-2xl mx-auto text-center">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">{t("header.title")}</h2>
        <p className="text-lg text-gray-600 mb-6">
          {t("orderkeeper.orderCompletePrompt").replace(
            " Print QR codes for all production sheets?",
            ""
          )}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => printSheets(generatedSheets, "sticker")}
            className="w-full sm:w-auto flex justify-center items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700"
          >
            {t("batchCreate.printStickerLayout")}
          </button>
          <button
            onClick={() => printSheets(generatedSheets, "full")}
            className="w-full sm:w-auto flex justify-center items-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            {t("batchCreate.printFullBleedLayout")}
          </button>
        </div>
        <button
          onClick={() => setGeneratedSheets([])}
          className="mt-6 w-full max-w-xs text-indigo-600 hover:underline"
        >
          {t("common.close")}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-5xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">{t("orderkeeper.title")}</h2>

      {/* STEP 1: MODE */}
      <div className="mb-6 p-4 border rounded-md bg-gray-50">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-gray-700">Mode:</span>

            <label className="flex items-center gap-2">
              <input
                type="radio"
                disabled={modeLocked}
                checked={mode === "create"}
                onChange={() => setMode("create")}
              />
              <span>Create</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="radio"
                disabled={modeLocked}
                checked={mode === "update"}
                onChange={() => setMode("update")}
              />
              <span>Update</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="radio"
                disabled={modeLocked}
                checked={mode === "reprint"}
                onChange={() => setMode("reprint")}
              />
              <span>Reprint</span>
            </label>
          </div>

          {!modeLocked ? (
            <button onClick={confirmMode} disabled={mode === "idle"} className="btn-secondary">
              {t("common.confirm")}
            </button>
          ) : (
            <button onClick={changeMode} className="btn-secondary">
              Change mode
            </button>
          )}
        </div>
      </div>

      {/* STEP 2: ORDER NUMBER */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t("orderkeeper.orderNumber")}
        </label>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            placeholder={t("orderkeeper.orderNumberPlaceholder")}
            className="input-style flex-grow"
            disabled={!modeLocked || orderLocked}
          />
          {!orderLocked ? (
            <button onClick={confirmOrder} disabled={!modeLocked} className="btn-secondary">
              {t("common.confirm")}
            </button>
          ) : (
            <button onClick={changeOrder} className="btn-secondary">
              {t("orderkeeper.changeOrder")}
            </button>
          )}
          <button onClick={resetAll} className="btn-secondary">
            Reset
          </button>
        </div>
      </div>

      {/* ✅ STEP 2.5: SHEET NUMBER (only in update mode) */}
      {modeLocked && orderLocked && mode === "update" && !sheetLocked && (
        <div className="mb-6 p-4 border rounded-md bg-gray-50">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Production Sheet Number
          </label>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={targetSheetNumber}
              onChange={(e) => setTargetSheetNumber(e.target.value)}
              placeholder={t("orderkeeper.sheetNumber")}
              className="input-style flex-grow"
            />
            <button
              onClick={confirmTargetSheet}
              disabled={!targetSheetNumber.trim()}
              className="btn-secondary"
            >
              {t("common.confirm")}
            </button>
          </div>
        </div>
      )}

      {isLoading && <div className="text-center p-4">{t("common.loading")}</div>}

      {/* CREATE / UPDATE UI */}
      {canProceed && (mode === "create" || mode === "update") && (
        <>
          <h3 className="text-xl font-semibold text-gray-700 mb-4 border-t pt-4">
            {mode === "create" ? t("orderkeeper.productionSheets") : t("orderkeeper.editTitle")}
          </h3>

          {sheets.map((sheet, i) => (
            <div key={i} className="p-4 border rounded-md mb-4 bg-gray-50">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <input
                  type="text"
                  placeholder={t("orderkeeper.sheetNumber")}
                  value={sheet.number}
                  onChange={(e) => updateSheet(i, "number", e.target.value)}
                  className="input-style"
                  disabled={mode === "update"} // ✅ do not allow renaming in update mode
                />

                <input
                  list="product-ids"
                  placeholder={t("orderkeeper.productId")}
                  value={sheet.productId}
                  onChange={(e) => updateSheet(i, "productId", e.target.value)}
                  className="input-style"
                />
                <datalist id="product-ids">
                  {existingProducts.map((p) => (
                    <option key={p.id} value={p.id} />
                  ))}
                </datalist>

                <input
                  type="number"
                  placeholder={t("orderkeeper.quantity")}
                  value={sheet.quantity}
                  onChange={(e) => updateSheet(i, "quantity", e.target.value)}
                  className="input-style"
                />
              </div>

              {sheet.productId && (
                <ProductDefinition
                  product={sheet.productDef}
                  updateProduct={(p) => updateSheet(i, "productDef", p)}
                  phasesList={phasesList}
                />
              )}
            </div>
          ))}

          <div className="flex gap-3 mt-4">
            {mode === "create" && (
              <button onClick={addSheet} className="btn-secondary">
                {t("orderkeeper.addSheet")}
              </button>
            )}

            <button onClick={handleSave} disabled={isSaving} className="btn-primary">
              {isSaving ? t("orderkeeper.saving") : t("orderkeeper.saveOrder")}
            </button>
          </div>
        </>
      )}

      {/* REPRINT UI */}
      {canProceed && mode === "reprint" && (
        <div className="border-t pt-4">
          <h3 className="text-xl font-semibold text-gray-700 mb-4">
            {t("orderkeeper.reprintTitle", { orderNumber })}
          </h3>

          {existingSheetsForReprint.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left">
                        <input
                          type="checkbox"
                          onChange={(e) =>
                            setSelectedSheetsToReprint(
                              e.target.checked ? existingSheetsForReprint.map((s) => s.id) : []
                            )
                          }
                        />
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        {t("orderkeeper.sheetNumberHeader")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        {t("orderkeeper.productIdHeader")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        {t("orderkeeper.quantityHeader")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {existingSheetsForReprint.map((sheet) => (
                      <tr key={sheet.id}>
                        <td className="px-6 py-4">
                          <input
                            type="checkbox"
                            checked={selectedSheetsToReprint.includes(sheet.id)}
                            onChange={() => handleToggleReprintSelection(sheet.id)}
                          />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {sheet.productionSheetNumber}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {sheet.productId}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {sheet.quantity}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 p-4 border rounded-md bg-gray-50">
                <h4 className="text-md font-semibold text-gray-700 mb-3">Print Options</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-2">
                      {t("orderkeeper.printSelected")} ({selectedSheetsToReprint.length} selected)
                    </p>
                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => handlePrintSelected("sticker")}
                        disabled={selectedSheetsToReprint.length === 0}
                        className="btn-primary text-sm"
                      >
                        {t("batchCreate.printStickerLayout")}
                      </button>
                      <button
                        onClick={() => handlePrintSelected("full")}
                        disabled={selectedSheetsToReprint.length === 0}
                        className="btn-secondary text-sm"
                      >
                        {t("batchCreate.printFullBleedLayout")}
                      </button>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-2">
                      {t("orderkeeper.printAll")} ({existingSheetsForReprint.length} total)
                    </p>
                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => printSheets(existingSheetsForReprint, "sticker")}
                        className="btn-primary text-sm"
                      >
                        {t("batchCreate.printStickerLayout")}
                      </button>
                      <button
                        onClick={() => printSheets(existingSheetsForReprint, "full")}
                        className="btn-secondary text-sm"
                      >
                        {t("batchCreate.printFullBleedLayout")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p className="text-gray-500">{t("orderkeeper.noSheetsFound")}</p>
          )}
        </div>
      )}

      <style>{`
        .input-style { display: block; width: 100%; padding: 0.5rem; border-radius: 0.375rem; border: 1px solid #D1D5DB; }
        .btn-primary { padding: 0.5rem 1rem; background-color: #4F46E5; color: white; border-radius: 0.375rem; font-weight: 500; }
        .btn-primary:hover { background-color: #4338CA; }
        .btn-primary:disabled { background-color: #A5B4FC; cursor: not-allowed; }
        .btn-secondary { padding: 0.5rem 1rem; background-color: #E5E7EB; color: #374151; border-radius: 0.375rem; font-weight: 500; }
        .btn-secondary:hover { background-color: #D1D5DB; }
        .btn-secondary:disabled { background-color: #F3F4F6; cursor: not-allowed; }
      `}</style>
    </div>
  );
};

export default OrderKeeperView;
