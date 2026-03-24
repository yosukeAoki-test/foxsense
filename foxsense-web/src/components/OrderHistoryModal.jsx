import { useState, useEffect } from 'react';
import { X, Loader2, ExternalLink } from 'lucide-react';
import { foxCoinApi } from '../api/client';

const OrderHistoryModal = ({ onClose }) => {
  const [purchases, setPurchases] = useState(null);

  useEffect(() => {
    foxCoinApi.getPurchases()
      .then(setPurchases)
      .catch(() => setPurchases([]));
  }, []);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-bold text-gray-900">購入履歴・領収書</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {purchases === null ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : purchases.length === 0 ? (
            <p className="text-center text-gray-500 py-8 text-sm">購入履歴がありません</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-gray-500 text-xs">
                    <th className="text-left py-2 pr-3 font-medium">日付</th>
                    <th className="text-left py-2 pr-3 font-medium">パッケージ</th>
                    <th className="text-right py-2 pr-3 font-medium">コイン</th>
                    <th className="text-right py-2 pr-3 font-medium">金額</th>
                    <th className="text-right py-2 font-medium">領収書</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.map(p => (
                    <tr key={p.id} className="border-b hover:bg-gray-50">
                      <td className="py-2.5 pr-3 text-gray-600 whitespace-nowrap">
                        {new Date(p.purchasedAt).toLocaleDateString('ja-JP')}
                      </td>
                      <td className="py-2.5 pr-3 text-gray-800">
                        {p.package?.name || p.note || 'FoxCoin'}
                      </td>
                      <td className="py-2.5 pr-3 text-right text-yellow-600 font-bold">
                        +{p.coins} FC
                      </td>
                      <td className="py-2.5 pr-3 text-right text-gray-800 font-medium whitespace-nowrap">
                        {p.price > 0 ? `¥${p.price.toLocaleString()}` : '無料'}
                      </td>
                      <td className="py-2.5 text-right">
                        {p.price > 0 && (
                          <a
                            href={`/receipt/${p.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-gray-200 hover:border-green-400 hover:text-green-700 text-gray-600 rounded-lg transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                            表示
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-gray-400 mt-3 text-center">
                適格請求書（インボイス）対応 — 発行者: geoAlpine合同会社 登録番号: T5390003002074
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OrderHistoryModal;
