import React, { useState } from "react";
import { useTranslation } from "../hooks/useTranslation";
import * as api from "../api/client";
import type { ProductionSheet } from "../src/types";
import type { ParsedPdfMulti } from "../api/client";
import { QRCodeSVG } from "qrcode.react";
import { renderToStaticMarkup } from "react-dom/server";
import { PDFDocument, rgb } from "pdf-lib";
import QRCode from "qrcode";

const PdfOrderImportView: React.FC = () => {
  const { t } = useTranslation();

  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedPdfMulti | null>(null);
  const [generatedSheets, setGeneratedSheets] = useState<ProductionSheet[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [materialTickets, setMaterialTickets] = useState<any[]>([]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setParsed(null);
    setGeneratedSheets([]);
    setError(null);
    const f = e.target.files?.[0] || null;
    setFile(f);
    setMaterialTickets([]);
  };

  const handleParse = async () => {
    if (!file) return;
    setIsParsing(true);
    setError(null);
    try {
      const result = await api.parseOrderPdf(file);
      console.log("Parsed data set in state:", result);
      setParsed(result);
      setMaterialTickets(result.materialTickets || []);
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
      const sheetNumbers = parsed.sheets.map((s) => s.sheetNumber);
      const existingSheets = await api.getSheetsByOrderId(parsed.orderNumber);
      const existingNums = existingSheets.map((s) => s.productionSheetNumber);

      const conflicts = sheetNumbers.filter((num) => existingNums.includes(num));
      if (conflicts.length > 0) {
        setError(`Sheet numbers already exist for this order: ${conflicts.join(", ")}`);
        setIsSaving(false);
        return;
      }

      // Map the parsed sheets to include the position for each phase
      const sheetsToCreate = parsed.sheets.map((s) => {
        console.log("Phases with position:", s.productDef.phases);
        const phasesWithPosition = s.productDef.phases.map((phase) => ({
          ...phase,
          position: phase.position,
        }));

        return {
          productionSheetNumber: s.sheetNumber,
          productId: s.productDef.id,
          quantity: s.quantity,
          orderNumber: parsed.orderNumber,
          productDef: {
            ...s.productDef,
            phases: phasesWithPosition,
          },
        };
      });

      // Create the sheets with the new phases data
      const newSheets = await api.createOrderAndSheets(parsed.orderNumber, sheetsToCreate);

      // Update the state with the generated sheets
      setGeneratedSheets(
        newSheets.map((s) => ({
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

  const chunkArray = (arr: any[], size: number) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  const printSheets = (sheetsToPrint: any[], mode: string) => {
    if (!sheetsToPrint || sheetsToPrint.length === 0) return;

    const printWindow = window.open("", "_blank", "height=1000,width=800");
    if (!printWindow) return;

    const cellHeight = mode === "full" ? 37.125 : 33.9;
    const verticalPadding = mode === "full" ? 0 : 12.9;

    const pages = chunkArray(sheetsToPrint, 24);

    printWindow.document.write(`
      <html>
        <head>
          <title>Print Production Sheets</title>
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

              break-after: page;
              page-break-after: always;
            }
            .page:last-child {
              break-after: auto;
              page-break-after: auto;
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
          </style>
        </head>
        <body>
    `);

    pages.forEach((pageSheets) => {
      printWindow.document.write(`<div class="page">`);

      pageSheets.forEach((sheet: any) => {
        const svg = renderToStaticMarkup(<QRCodeSVG value={sheet.qrValue} size={128} />);
        printWindow.document.write(
          `<div class="cell">${svg}<p>${sheet.productId}</p><p>${sheet.productionSheetNumber}</p></div>`
        );
      });

      printWindow.document.write(`</div>`);
    });

    printWindow.document.write(`</body></html>`);
    printWindow.document.close();
    printWindow.focus();

    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 350);
  };

  // ✅ NEW: filter out material tickets by itemCode prefix 010–018
  const shouldIgnoreMaterialTicket = (t: any) => {
    const code = String(t?.itemCode ?? "").trim();
    // startsWith any of 010..018
    return /^(010|011|012|013|014|015|016|017|018)/.test(code);
  };

  const printMaterialTickets = (ticketsToPrint: any[], mode: string) => {
    if (!ticketsToPrint || ticketsToPrint.length === 0) return;

    // ✅ apply filter here so printing ignores those codes
    const filtered = ticketsToPrint.filter((t) => !shouldIgnoreMaterialTicket(t));
    if (filtered.length === 0) return;

    const printWindow = window.open("", "_blank", "height=1000,width=800");
    if (!printWindow) return;

    const cellHeight = mode === "full" ? 37.125 : 33.9;
    const verticalPadding = mode === "full" ? 0 : 12.9;

    const pages = chunkArray(filtered, 24);

    printWindow.document.write(`
      <html><head><title>Print Material Tickets</title>
      <style>
        @page { size: A4 portrait; margin: 0; }
        @media print { body { -webkit-print-color-adjust: exact; } }
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          background: white;
          font-family: Arial, sans-serif;
        }
        .page {
          display: grid;
          grid-template-columns: repeat(3, 70mm);
          grid-template-rows: repeat(8, ${cellHeight}mm);
          width: 210mm;
          height: 297mm;
          padding: ${verticalPadding}mm 0;
          box-sizing: border-box;

          break-after: page;
          page-break-after: always;
        }
        .page:last-child {
          break-after: auto;
          page-break-after: auto;
        }

        .cell {
          width: 70mm;
          height: ${cellHeight}mm;
          display: flex;
          flex-direction: column;
          justify-content: center;
          box-sizing: border-box;
          padding: 3mm;
          overflow: hidden;
        }
        .row {
          font-size: 10px;
          line-height: 1.15;
          font-weight: 700;
          margin: 0;
          padding: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .desc {
          font-size: 10px;
          line-height: 1.15;
          font-weight: 700;
          margin: 0;
          padding: 0;
          white-space: normal;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
      </style></head><body>
    `);

    pages.forEach((pageTickets) => {
      printWindow.document.write(`<div class="page">`);

      pageTickets.forEach((t: any) => {
        printWindow.document.write(`
          <div class="cell">
            <p class="row">ΕΝΤΟΛΗ : ${t.productionSheetNumber}</p>
            <p class="row">ΓΙΑ ΠΡΟΙΟΝ : ${t.productId}</p>
            <p class="row">ΑΡ.ΕΙΔΟΥΣ : ${t.itemCode}</p>
            <p class="desc">${t.description}</p>
            <p class="row">ΠΟΣΟΤ.ΕΝΤΟΛΗΣ: ${t.qtyText} ${t.unit}</p>
          </div>
        `);
      });

      printWindow.document.write(`</div>`);
    });

    printWindow.document.write(`</body></html>`);
    printWindow.document.close();
    printWindow.focus();

    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 350);
  };

  const printSelectedPdfPages = async () => {
    if (!file || !parsed?.pdfPages?.length) return;
    const normSheet = (v: any) => String(v ?? "").trim().replace(/^0+/, "");
    const normPhase = (v: any) => String(v ?? "").trim();

    // Map: sheetNumber -> lastPhaseId (based on parsed productDef phases)
    const lastPhaseBySheet = new Map<string, string>();

    for (const s of parsed.sheets) {
      const phases = [...(s.productDef?.phases || [])];
      phases.sort((a: any, b: any) => Number(a.position) - Number(b.position));
      const last = phases[phases.length - 1];

      const sheetKey = normSheet(s.sheetNumber);
      const lastPhaseId = normPhase(last?.phaseId);

      if (sheetKey && lastPhaseId) {
        lastPhaseBySheet.set(sheetKey, lastPhaseId);
      }
    }

    const pages = parsed.pdfPages;
    const include = new Set<number>(); // 0-based for pdf-lib

    let i = 0;
    console.log(pages.map((p: any) => `${p.pageNumber}:${p.type}`).join(" | "));
    while (i < pages.length) {
      const p: any = pages[i];

      // ---- ORDER CARD GROUP ----
      if (p.type === "ORDER_CARD") {
        const groupStart = i;
        let groupEnd = i;

        // Walk forward until the page that contains ">> ΤΕΛΟΣ ΚΑΤΑΛΟΓΟΥ <<"
        while (groupEnd < pages.length && (pages[groupEnd] as any).type === "ORDER_CARD") {
          const cur: any = pages[groupEnd];
          include.add(cur.pageNumber - 1);

          if ((cur as any).isEndOfList) break;
          if ((pages as any)[groupEnd + 1]?.type === "STORAGE") break; // ✅ important

          groupEnd++;
        }

        // Determine sheet number for this group:
        let sheetNo: string | null = null;
        for (let k = groupStart; k <= groupEnd && k < pages.length; k++) {
          if ((pages as any)[k].productionSheetNumber) {
            sheetNo = normSheet((pages as any)[k].productionSheetNumber);
            break;
          }
        }

        // STORAGE rule: only the page immediately after the ORDER_CARD group
        const nextIdx = groupEnd + 1;
        if (nextIdx < pages.length) {
          const nextPage: any = pages[nextIdx];

          if (nextPage.type === "STORAGE" && sheetNo) {
            const lastPhaseId = normPhase(lastPhaseBySheet.get(sheetNo));

            console.log("[STORAGE CHECK]", { sheetNo, lastPhaseId, storagePage: nextPage.pageNumber });

            if (lastPhaseId === "20") {
              include.add(nextPage.pageNumber - 1);
              console.log("✅ INCLUDED STORAGE page", nextPage.pageNumber, "for sheet", sheetNo);
            }
          }
        }
        i = groupEnd + 1;
        continue;
      }
      i++;
    }

    const indices = Array.from(include).sort((a, b) => a - b);
    if (indices.length === 0) return;

    const srcBytes = await file.arrayBuffer();
    const srcPdf = await PDFDocument.load(srcBytes);
    const outPdf = await PDFDocument.create();

    const copied = await outPdf.copyPages(srcPdf, indices);
    copied.forEach((pg) => outPdf.addPage(pg));

    const outBytes = await outPdf.save(); // Uint8Array

    const ab = Uint8Array.from(outBytes).buffer;
    const blob = new Blob([ab], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    const w = window.open("", "_blank");
    if (!w) return;

    w.document.write(`
      <html>
        <head><title>Print PDF</title></head>
        <body style="margin:0">
          <iframe id="pdf" src="${url}" style="border:0;width:100%;height:100vh"></iframe>
          <script>
            const f = document.getElementById("pdf");
            f.onload = () => setTimeout(() => window.print(), 200);
          </script>
        </body>
      </html>
    `);
    w.document.close();
  };

  // ---------------------------
  // Create PDF with QR logic
  // ---------------------------

  const normSheetNo = (v: any) => String(v ?? "").trim().replace(/^0+/, "");
  const dataUrlToUint8 = (dataUrl: string) => {
    const base64 = dataUrl.split(",")[1] || "";
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  };

  const makeQrPngBytes = async (value: string) => {
    const dataUrl = await QRCode.toDataURL(value, {
      errorCorrectionLevel: "H",
      margin: 0,
      scale: 8,
    });
    return dataUrlToUint8(dataUrl);
  };

  const getOrCreateSheetsForOrder = async (): Promise<ProductionSheet[]> => {
    if (!parsed) return [];

    // 1) Try fetch by orderNumber
    const existingSheets = await api.getSheetsByOrderId(parsed.orderNumber);
    if (existingSheets && existingSheets.length > 0) {
      return existingSheets.map((s: any) => ({
        id: s.id,
        orderNumber: s.orderNumber || parsed.orderNumber,
        productId: s.productId,
        productionSheetNumber: s.productionSheetNumber,
        quantity: s.quantity,
        qrValue: s.qrValue,
      }));
    }

    // 2) If none exist, create like "Create All Sheets"
    const sheetsToCreate = parsed.sheets.map((s) => {
      const phasesWithPosition = (s.productDef?.phases || []).map((phase: any) => ({
        ...phase,
        position: phase.position,
      }));

      return {
        productionSheetNumber: s.sheetNumber,
        productId: s.productDef.id,
        quantity: s.quantity,
        orderNumber: parsed.orderNumber,
        productDef: {
          ...s.productDef,
          phases: phasesWithPosition,
        },
      };
    });

    const newSheets = await api.createOrderAndSheets(parsed.orderNumber, sheetsToCreate);

    const normalized = newSheets.map((s: any) => ({
      id: s.id,
      orderNumber: parsed.orderNumber,
      productId: s.productId,
      productionSheetNumber: s.productionSheetNumber,
      quantity: s.quantity,
      qrValue: s.qrValue,
    }));

    setGeneratedSheets(normalized);
    return normalized;
  };

  const buildIncludeIndices = () => {
    if (!parsed?.pdfPages?.length) return [];

    const normPhase = (v: any) => String(v ?? "").trim();

    const lastPhaseBySheet = new Map<string, string>();

    for (const s of parsed.sheets) {
      const phases = [...(s.productDef?.phases || [])];
      phases.sort((a: any, b: any) => Number(a.position) - Number(b.position));
      const last = phases[phases.length - 1];

      const sheetKey = normSheetNo(s.sheetNumber);
      const lastPhaseId = normPhase(last?.phaseId);

      if (sheetKey && lastPhaseId) lastPhaseBySheet.set(sheetKey, lastPhaseId);
    }

    const pages: any[] = parsed.pdfPages as any[];
    const include = new Set<number>(); // 0-based
    let i = 0;

    while (i < pages.length) {
      const p: any = pages[i];

      if (p.type === "ORDER_CARD") {
        const groupStart = i;
        let groupEnd = i;

        while (groupEnd < pages.length && pages[groupEnd].type === "ORDER_CARD") {
          const cur = pages[groupEnd];
          include.add(cur.pageNumber - 1);

          if (cur.isEndOfList) break;
          if (pages[groupEnd + 1]?.type === "STORAGE") break;
          groupEnd++;
        }

        let sheetNo: string | null = null;
        for (let k = groupStart; k <= groupEnd && k < pages.length; k++) {
          if (pages[k].productionSheetNumber) {
            sheetNo = normSheetNo(pages[k].productionSheetNumber);
            break;
          }
        }

        const nextIdx = groupEnd + 1;
        if (nextIdx < pages.length) {
          const nextPage = pages[nextIdx];
          if (nextPage.type === "STORAGE" && sheetNo) {
            const lastPhaseId = normPhase(lastPhaseBySheet.get(sheetNo));
            if (lastPhaseId === "20") include.add(nextPage.pageNumber - 1);
          }
        }

        i = groupEnd + 1;
        continue;
      }

      i++;
    }

    return Array.from(include).sort((a, b) => a - b);
  };

  const stampQrsAndPrint = async (sheets: ProductionSheet[]) => {
    if (!file || !parsed?.pdfPages?.length) return;

    const qrBySheet = new Map<string, string>();
    for (const s of sheets || []) {
      const key = normSheetNo(s.productionSheetNumber);
      if (key && (s as any).qrValue) qrBySheet.set(key, (s as any).qrValue);
    }

    const indices = buildIncludeIndices();
    if (indices.length === 0) return;

    const srcBytes = await file.arrayBuffer();
    const srcPdf = await PDFDocument.load(srcBytes);
    const outPdf = await PDFDocument.create();

    const copied = await outPdf.copyPages(srcPdf, indices);
    copied.forEach((pg) => outPdf.addPage(pg));

    const pngCache = new Map<string, any>();

    for (let outIdx = 0; outIdx < indices.length; outIdx++) {
      const originalZeroBased = indices[outIdx];
      const meta: any = (parsed.pdfPages as any[])[originalZeroBased];
      if (!meta || meta.type !== "ORDER_CARD") continue;

      const sheetNo = normSheetNo(meta.productionSheetNumber);
      if (!sheetNo) continue;

      const qrValue = qrBySheet.get(sheetNo);
      if (!qrValue) {
        console.warn("No qrValue for sheet", sheetNo, "— skipping");
        continue;
      }

      let embedded = pngCache.get(sheetNo);
      if (!embedded) {
        const pngBytes = await makeQrPngBytes(qrValue);
        embedded = await outPdf.embedPng(pngBytes);
        pngCache.set(sheetNo, embedded);
      }

      const page = outPdf.getPage(outIdx);
      const { width, height } = page.getSize();

      const size = 70; // points
      const margin = 18;

      const x = width - size - margin;
      const y = height - size - margin;

      page.drawRectangle({
        x: x - 2,
        y: y - 2,
        width: size + 4,
        height: size + 4,
        color: rgb(1, 1, 1),
        opacity: 0.95,
        borderWidth: 0,
      });

      page.drawImage(embedded, { x, y, width: size, height: size });
    }

    const outBytes = await outPdf.save();
    const ab = Uint8Array.from(outBytes).buffer;
    const blob = new Blob([ab], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    const w = window.open("", "_blank");
    if (!w) return;

    w.document.write(`
      <html>
        <head><title>Print PDF</title></head>
        <body style="margin:0">
          <iframe id="pdf" src="${url}" style="border:0;width:100%;height:100vh"></iframe>
          <script>
            const f = document.getElementById("pdf");
            f.onload = () => setTimeout(() => window.print(), 200);
          </script>
        </body>
      </html>
    `);
    w.document.close();
  };

  const handleCreatePdfWithQr = async () => {
    if (!parsed || !file) return;
    setIsSaving(true);
    setError(null);

    try {
      const sheets = await getOrCreateSheetsForOrder();
      if (!sheets || sheets.length === 0) {
        setError("No production sheets found or created for this order.");
        return;
      }
      await stampQrsAndPrint(sheets);
    } catch (e: any) {
      console.error(e);
      setError(e.message || "Failed to create PDF with QR");
    } finally {
      setIsSaving(false);
    }
  };

  // ✅ Use filtered tickets for UI and printing
  const filteredMaterialTickets = (parsed?.materialTickets || []).filter((t: any) => !shouldIgnoreMaterialTicket(t));

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">Import Order from PDF</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">PDF file</label>
          <input
            type="file"
            accept="application/pdf"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-700"
          />
        </div>

        <button onClick={handleParse} disabled={!file || isParsing} className="btn-primary">
          {isParsing ? "Parsing..." : "Parse PDF"}
        </button>

        {error && <div className="text-red-600 text-sm mt-2 whitespace-pre-line">{error}</div>}

        {parsed && (
          <div className="mt-4 border rounded-md p-4 bg-gray-50 text-sm">
            <h3 className="font-semibold mb-2">Order Parsed</h3>

            <p>
              <strong>Order Number:</strong> {parsed.orderNumber}
            </p>

            <h4 className="font-semibold mt-3 mb-1">Products in this PDF:</h4>

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
                          {m.materialId} – per piece: {(m.quantityPerPiece || 0).toFixed(4)}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-2">
                    <strong>Phases:</strong>
                    <ul className="list-disc ml-6">
                      {s.productDef.phases.map((p, k) => (
                        <li key={k}>
                          phase {p.phaseId}: setup {p.setupTime} min, prod {p.productionTimePerPiece} min/piece,
                          position: {p.position || "Not assigned"}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <hr className="my-3" />
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-col sm:flex-row gap-3">
              <button onClick={handleCreate} disabled={isSaving} className="btn-primary">
                {isSaving ? "Saving..." : "Create All Sheets"}
              </button>

              <button onClick={printSelectedPdfPages} disabled={!file || !parsed?.pdfPages?.length} className="btn-primary">
                Print PDF
              </button>

              <button
                onClick={handleCreatePdfWithQr}
                disabled={!file || !parsed?.pdfPages?.length || isSaving}
                className="btn-primary"
              >
                {isSaving ? "Working..." : "Create PDF with QR"}
              </button>
            </div>

            {filteredMaterialTickets.length > 0 && (
              <>
                <h4 className="font-semibold mt-6 mb-1">ΔΕΛΤΙΑ ΥΛΙΚΩΝ (labels):</h4>

                <p className="text-gray-700 mb-2">Βρέθηκαν {filteredMaterialTickets.length} δελτία.</p>

                <div className="flex flex-col sm:flex-row gap-3 justify-center mt-3">
                  <button
                    onClick={() => printMaterialTickets(filteredMaterialTickets, "sticker")}
                    className="w-full sm:w-auto flex justify-center items-center py-2 px-4 border border-transparent rounded-md shadow-sm 
                              text-sm font-medium text-white bg-green-600 hover:bg-green-700"
                  >
                    Print ΔΕΛΤΙΑ ΥΛΙΚΩΝ (Sticker)
                  </button>

                  <button
                    onClick={() => printMaterialTickets(filteredMaterialTickets, "full")}
                    className="w-full sm:w-auto flex justify-center items-center py-2 px-4 border border-gray-300 rounded-md shadow-sm 
                              text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    Print ΔΕΛΤΙΑ ΥΛΙΚΩΝ (Full)
                  </button>
                </div>

                <ul className="list-disc ml-4 mt-3">
                  {filteredMaterialTickets.slice(0, 5).map((t: any, idx: number) => (
                    <li key={idx}>
                      ΕΝΤΟΛΗ {t.productionSheetNumber} — ΑΡ.ΕΙΔΟΥΣ {t.itemCode} — {t.qtyText} {t.unit}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {generatedSheets.length > 0 && (
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-2xl mx-auto text-center mt-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Sheets Created Successfully!</h2>

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

            <button onClick={() => setGeneratedSheets([])} className="mt-6 text-indigo-600 hover:underline">
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
