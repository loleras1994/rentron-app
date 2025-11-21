import React, { useState } from "react";
import { useTranslation } from "../hooks/useTranslation";
import * as api from "../api/client";
import type { PhaseLog } from "../src/types";

/** Parse a timestamp that may be from SQLite (UTC without Z) or ISO(Z). */
function parseUtcTimestamp(ts?: string | null): Date | null {
  if (!ts) return null;
  if (ts.includes("T")) return new Date(ts);
  return new Date(ts.replace(" ", "T") + "Z");
}

/** Format a Date into local "DD-MM-YY HH:mm" */
function formatLocalDDMMYYHHmm(d: Date | null): string {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const dd = pad(d.getDate());
  const mm = pad(d.getMonth() + 1);
  const yy = String(d.getFullYear()).slice(-2);
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${dd}-${mm}-${yy} ${hh}:${min}`;
}

/** Escape CSV values */
function csvEscape(v: unknown): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

const InfraOperatorView: React.FC = () => {
  const { t } = useTranslation();
  const [reportDate, setReportDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const allLogs: PhaseLog[] = await api.getDailyLogs(reportDate);

      // Filter by selected date (local)
      const logs = allLogs.filter((log) => {
        const s = parseUtcTimestamp(log.startTime);
        if (!s) return false;
        const y = s.getFullYear();
        const m = String(s.getMonth() + 1).padStart(2, "0");
        const d = String(s.getDate()).padStart(2, "0");
        const localDate = `${y}-${m}-${d}`;
        return localDate === reportDate;
      });

      if (logs.length === 0) {
        alert(`No data found for ${reportDate}.`);
        return;
      }

      const headers = [
        "Operator Username",
        "Order Number",
        "Production Sheet Number",
        "Product ID",
        "Phase ID",
        "Start Time (local)",
        "End Time (local)",
        "Total (setup+production) min",
        "Setup Time (min)",
        "Production Time (min)",
        "Quantity Done",
        "Find Material Time (min)"
      ];

      // ⭐ Excel-friendly semicolons
      const csvRows = [headers.map(csvEscape).join(";")];

      logs.forEach((log) => {
        const start = parseUtcTimestamp(log.startTime);
        const end = parseUtcTimestamp(log.endTime);

        let totalMinutes = "";
        if (log.setupTime || log.productionTime) {
          const totalSec = (log.setupTime ?? 0) + (log.productionTime ?? 0);
          totalMinutes = (totalSec / 60).toFixed(1);
        } else if (start && end) {
          const diffMs = end.getTime() - start.getTime();
          if (!isNaN(diffMs)) totalMinutes = (diffMs / 60000).toFixed(1);
        }

        const row = [
          log.operatorUsername || "",
          log.orderNumber || "",
          log.productionSheetNumber || "",
          log.productId || "",
          log.phaseId || "",
          formatLocalDDMMYYHHmm(start),
          formatLocalDDMMYYHHmm(end),
          totalMinutes,
          log.setupTime ? (log.setupTime / 60).toFixed(1) : "",
          log.productionTime ? (log.productionTime / 60).toFixed(1) : "",
          log.quantityDone ?? "",
          log.findMaterialTime ? (log.findMaterialTime / 60).toFixed(1) : ""
        ].map(csvEscape);

        csvRows.push(row.join(";")); // ⭐ semicolon delimiter
      });

      const csvContent = csvRows.join("\n");

      // ⭐ Add UTF-8 BOM so Excel displays Greek correctly
      const blob = new Blob(["\uFEFF" + csvContent], {
        type: "text/csv;charset=utf-8;"
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `daily_report_${reportDate}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export CSV:", err);
      alert("An error occurred during export.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-md mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">
        {t("infraOperator.title")}
      </h2>
      <div className="space-y-4">
        <div>
          <label
            htmlFor="report-date"
            className="block text-sm font-medium text-gray-700"
          >
            {t("infraOperator.selectDate")}
          </label>
          <input
            id="report-date"
            type="date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        <button
          onClick={handleExport}
          disabled={isExporting}
          className="w-full flex justify-center py-2 px-4 rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-400"
        >
          {isExporting ? t("common.loading") : t("infraOperator.exportCsv")}
        </button>
      </div>
    </div>
  );
};

export default InfraOperatorView;
