import React, { useState } from 'react';
import { useWarehouse } from '../hooks/useWarehouse';
import { QRCodeSVG } from 'qrcode.react';
import type { Material, QrData } from '../src/types';
import { renderToStaticMarkup } from 'react-dom/server';
import { useTranslation } from '../hooks/useTranslation';


const BatchCreateView: React.FC = () => {
  const { addMaterial, refresh } = useWarehouse();
  const { t } = useTranslation();
  const [entries, setEntries] = useState<{ code: string; qty: string }[]>([{ code: '', qty: '' }]);
  const [newMaterials, setNewMaterials] = useState<Material[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const handleAddRow = () => setEntries([...entries, { code: '', qty: '' }]);
  
  const handleChange = (i: number, field: 'code' | 'qty', value: string) => {
    const copy = [...entries];
    copy[i] = { ...copy[i], [field]: value };
    setEntries(copy);
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    setNewMaterials([]);
    const created: Material[] = [];
    const validEntries = entries.filter(e => e.code.trim() && e.qty.trim() && Number(e.qty) > 0);

    for (const e of validEntries) {
      try {
        const material = await addMaterial(e.code, Number(e.qty));
        created.push(material);
      } catch (error) {
        console.error(`Failed to create material ${e.code}:`, error);
        alert(`Failed to create material ${e.code}. It might already exist or there was a server error.`);
      }
    }
    await refresh();
    setNewMaterials(created);
    setEntries([{ code: '', qty: '' }]); // Reset form
    setIsSaving(false);
  };


  const handlePrintAll = (materials: Material[], mode: "sticker" | "full") => {
    const totalCells = 24; // 3x8 stickers per page
    const filled = [...materials];
    while (filled.length < totalCells) filled.push(null as any);

    const printWindow = window.open("", "", "height=1000,width=800");
    if (!printWindow) return;

    // Compute exact height per cell depending on layout
    const cellHeight = mode === "full" ? 37.125 : 33.9;
    const verticalPadding = mode === "full" ? 0 : 12.9;

    printWindow.document.write(`
      <html>
        <head>
          <title>Print QR Labels</title>
          <meta name="description" content="QR Sticker Sheet">
          <style>
            @page {
              size: A4 portrait;
              margin: 0;
            }
            @media print {
              body { -webkit-print-color-adjust: exact; }
            }
            html, body {
              margin: 0 !important;
              padding: 0 !important;
              background: white;
            }
            body {
              display: flex;
              justify-content: center;
              align-items: center;
              text-align: center;
              font-family: sans-serif;
            }

            /* === Sticker Sheet Grid === */
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
              overflow: hidden;
            }

            svg {
              width: 20mm;
              height: 20mm;
            }

            .cell p {
              margin: 1px 0;
              font-size: 9px;
              line-height: 1.1;
            }
          </style>

          <script>
            // Chrome alignment notice
            (function() {
              const isChrome = navigator.userAgent.toLowerCase().includes('chrome');
              const warned = localStorage.getItem('qrprint_warned');
              if (isChrome && !warned) {
                alert('IMPORTANT: For perfect alignment in Chrome, disable "Headers and footers" in the print settings dialog.');
                localStorage.setItem('qrprint_warned', '1');
              }
            })();
          </script>
        </head>
        <body>
          <div class="page">
    `);

    filled.forEach((m) => {
      if (m) {
        const qrValue = JSON.stringify({
          id: m.id,
          materialCode: m.materialCode,
          quantity: m.initialQuantity,
        });
        const svg = renderToStaticMarkup(<QRCodeSVG value={qrValue} size={128} />);
        printWindow.document.write(`
          <div class="cell">
            ${svg}
            <p><strong>${m.materialCode}</strong></p>
            <p>Qty: ${m.initialQuantity}</p>
          </div>
        `);
      } else {
        printWindow.document.write(`<div class="cell"></div>`);
      }
    });

    printWindow.document.write(`
          </div>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 350);
  };


  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">{t('batchCreate.title')}</h2>

      {entries.map((e, i) => (
        <div key={i} className="grid grid-cols-2 gap-3 mb-3">
          <input
            type="text"
            placeholder={t('batchCreate.materialCodePlaceholder')}
            value={e.code}
            onChange={(ev) => handleChange(i, 'code', ev.target.value)}
            className="border border-gray-300 rounded-md p-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          <input
            type="number"
            placeholder={t('batchCreate.quantityPlaceholder')}
            value={e.qty}
            onChange={(ev) => handleChange(i, 'qty', ev.target.value)}
            className="border border-gray-300 rounded-md p-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
      ))}
      <div className="flex gap-2 mt-3">
        <button
          onClick={handleAddRow}
          className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 font-medium"
        >
          {t('batchCreate.addRow')}
        </button>
        <button
          onClick={handleSaveAll}
          disabled={isSaving}
          className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-medium disabled:bg-indigo-400"
        >
          {isSaving ? t('batchCreate.saving') : t('batchCreate.saveAll')}
        </button>
      </div>

      {newMaterials.length > 0 && (
        <div className="mt-8 pt-6 border-t">
          <h3 className="text-xl font-semibold text-gray-700 mb-4">
            {t('batchCreate.generatedLabelsTitle')} ({newMaterials.length})
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-96 overflow-y-auto p-4 bg-gray-50 rounded-md">
            {newMaterials.map((m) => {
              const qrData: QrData = { id: m.id, materialCode: m.materialCode, quantity: m.initialQuantity };
              const qrValue = JSON.stringify(qrData);
              return (
                <div key={m.id} className="text-center p-2 bg-white rounded shadow">
                  <QRCodeSVG value={qrValue} size={120} className="mx-auto" />
                  <p className="font-bold text-gray-800 text-sm mt-2 truncate">{m.materialCode}</p>
                  <p className="text-xs text-gray-500">{t('common.quantity')}: {m.initialQuantity}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <button 
              onClick={() => handlePrintAll(newMaterials, "sticker")}
              className="w-full flex justify-center items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
            >
              {t('batchCreate.printStickerLayout')}
            </button>
            <button 
              onClick={() => handlePrintAll(newMaterials, "full")}
              className="w-full flex justify-center items-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              {t('batchCreate.printFullBleedLayout')}
            </button>
          </div>

        </div>
      )}
    </div>
  );
};

export default BatchCreateView;
