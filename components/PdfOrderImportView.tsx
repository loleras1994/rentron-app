import React, { useState } from "react";
import { useTranslation } from "../hooks/useTranslation";
import * as api from "../api/client";
import type { ProductionSheet } from "../src/types";
import type { ParsedPdfMulti } from "../api/client";   // <-- update your type
import { QRCodeSVG } from "qrcode.react";
import { renderToStaticMarkup } from "react-dom/server";


const PdfOrderImportView: React.FC = () => {
  const { t } = useTranslation();

  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedPdfMulti | null>(null);
  const [generatedSheets, setGeneratedSheets] = useState<ProductionSheet[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setParsed(null);
    setGeneratedSheets([]);
    setError(null);
    const f = e.target.files?.[0] || null;
    setFile(f);
  };

  const handleParse = async () => {
    if (!file) return;
    setIsParsing(true);
    setError(null);
    try {
      const result = await api.parseOrderPdf(file);
      console.log("Parsed data set in state:", result);
      setParsed(result);
    } catch (e: any) {
      console.error(e);
      setError(e.message || "Failed to parse PDF");
    } finally {
      setIsParsing(false);
    }
  };

  const handleCreate = async () => {
    if (!parsed) return;

    setIsSaving(true);
    setError(null);

    try {
      // Detect conflicts with existing sheets in the same order
      const sheetNumbers = parsed.sheets.map(s => s.sheetNumber);
      const existingSheets = await api.getSheetsByOrderId(parsed.orderNumber);
      const existingNums = existingSheets.map(s => s.productionSheetNumber);

      const conflicts = sheetNumbers.filter(num => existingNums.includes(num));
      if (conflicts.length > 0) {
        setError(`Sheet numbers already exist for this order: ${conflicts.join(", ")}`);
        setIsSaving(false);
        return;
      }

      // Map the parsed sheets to include the position for each phase
      const sheetsToCreate = parsed.sheets.map((s) => {
        console.log("Phases with position:", s.productDef.phases);
        // Create a new phases array where each phase includes the position
        const phasesWithPosition = s.productDef.phases.map((phase) => ({
          ...phase,
          position: phase.position, // Ensure position is included
        }));

        return {
          productionSheetNumber: s.sheetNumber,
          productId: s.productDef.id,
          quantity: s.quantity,
          orderNumber: parsed.orderNumber,
          productDef: {
            ...s.productDef,
            phases: phasesWithPosition, // Include the phases with position here
          },
        };
      });

      // Create the sheets with the new phases data
      const newSheets = await api.createOrderAndSheets(parsed.orderNumber, sheetsToCreate);

      // Update the state with the generated sheets
      setGeneratedSheets(
        newSheets.map(s => ({
          id: s.id,
          orderNumber: parsed.orderNumber,
          productId: s.productId,
          productionSheetNumber: s.productionSheetNumber,
          quantity: s.quantity,
          qrValue: s.qrValue,
        }))
      );
    } catch (e: any) {
      console.error(e);
      setError(e.message || "Failed to create sheets");
    } finally {
      setIsSaving(false);
    }
  };


const printSheets = (sheetsToPrint, mode) => {
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



  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">
        Import Order from PDF
      </h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            PDF file
          </label>
          <input
            type="file"
            accept="application/pdf"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-700"
          />
        </div>

        <button
          onClick={handleParse}
          disabled={!file || isParsing}
          className="btn-primary"
        >
          {isParsing ? "Parsing..." : "Parse PDF"}
        </button>

        {error && (
          <div className="text-red-600 text-sm mt-2 whitespace-pre-line">
            {error}
          </div>
        )}

        {parsed && (
          <div className="mt-4 border rounded-md p-4 bg-gray-50 text-sm">
            <h3 className="font-semibold mb-2">Order Parsed</h3>

            <p>
              <strong>Order Number:</strong> {parsed.orderNumber}
            </p>

            <h4 className="font-semibold mt-3 mb-1">
              Products in this PDF:
            </h4>

            <ul className="list-disc ml-4">
              {parsed.sheets.map((s, i) => (
                <li key={i} className="mb-4">
                  <div>
                    <strong>Sheet Number:</strong> {s.sheetNumber}
                  </div>
                  <div>
                    <strong>Product ID:</strong> {s.productDef.id}
                  </div>
                  <div>
                    <strong>Quantity:</strong> {s.quantity}
                  </div>

                  <div className="mt-2">
                    <strong>Materials:</strong>
                    <ul className="list-disc ml-6">
                      {s.productDef.materials.map((m, k) => (
                        <li key={k}>
                          {m.materialId} – per piece:{" "}
                          {(m.quantityPerPiece || 0).toFixed(4)}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-2">
                    <strong>Phases:</strong>
                    <ul className="list-disc ml-6">
                      {s.productDef.phases.map((p, k) => {
                        console.log("Rendering phase data:", p);  // Log here to confirm position
                        return (
                          <li key={k}>
                            phase {p.phaseId}: setup {p.setupTime} min, prod{" "}
                            {p.productionTimePerPiece} min/piece, position: {p.position || "Not assigned"}
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  <hr className="my-3" />
                </li>
              ))}
            </ul>

            <button
              onClick={handleCreate}
              disabled={isSaving}
              className="mt-4 btn-primary"
            >
              {isSaving ? "Saving..." : "Create All Sheets"}
            </button>
          </div>
        )}

        {generatedSheets.length > 0 && (
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-2xl mx-auto text-center mt-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4">
                Sheets Created Successfully!
              </h2>

              <div className="mb-4 text-gray-700">
                {generatedSheets.map((s) => (
                  <p key={s.id}>
                    Sheet {s.productionSheetNumber} — Product {s.productId} — Qty {s.quantity}
                  </p>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
                  <button 
                      onClick={() => printSheets(generatedSheets, "sticker")}
                      className="w-full sm:w-auto flex justify-center items-center py-2 px-4 border border-transparent rounded-md shadow-sm 
                                text-sm font-medium text-white bg-green-600 hover:bg-green-700"
                  >
                      Print Sticker Layout
                  </button>

                  <button 
                      onClick={() => printSheets(generatedSheets, "full")}
                      className="w-full sm:w-auto flex justify-center items-center py-2 px-4 border border-gray-300 rounded-md shadow-sm 
                                text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                      Print Full Layout
                  </button>
              </div>

              <button 
                onClick={() => setGeneratedSheets([])} 
                className="mt-6 text-indigo-600 hover:underline"
              >
                Close
              </button>
          </div>
        )}

      </div>

      <style>{`
        .btn-primary {
          padding: 0.5rem 1rem;
          background-color: #4F46E5;
          color: white;
          border-radius: 0.375rem;
          font-weight: 500;
        }
        .btn-primary:hover {
          background-color: #4338CA;
        }
        .btn-primary:disabled {
          background-color: #A5B4FC;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
};

export default PdfOrderImportView;
