import { useState } from 'react';
import { X, Bell, Wifi, CreditCard } from 'lucide-react';
import AlertSettings from './AlertSettings';
import SimManagement from './SimManagement';
import { paymentsApi } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

const TABS = [
  { id: 'alerts', label: 'アラート', icon: Bell },
  { id: 'sim', label: 'SIM管理', icon: Wifi },
  { id: 'subscription', label: 'サブスクリプション', icon: CreditCard },
];

const SettingsModal = ({ alerts, parentDevice, onClose, onSaveAlerts }) => {
  const [activeTab, setActiveTab] = useState('alerts');
  const { user } = useAuth();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-bold text-gray-900">設定</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* タブ */}
        <div className="flex border-b">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'text-green-600 border-b-2 border-green-600 bg-green-50'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* コンテンツ */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'alerts' && (
            <AlertSettingsTab
              alerts={alerts}
              onSave={onSaveAlerts}
            />
          )}

          {activeTab === 'sim' && (
            <SimManagement
              deviceId={parentDevice?.id}
              soracomSimId={parentDevice?.soracomSimId || `mock_sim_${parentDevice?.deviceId}`}
            />
          )}

          {activeTab === 'subscription' && (
            <SubscriptionTab user={user} />
          )}
        </div>
      </div>
    </div>
  );
};

// アラート設定タブ（インライン表示用）
const AlertSettingsTab = ({ alerts, onSave }) => {
  const [settings, setSettings] = useState(alerts || {
    tempMin: 10,
    tempMax: 35,
    humidityMin: 40,
    humidityMax: 85,
    frostWarning: 3,
    frostCritical: 0,
    emailEnabled: true,
    lineEnabled: false,
  });

  const handleChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onSave(settings);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-gray-900 mb-3">温度アラート</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">下限 (°C)</label>
            <input
              type="number"
              value={settings.tempMin}
              onChange={(e) => handleChange('tempMin', parseFloat(e.target.value))}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">上限 (°C)</label>
            <input
              type="number"
              value={settings.tempMax}
              onChange={(e) => handleChange('tempMax', parseFloat(e.target.value))}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
          </div>
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-gray-900 mb-3">湿度アラート</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">下限 (%)</label>
            <input
              type="number"
              value={settings.humidityMin}
              onChange={(e) => handleChange('humidityMin', parseFloat(e.target.value))}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">上限 (%)</label>
            <input
              type="number"
              value={settings.humidityMax}
              onChange={(e) => handleChange('humidityMax', parseFloat(e.target.value))}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
          </div>
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-gray-900 mb-3">霜アラート</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">警告 (°C)</label>
            <input
              type="number"
              value={settings.frostWarning}
              onChange={(e) => handleChange('frostWarning', parseFloat(e.target.value))}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">危険 (°C)</label>
            <input
              type="number"
              value={settings.frostCritical}
              onChange={(e) => handleChange('frostCritical', parseFloat(e.target.value))}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
          </div>
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-gray-900 mb-3">通知設定</h3>
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.emailEnabled}
              onChange={(e) => handleChange('emailEnabled', e.target.checked)}
              className="w-4 h-4 text-green-600 rounded focus:ring-green-500"
            />
            <span className="text-sm text-gray-700">メール通知</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.lineEnabled}
              onChange={(e) => handleChange('lineEnabled', e.target.checked)}
              className="w-4 h-4 text-green-600 rounded focus:ring-green-500"
            />
            <span className="text-sm text-gray-700">LINE通知</span>
          </label>
        </div>
      </div>

      <button
        onClick={handleSave}
        className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2.5 rounded-lg transition-colors"
      >
        保存
      </button>
    </div>
  );
};

// サブスクリプションタブ
const SubscriptionTab = ({ user }) => {
  const [subscription, setSubscription] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useState(() => {
    const fetchSubscription = async () => {
      try {
        const data = await paymentsApi.getSubscription();
        setSubscription(data);
      } catch (err) {
        if (err.response?.status !== 404) {
          setError('サブスクリプション情報の取得に失敗しました');
        }
      } finally {
        setIsLoading(false);
      }
    };
    fetchSubscription();
  }, []);

  const handleSubscribe = async (plan) => {
    try {
      const result = await paymentsApi.createCheckout(plan);
      if (result.url) {
        window.location.href = result.url;
      }
    } catch (err) {
      setError(err.response?.data?.message || '決済処理に失敗しました');
    }
  };

  const handleCancel = async () => {
    if (!window.confirm('サブスクリプションをキャンセルしますか？')) return;
    try {
      await paymentsApi.cancelSubscription();
      const data = await paymentsApi.getSubscription();
      setSubscription(data);
    } catch (err) {
      setError(err.response?.data?.message || 'キャンセルに失敗しました');
    }
  };

  if (isLoading) {
    return <div className="text-center py-8 text-gray-500">読み込み中...</div>;
  }

  const PLAN_NAMES = {
    MONTHLY: '1ヶ月',
    QUARTERLY: '3ヶ月',
    BIANNUAL: '6ヶ月',
    YEARLY: '1年',
    TWO_YEAR: '2年',
    THREE_YEAR: '3年',
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {subscription ? (
        <div className="bg-gray-50 rounded-lg p-4">
          <h3 className="font-semibold text-gray-900 mb-3">現在のプラン</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">プラン</span>
              <span className="font-medium">{PLAN_NAMES[subscription.plan] || subscription.plan}プラン</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">ステータス</span>
              <span className={`font-medium ${
                subscription.status === 'ACTIVE' ? 'text-green-600' : 'text-red-600'
              }`}>
                {subscription.status === 'ACTIVE' ? 'アクティブ' : subscription.status}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">次回更新日</span>
              <span className="font-medium">
                {new Date(subscription.currentPeriodEnd).toLocaleDateString('ja-JP')}
              </span>
            </div>
            {subscription.testMode && (
              <div className="mt-2 text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded">
                テストモード
              </div>
            )}
          </div>

          {subscription.status === 'ACTIVE' && (
            <button
              onClick={handleCancel}
              className="mt-4 w-full bg-red-100 hover:bg-red-200 text-red-700 font-medium py-2 rounded-lg transition-colors"
            >
              解約する
            </button>
          )}
        </div>
      ) : (
        <div>
          <h3 className="font-semibold text-gray-900 mb-3">プランを選択</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { id: 'MONTHLY', name: '1ヶ月', price: '¥1,980' },
              { id: 'YEARLY', name: '1年', price: '¥17,760', popular: true },
            ].map((plan) => (
              <button
                key={plan.id}
                onClick={() => handleSubscribe(plan.id)}
                className={`p-4 rounded-lg border-2 text-left transition-colors ${
                  plan.popular
                    ? 'border-green-500 bg-green-50 hover:bg-green-100'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="font-medium text-gray-900">{plan.name}</div>
                <div className="text-lg font-bold text-green-600">{plan.price}</div>
                {plan.popular && (
                  <span className="text-xs text-green-600 font-medium">人気</span>
                )}
              </button>
            ))}
          </div>
          <a
            href="/pricing"
            className="block mt-3 text-center text-sm text-green-600 hover:text-green-700"
          >
            すべてのプランを見る →
          </a>
        </div>
      )}

      <div className="pt-4 border-t">
        <h3 className="font-semibold text-gray-900 mb-2">アカウント情報</h3>
        <div className="text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-500">メール</span>
            <span className="text-gray-900">{user?.email}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">名前</span>
            <span className="text-gray-900">{user?.name}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
