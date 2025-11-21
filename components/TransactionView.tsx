import React, { useEffect, useState } from "react";
import type { Transaction } from "../src/types";
import * as api from "../api/client";
import { useTranslation } from '../hooks/useTranslation';

const TransactionView: React.FC = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    async function fetchTransactions() {
      try {
        setLoading(true);
        setError(null);
        const data = await api.getTransactions();
        setTransactions(data);
      } catch (err: any) {
        setError(err.message || "Failed to load transactions");
      } finally {
        setLoading(false);
      }
    }
    fetchTransactions();
  }, []);

  if (loading) return <p className="text-gray-500 text-center mt-8">{t('transactions.loading')}</p>;
  if (error) return <p className="text-red-500 text-center mt-8">{error}</p>;

  return (
    <div className="max-w-6xl mx-auto bg-white shadow-lg rounded-lg p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">{t('transactions.title')}</h2>
      {transactions.length === 0 ? (
        <p className="text-gray-500">{t('transactions.noResults')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('transactions.table.id')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('transactions.table.itemId')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('transactions.table.change')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('transactions.table.reason')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('transactions.table.user')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('transactions.table.date')}</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {transactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-gray-50">
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">{tx.id}</td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 font-mono text-xs">{tx.item_id}</td>
                  <td className={`px-4 py-4 whitespace-nowrap text-sm font-semibold ${tx.delta > 0 ? "text-green-600" : "text-red-600"}`}>
                    {tx.delta > 0 ? `+${tx.delta}` : tx.delta}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-600"><span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">{tx.reason || "—"}</span></td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-600">{tx.user || "—"}</td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(tx.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default TransactionView;
