import React, { useState, useEffect } from "react";
import { useTranslation } from "../hooks/useTranslation";
import * as api from "../api/client";
import type { Product, ProductForUI, ProductionSheet, Phase } from "../src/types";
import { QRCodeSVG } from "qrcode.react";
import { renderToStaticMarkup } from "react-dom/server";

// --- Reusable Product Definition Section ---
const ProductDefinition: React.FC<{
  product: ProductForUI
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
      copy.materials[index].quantityPerPiece = qty > 0 ? parseFloat((total / qty).toFixed(2)) : 0;
    }

    // ---- PHASE PRODUCTION TIME ----
    else if (field === "phases" && key === "totalProductionTime") {
      const total = parseFloat(value) || 0;
      copy.phases[index].totalProductionTime = parseFloat(total.toFixed(2));
      copy.phases[index].productionTimePerPiece = qty > 0 ? parseFloat((total / qty).toFixed(2)) : 0;
    }

    // ---- PHASE SETUP TIME ----
    else if (field === "phases" && key === "totalSetupTime") {
      const total = parseFloat(value) || 0;
      copy.phases[index].totalSetupTime = parseFloat(total.toFixed(2));
      copy.phases[index].setupTime = parseFloat(total.toFixed(2));
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
      });
    } else {
      copy.phases.push({
        phaseId: phasesList[0]?.id || "",
        setupTime: 0,
        totalSetupTime: 0,
        productionTimePerPiece: 0,
        totalProductionTime: 0,
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
            m.totalQuantity !== undefined
              ? m.totalQuantity
              : m.quantityPerPiece * qty;

          return (
            <div key={i} className="grid grid-cols-2 gap-2 mb-2">
              <input
                type="text"
                placeholder={t("orderkeeper.materialId")}
                value={m.materialId}
                onChange={(e) =>
                  updateField("materials", i, "materialId", e.target.value)
                }
                className="input-style"
              />

              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  {t("orderkeeper.qtyPerPiece")}:{" "}
                  {m.quantityPerPiece.toFixed(2)}
                </label>
                <input
                  type="number"
                  placeholder="Total qty"
                  value={totalQty}
                  onChange={(e) =>
                    updateField(
                      "materials",
                      i,
                      "totalQuantity",
                      e.target.value
                    )
                  }
                  className="input-style"
                />
              </div>
            </div>
          );
        })}

        <button
          onClick={() => addField("materials")}
          className="btn-secondary text-sm"
        >
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

          const totalSetup =
            p.totalSetupTime !== undefined
              ? p.totalSetupTime
              : p.setupTime;

          return (
            <div key={i} className="grid grid-cols-3 gap-2 mb-2">

              <select
                value={p.phaseId}
                onChange={(e) =>
                  updateField("phases", i, "phaseId", e.target.value)
                }
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
                  Setup (per phase): {p.setupTime.toFixed(1)} min
                </label>
                <input
                  type="number"
                  placeholder="Setup (min)"
                  value={totalSetup}
                  onChange={(e) =>
                    updateField(
                      "phases",
                      i,
                      "totalSetupTime",
                      e.target.value
                    )
                  }
                  className="input-style"
                />
              </div>

              {/* PRODUCTION TIME */}
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  Prod (per piece):{" "}
                  {p.productionTimePerPiece.toFixed(2)} min
                </label>
                <input
                  type="number"
                  placeholder="Total (min)"
                  value={totalProd}
                  onChange={(e) =>
                    updateField(
                      "phases",
                      i,
                      "totalProductionTime",
                      e.target.value
                    )
                  }
                  className="input-style"
                />
              </div>
            </div>
          );
        })}

        <button
          onClick={() => addField("phases")}
          className="btn-secondary text-sm"
        >
          {t("orderkeeper.addPhase")}
        </button>
      </div>
    </div>
  );
};

export { ProductDefinition };


// --- Main OrderKeeperView Component ---
const OrderKeeperView: React.FC = () => {
  const { t } = useTranslation();

  const [orderNumber, setOrderNumber] = useState("");
  const [isOrderNumberLocked, setIsOrderNumberLocked] = useState(false);
  const [viewMode, setViewMode] =
    useState<"idle" | "create" | "reprint">("idle");

  const [sheets, setSheets] = useState<
    { number: string; productId: string; quantity: string; productDef: ProductForUI }[]
  >([]);
  const [generatedSheets, setGeneratedSheets] = useState<ProductionSheet[]>([]);
  const [existingSheetsForReprint, setExistingSheetsForReprint] = useState<
    ProductionSheet[]
  >([]);
  const [selectedSheetsToReprint, setSelectedSheetsToReprint] = useState<
    string[]
  >([]);
  const [existingProducts, setExistingProducts] = useState<Product[]>([]);
  const [phasesList, setPhasesList] = useState<Phase[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    api.getProducts().then(setExistingProducts);
    api.getPhases().then(setPhasesList);
  }, []);

  const addSheet = () => {
    setSheets([
      ...sheets,
      {
        number: "",
        productId: "",
        quantity: "",
        productDef: { id: "", name: "", quantity: 0, materials: [], phases: [] },
      },
    ]);
  };

  const updateSheet = (
    index: number,
    field: keyof (typeof sheets)[0],
    value: any
  ) => {
    const newSheets = [...sheets];
    const sheet = { ...newSheets[index] };
    (sheet as any)[field] = value;

    const qty = Math.max(0, parseInt(field === "quantity" ? value : sheet.quantity || "0", 10) || 0);

    // -------------------------------
    // If productId OR quantity changed
    // -------------------------------
    if (field === "productId" || field === "quantity") {
      const base = existingProducts.find((p) => p.id === sheet.productId);

      // -------------------------------
      // CASE 1 — existing product
      // -------------------------------
      if (base) {
        const copy: any = JSON.parse(JSON.stringify(base));

        // 🔥 FIX — always preserve product name, never lose it
        copy.name = base.name;

        // attach order quantity so ProductDefinition knows how to scale
        copy.quantity = qty;

        // MATERIALS
        copy.materials = copy.materials.map((m: any) => {
          const total = m.totalQuantity ?? m.quantityPerPiece * qty;
          return {
            ...m,
            totalQuantity: total,
            quantityPerPiece: qty > 0 ? total / qty : m.quantityPerPiece,
          };
        });

        // PHASES
        copy.phases = copy.phases.map((p: any) => {
          const totalProd =
            p.totalProductionTime ??
            p.productionTimePerPiece * qty;

          const totalSetup =
            p.totalSetupTime ?? p.setupTime;

          return {
            ...p,
            totalProductionTime: totalProd,
            productionTimePerPiece:
              qty > 0 ? totalProd / qty : p.productionTimePerPiece,

            totalSetupTime: totalSetup,
            setupTime: totalSetup,
          };
        });

        sheet.productDef = copy;
      }


      // -------------------------------
      // CASE 2 — NEW product
      // -------------------------------
      else if (field === "productId") {
        sheet.productDef = {
          id: value,
          name: value,
          quantity: qty,

          materials: [
            {
              materialId: "",
              quantityPerPiece: 0,
              totalQuantity: 0,
            },
          ],

          phases: [
            {
              phaseId: phasesList[0]?.id || "",
              setupTime: 0,
              totalSetupTime: 0,
              productionTimePerPiece: 0,
              totalProductionTime: 0,
            },
          ],
        };
      }
    }

    newSheets[index] = sheet;
    setSheets(newSheets);
  };


  const handleSave = async () => {
    if (!orderNumber || sheets.length === 0) return;
    setIsSaving(true);
    let createdSheetsForPrompt: ProductionSheet[] = [];

    try {
      // 1️⃣ Save / update product definitions (per-piece values)
      for (const sheet of sheets) {
        const qty = parseInt(sheet.quantity || "0", 10);

        if (sheet.productId && qty > 0 && sheet.productDef) {
          const base: any = sheet.productDef;

          const normalizedProduct: Product = {
            id: base.id || sheet.productId,
            // if name δεν υπάρχει, τουλάχιστον βάλε id
            name: base.name || sheet.productId,
            materials: (base.materials || []).map((m: any) => {
              // προτιμάμε totalQuantity αν υπάρχει, αλλιώς υπολογίζουμε από quantityPerPiece
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
              // παραγωγικός χρόνος: total → per piece
              const totalProd =
                p.totalProductionTime != null
                  ? parseFloat(String(p.totalProductionTime))
                  : (p.productionTimePerPiece || 0) * qty;

              // setup time είναι per phase, όχι per piece
              const setup =
                p.totalSetupTime != null
                  ? parseFloat(String(p.totalSetupTime))
                  : p.setupTime || 0;

              return {
                phaseId: p.phaseId,
                setupTime: setup,
                productionTimePerPiece: qty > 0 ? totalProd / qty : 0,
              };
            }),
          };

          await api.saveProduct(normalizedProduct);

          // 🔥 IMPORTANT: reload products so new orders use updated phases
          const fresh = await api.getProducts();
          setExistingProducts(fresh);
        }
      }

      // 2️⃣ Create production sheets (with snapshot of current productDef)
      const sheetsToCreate = sheets
        .filter(
          (s) => s.productId && s.quantity && parseInt(s.quantity, 10) > 0
        )
        .map((s) => ({
          productionSheetNumber: s.number,
          productId: s.productId,
          quantity: parseInt(s.quantity, 10),
          orderNumber: orderNumber,
          // 🔥 send full productDef so backend can freeze snapshot
          productDef: s.productDef,
        }));

      if (sheetsToCreate.length > 0) {
        const newSheets = await api.createOrderAndSheets(
          orderNumber,
          sheetsToCreate
        );
        createdSheetsForPrompt = newSheets;
        setGeneratedSheets(newSheets);
      }

      setSheets([]);

      if (createdSheetsForPrompt.length > 0) {
        console.log(t("orderkeeper.orderCompletePrompt"));
      }
    } catch (error) {
      console.error("Failed to save order:", error);
      alert((error as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const printSheets = (sheetsToPrint: ProductionSheet[], mode: "sticker" | "full") => {
      if (sheetsToPrint.length === 0) return;
      const printWindow = window.open("", "_blank", "height=1000,width=800");
      if (!printWindow) return;

      const cellHeight = mode === "full" ? 37.125 : 33.9;
      const verticalPadding = mode === "full" ? 0 : 12.9;

      printWindow.document.write(`
        <html><head><title>Print Production Sheets</title>
        <style>
            @page { size: A4 portrait; margin: 0; }
            @media print { body { -webkit-print-color-adjust: exact; } }
            html, body {
              margin: 0 !important;
              padding: 0 !important;
              background: white;
            }
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
              width: 70mm;
              height: ${cellHeight}mm;
              display: flex;
              flex-direction: column;
              justify-content: center;
              align-items: center;
              text-align: center;
              box-sizing: border-box;
              padding: 2mm;
              overflow: hidden;
            }
            .cell svg { width: 22mm; height: 22mm; }
            .cell p { margin: 1mm 0 0 0; font-size: 10px; line-height: 1.1; font-weight: bold; }
        </style></head><body><div class="page">`);

      sheetsToPrint.forEach(sheet => {
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

  const handleOrderNumberConfirmOrChange = async () => {
    if (isOrderNumberLocked) {
      setOrderNumber('');
      setIsOrderNumberLocked(false);
      setViewMode('idle');
      setSheets([]);
      setExistingSheetsForReprint([]);
      setSelectedSheetsToReprint([]);
    } else {
      if (!orderNumber.trim()) return;
      setIsLoading(true);
      const allOrders = await api.getOrders();
      const existingOrder = allOrders.find(o => o.orderNumber === orderNumber);
      if (existingOrder) {
        const sheets = await api.getSheetsByOrderId(existingOrder.orderNumber);
        setExistingSheetsForReprint(sheets);
        setViewMode('reprint');
      } else {
        setViewMode('create');
      }
      setIsOrderNumberLocked(true);
      setIsLoading(false);
    }
  };

  const handleToggleReprintSelection = (sheetId: string) => {
    setSelectedSheetsToReprint(prev =>
      prev.includes(sheetId)
        ? prev.filter(id => id !== sheetId)
        : [...prev, sheetId]
    );
  };
  
  const handlePrintSelected = (mode: 'sticker' | 'full') => {
    const sheetsToPrint = existingSheetsForReprint.filter(s => selectedSheetsToReprint.includes(s.id));
    if (sheetsToPrint.length > 0) {
        printSheets(sheetsToPrint, mode);
    }
  };
  
  if (generatedSheets.length > 0) {
      return (
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-2xl mx-auto text-center">
              <h2 className="text-2xl font-bold text-gray-800 mb-4">{t('header.title')}</h2>
              <p className="text-lg text-gray-600 mb-6">{t('orderkeeper.orderCompletePrompt').replace(' Print QR codes for all production sheets?', '')}</p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button 
                  onClick={() => printSheets(generatedSheets, "sticker")}
                  className="w-full sm:w-auto flex justify-center items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                >
                  {t('batchCreate.printStickerLayout')}
                </button>
                <button 
                  onClick={() => printSheets(generatedSheets, "full")}
                  className="w-full sm:w-auto flex justify-center items-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  {t('batchCreate.printFullBleedLayout')}
                </button>
              </div>
              <button onClick={() => setGeneratedSheets([])} className="mt-6 w-full max-w-xs text-indigo-600 hover:underline">{t('common.close')}</button>
          </div>
      )
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-5xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">{t('orderkeeper.title')}</h2>
      
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1">{t('orderkeeper.orderNumber')}</label>
        <div className="flex items-center gap-3">
            <input type="text" value={orderNumber} onChange={e => setOrderNumber(e.target.value)} placeholder={t('orderkeeper.orderNumberPlaceholder')} className="input-style flex-grow" disabled={isOrderNumberLocked} />
            <button onClick={handleOrderNumberConfirmOrChange} className="btn-secondary">{isOrderNumberLocked ? t('orderkeeper.changeOrder') : t('common.confirm')}</button>
        </div>
      </div>

      {isLoading && <div className="text-center p-4">{t('common.loading')}</div>}

      {isOrderNumberLocked && viewMode === 'create' && (
        <>
            <h3 className="text-xl font-semibold text-gray-700 mb-4 border-t pt-4">{t('orderkeeper.productionSheets')}</h3>
            {sheets.map((sheet, i) => (
                <div key={i} className="p-4 border rounded-md mb-4 bg-gray-50">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                         <input type="text" placeholder={t('orderkeeper.sheetNumber')} value={sheet.number} onChange={e => updateSheet(i, 'number', e.target.value)} className="input-style" />
                         <input list="product-ids" placeholder={t('orderkeeper.productId')} value={sheet.productId} onChange={e => updateSheet(i, 'productId', e.target.value)} className="input-style" />
                         <datalist id="product-ids">
                            {existingProducts.map(p => <option key={p.id} value={p.id} />)}
                         </datalist>
                         <input type="number" placeholder={t('orderkeeper.quantity')} value={sheet.quantity} onChange={e => updateSheet(i, 'quantity', e.target.value)} className="input-style" />
                    </div>
                    {sheet.productId && <ProductDefinition product={sheet.productDef} updateProduct={p => updateSheet(i, 'productDef', p)} phasesList={phasesList} />}
                </div>
            ))}
            <div className="flex gap-3 mt-4">
                <button onClick={addSheet} className="btn-secondary">{t('orderkeeper.addSheet')}</button>
                <button onClick={handleSave} disabled={isSaving} className="btn-primary">{isSaving ? t('orderkeeper.saving') : t('orderkeeper.saveOrder')}</button>
            </div>
        </>
      )}

      {isOrderNumberLocked && viewMode === 'reprint' && (
        <div className="border-t pt-4">
            <h3 className="text-xl font-semibold text-gray-700 mb-4">{t('orderkeeper.reprintTitle', { orderNumber })}</h3>
            {existingSheetsForReprint.length > 0 ? (
                <>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left"><input type="checkbox" onChange={(e) => setSelectedSheetsToReprint(e.target.checked ? existingSheetsForReprint.map(s => s.id) : [])} /></th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('orderkeeper.sheetNumberHeader')}</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('orderkeeper.productIdHeader')}</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('orderkeeper.quantityHeader')}</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                        {existingSheetsForReprint.map(sheet => (
                            <tr key={sheet.id}>
                                <td className="px-6 py-4"><input type="checkbox" checked={selectedSheetsToReprint.includes(sheet.id)} onChange={() => handleToggleReprintSelection(sheet.id)} /></td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{sheet.productionSheetNumber}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{sheet.productId}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{sheet.quantity}</td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                </div>
                 <div className="mt-6 p-4 border rounded-md bg-gray-50">
                    <h4 className="text-md font-semibold text-gray-700 mb-3">Print Options</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <p className="text-sm font-medium text-gray-600 mb-2">{t('orderkeeper.printSelected')} ({selectedSheetsToReprint.length} selected)</p>
                            <div className="flex flex-col gap-2">
                                <button onClick={() => handlePrintSelected('sticker')} disabled={selectedSheetsToReprint.length === 0} className="btn-primary text-sm">{t('batchCreate.printStickerLayout')}</button>
                                <button onClick={() => handlePrintSelected('full')} disabled={selectedSheetsToReprint.length === 0} className="btn-secondary text-sm">{t('batchCreate.printFullBleedLayout')}</button>
                            </div>
                        </div>
                        <div>
                            <p className="text-sm font-medium text-gray-600 mb-2">{t('orderkeeper.printAll')} ({existingSheetsForReprint.length} total)</p>
                            <div className="flex flex-col gap-2">
                                <button onClick={() => printSheets(existingSheetsForReprint, 'sticker')} className="btn-primary text-sm">{t('batchCreate.printStickerLayout')}</button>
                                <button onClick={() => printSheets(existingSheetsForReprint, 'full')} className="btn-secondary text-sm">{t('batchCreate.printFullBleedLayout')}</button>
                            </div>
                        </div>
                    </div>
                </div>
                </>
            ) : (
                <p className="text-gray-500">{t('orderkeeper.noSheetsFound')}</p>
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