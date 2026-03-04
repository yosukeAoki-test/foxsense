import { useState, useEffect } from 'react';
import { X, Printer, ChevronLeft, Loader2 } from 'lucide-react';
import { foxCoinApi } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

const OrderHistoryModal = ({ onClose }) => {
  const { user } = useAuth();
  const [purchases, setPurchases] = useState(null);
  const [selectedPurchase, setSelectedPurchase] = useState(null);

  useEffect(() => {
    foxCoinApi.getPurchases()
      .then(setPurchases)
      .catch(() => setPurchases([]));
  }, []);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            {selectedPurchase && (
              <button
                onClick={() => setSelectedPurchase(null)}
                className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ChevronLeft className="w-4 h-4 text-gray-500" />
              </button>
            )}
            <h2 className="text-lg font-bold text-gray-900">
              {selectedPurchase ? '領収書' : '購入履歴'}
            </h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {!selectedPurchase ? (
            purchases === null ? (
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
                      <th className="text-right py-2 font-medium">操作</th>
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
                            <button
                              onClick={() => setSelectedPurchase(p)}
                              className="px-2.5 py-1 text-xs border border-gray-200 hover:border-gray-300 text-gray-600 hover:text-gray-800 rounded-lg transition-colors"
                            >
                              領収書
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            /* 領収書プレビュー */
            <div>
              <div className="receipt-print-area border border-gray-200 rounded-xl p-8 max-w-md mx-auto">
                <div className="text-center mb-6">
                  <h3 className="text-2xl font-bold tracking-widest mb-1">領　収　書</h3>
                  <p className="text-gray-400 text-xs">No. {selectedPurchase.id.slice(0, 8).toUpperCase()}</p>
                </div>

                <div className="border-t border-b border-gray-200 py-4 mb-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">発行日</span>
                    <span>{new Date(selectedPurchase.purchasedAt).toLocaleDateString('ja-JP')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">宛名</span>
                    <span>{user?.name || 'お客様'} 様</span>
                  </div>
                </div>

                <table className="w-full mb-4 text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1.5 font-medium text-gray-600">品目</th>
                      <th className="text-center py-1.5 font-medium text-gray-600">数量</th>
                      <th className="text-right py-1.5 font-medium text-gray-600">金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="py-3">
                        {selectedPurchase.package?.name || 'FoxCoin'} ({selectedPurchase.coins} FC)
                      </td>
                      <td className="text-center py-3">1</td>
                      <td className="text-right py-3">¥{selectedPurchase.price.toLocaleString()}</td>
                    </tr>
                  </tbody>
                </table>

                <div className="border-t pt-3 space-y-1 text-sm mb-6">
                  <div className="flex justify-between font-bold text-base">
                    <span>合計</span>
                    <span>¥{selectedPurchase.price.toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-gray-400 text-right">（税込）</p>
                </div>

                <div className="border-t pt-4 text-center text-sm text-gray-500">
                  <p className="font-semibold text-gray-700">FoxSense</p>
                </div>
              </div>

              <div className="flex justify-center mt-4">
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <Printer className="w-4 h-4" />
                  印刷 / PDFで保存
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OrderHistoryModal;
