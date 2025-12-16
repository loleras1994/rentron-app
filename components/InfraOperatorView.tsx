import React, { useState } from "react";
import { useTranslation } from "../hooks/useTranslation";
import * as api from "../api/client";

/* ---------------------------------------------------------
   UNIVERSAL TIMESTAMP PARSER
--------------------------------------------------------- */
function parseTimestamp(ts?: string | null): Date | null {
  if (!ts) return null;
  return new Date(ts);
}

/* ---------------------------------------------------------
   Format local date/time DD-MM-YY HH:mm
--------------------------------------------------------- */
function formatLocalDDMMYYHHmm(date: Date | null): string {
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");

  const dd = pad(date.getDate());
  const mm = pad(date.getMonth() + 1);
  const yy = String(date.getFullYear()).slice(-2);
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());

  return `${dd}-${mm}-${yy} ${hh}:${min}`;
}

/* Escape CSV values safely */
function csvEscape(v: unknown): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

/* ---------------------------------------------------------
   COMPONENT
--------------------------------------------------------- */
const InfraOperatorView: React.FC = () => {
  const { t } = useTranslation();
  const [reportDate, setReportDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const allLogs = await api.getDailyLogs(); // unified mapped logs

      console.log("MAPPED LOGS:", allLogs);

      // Filter logs by date (using startTime)
      const logs = allLogs.filter((log) => {
        const start = parseTimestamp(log.startTime);
        if (!start) return false;
        return start.toISOString().split("T")[0] === reportDate;
      });

      if (logs.length === 0) {
        alert(`No data found for ${reportDate}.`);
        return;
      }

      const headers = [
        "Type",
        "Operator Username",
        "Order Number",
        "Production Sheet Number",
        "Product ID",
        "Phase ID",
        "Position",
        "Dead Code",
        "Dead Description",
        "Start Time (local)",
        "End Time (local)",
        "Total Minutes",
        "Setup Time",
        "Production Time",
        "Quantity Done",
        "Find Material Time",
      ];

      const csvRows = [headers.map(csvEscape).join(";")];

      logs.forEach((log: any) => {
        const start = parseTimestamp(log.startTime);
        const end = parseTimestamp(log.endTime);

        let totalMinutes = "";
        if (start && end) {
          totalMinutes = ((end.getTime() - start.getTime()) / 60000).toFixed(1);
        }

        const isDead = log.type === "dead";

        const operator =
          log.operatorUsername ||
          log.username ||
          "";    

        const row = [
          isDead ? "Dead Time" : "Phase",
          operator,
          log.orderNumber ?? "",
          log.productionSheetNumber ?? "",
          log.productId ?? "",
          isDead ? "" : log.phaseId ?? "",
          isDead ? "" : log.position ?? "",
          isDead ? log.deadCode ?? "" : "",
          isDead ? log.deadDescription ?? "" : "",
          formatLocalDDMMYYHHmm(start),
          formatLocalDDMMYYHHmm(end),
          totalMinutes,
          isDead ? "" : log.setupTime ? (log.setupTime / 60).toFixed(1) : "",
          isDead
            ? ""
            : log.productionTime
            ? (log.productionTime / 60).toFixed(1)
            : "",
          isDead ? "" : log.quantityDone ?? "",
          isDead
            ? ""
            : log.findMaterialTime
            ? (log.findMaterialTime / 60).toFixed(1)
            : "",
        ].map(csvEscape);

        csvRows.push(row.join(";"));
      });

      const csvContent = csvRows.join("\n");

      const blob = new Blob(["\uFEFF" + csvContent], {
        type: "text/csv;charset=utf-8;",
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
            className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md"
          />
        </div>

        <button
          onClick={handleExport}
          disabled={isExporting}
          className="w-full py-2 rounded-md text-white bg-indigo-600 disabled:bg-indigo-400"
        >
          {isExporting ? t("common.loading") : t("infraOperator.exportCsv")}
        </button>
      </div>
    </div>
  );
};

export default InfraOperatorView;
