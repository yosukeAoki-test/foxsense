import { useState, useEffect } from 'react';
import { foxCoinApi } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { Loader2, Coins, History, ShieldAlert } from 'lucide-react';
import OrderHistoryModal from './OrderHistoryModal';

const SubscriptionTab = () => {
  const { user } = useAuth();
  const [balance, setBalance] = useState(null);
  const [purchasing, setPurchasing] = useState(null);
  const [showOrderHistory, setShowOrderHistory] = useState(false);

  useEffect(() => {
    foxCoinApi.getBalance().then(setBalance).catch(() => {});
  }, []);

  const handlePurchase = async (packageId) => {
    if (!user?.twoFactorEnabled) return; // バックエンドでも弾くが念のため
    setPurchasing(packageId);
    try {
      const { url } = await foxCoinApi.createCheckout(packageId);
      window.location.href = url;
    } catch (err) {
      alert(err.response?.data?.message || '購入ページへの遷移に失敗しました');
    } finally {
      setPurchasing(null);
    }
  };

  if (!balance) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const remainingDays = balance.balance;

  return (
    <div className="space-y-5">
      {/* 現在の残高 */}
      <div className={`p-4 rounded-xl border ${
        balance.simStatus === 'ACTIVE'
          ? 'bg-yellow-50 border-yellow-200'
          : balance.simStatus === 'SUSPENDED'
          ? 'bg-red-50 border-red-200'
          : 'bg-gray-50 border-gray-200'
      }`}>
        <div className="flex items-center gap-2 mb-1">
          <Coins className={`w-5 h-5 ${
            balance.simStatus === 'ACTIVE' ? 'text-yellow-600' : 'text-gray-400'
          }`} />
          <span className="font-semibold text-gray-800">FoxCoin 残高</span>
        </div>
        <div className="text-3xl font-bold text-gray-900">
          {balance.balance} <span className="text-lg font-normal text-gray-500">FC</span>
        </div>
        <p className="text-sm mt-1 text-gray-600">
          {balance.simStatus === 'ACTIVE'
            ? `残り約 ${remainingDays} 日（1FC / 24時間消費）`
            : balance.simStatus === 'SUSPENDED'
            ? '残高不足のため通信停止中'
            : '通信停止中'}
        </p>
      </div>

      {/* 2FA未設定の警告 */}
      {!user?.twoFactorEnabled && (
        <div className="flex items-start gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg text-orange-700 text-sm">
          <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>購入するには<strong>2段階認証</strong>の設定が必要です。「セキュリティ」タブから設定してください。</span>
        </div>
      )}

      {/* パッケージ一覧 */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">FoxCoinを購入</p>
        <div className="grid grid-cols-2 gap-2">
          {(balance.packages || []).map(pkg => (
            <div key={pkg.id} className="border border-gray-200 rounded-xl p-3 hover:border-yellow-300 transition-colors">
              <div className="font-semibold text-gray-800 text-sm">{pkg.name}</div>
              <div className="text-yellow-600 font-bold text-sm">{pkg.coins} FC</div>
              <div className="text-xs text-gray-500 mb-2">約 {pkg.coins} 日分</div>
              {pkg.price > 0 && (
                <div className="text-xs text-gray-500 mb-1">¥{pkg.price.toLocaleString()}</div>
              )}
              <button
                onClick={() => handlePurchase(pkg.id)}
                disabled={!!purchasing || !pkg.stripePriceId || !user?.twoFactorEnabled}
                className="w-full py-1.5 bg-yellow-500 hover:bg-yellow-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1"
              >
                {purchasing === pkg.id && <Loader2 className="w-3 h-3 animate-spin" />}
                {!pkg.stripePriceId ? '準備中' : !user?.twoFactorEnabled ? '2FA必須' : '購入する'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 購入履歴 */}
      <button
        onClick={() => setShowOrderHistory(true)}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <History className="w-4 h-4" />
        購入履歴・領収書
      </button>

      {showOrderHistory && (
        <OrderHistoryModal onClose={() => setShowOrderHistory(false)} />
      )}
    </div>
  );
};

export default SubscriptionTab;
