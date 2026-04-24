import { useState, useEffect } from 'react';
import { X, Bell, Wifi, ShieldCheck, CreditCard } from 'lucide-react';
import AlertSettings from './AlertSettings';
import SimManagement from './SimManagement';
import SubscriptionTab from './SubscriptionTab';
import { authApi } from '../api/client';

const TABS = [
  { id: 'alerts', label: 'アラート', icon: Bell },
  { id: 'sim', label: 'SIM管理', icon: Wifi },
  { id: 'security', label: 'セキュリティ', icon: ShieldCheck },
  { id: 'subscription', label: 'FoxCoin', icon: CreditCard },
];

const SettingsModal = ({ alerts, parentDevice, onClose, onSaveAlerts }) => {
  const [activeTab, setActiveTab] = useState('alerts');

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
            <SimManagement />
          )}

          {activeTab === 'security' && (
            <TwoFactorTab />
          )}

          {activeTab === 'subscription' && (
            <SubscriptionTab onOpen2fa={() => { onClose(); }} />
          )}
        </div>
      </div>
    </div>
  );
};

// 2FAタブ
const TwoFactorTab = () => {
  const [phase, setPhase] = useState('idle'); // 'idle' | 'setup' | 'disable'
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(null); // null = 未確認
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // 現在の2FA状態を取得（初回レンダリング時）
  useEffect(() => {
    authApi.me().then(res => {
      setTwoFactorEnabled(res.data.user.twoFactorEnabled ?? false);
    }).catch(() => {});
  }, []);

  const handleSetup = async () => {
    setError('');
    setIsLoading(true);
    try {
      const res = await authApi.setup2fa();
      setQrCodeDataUrl(res.data.qrCodeDataUrl);
      setSecret(res.data.secret);
      setPhase('setup');
    } catch (err) {
      setError(err.response?.data?.message || 'セットアップに失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEnable = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await authApi.enable2fa(code);
      setTwoFactorEnabled(true);
      setPhase('idle');
      setCode('');
      setSuccess('2段階認証を有効にしました');
    } catch (err) {
      setError(err.response?.data?.message || '認証コードが正しくありません');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisable = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await authApi.disable2fa(code);
      setTwoFactorEnabled(false);
      setPhase('idle');
      setCode('');
      setSuccess('2段階認証を無効にしました');
    } catch (err) {
      setError(err.response?.data?.message || '認証コードが正しくありません');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-md">
      <div>
        <h3 className="font-semibold text-gray-900 mb-1">2段階認証（TOTP）</h3>
        <p className="text-sm text-gray-500">Google AuthenticatorなどのTOTPアプリを使った認証を設定します。</p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 rounded-lg text-red-600 text-sm">{error}</div>
      )}
      {success && (
        <div className="p-3 bg-green-50 rounded-lg text-green-700 text-sm">{success}</div>
      )}

      {/* 現在の状態表示 */}
      {twoFactorEnabled !== null && phase === 'idle' && (
        <div className={`flex items-center gap-3 p-4 rounded-xl border ${twoFactorEnabled ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
          <ShieldCheck className={`w-6 h-6 ${twoFactorEnabled ? 'text-green-600' : 'text-gray-400'}`} />
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900">
              {twoFactorEnabled ? '有効' : '無効'}
            </p>
            <p className="text-xs text-gray-500">
              {twoFactorEnabled ? '2段階認証が設定されています' : '2段階認証は設定されていません'}
            </p>
          </div>
        </div>
      )}

      {/* アクションボタン */}
      {phase === 'idle' && twoFactorEnabled !== null && (
        twoFactorEnabled ? (
          <button
            onClick={() => { setPhase('disable'); setCode(''); setError(''); setSuccess(''); }}
            className="w-full py-2.5 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 text-sm font-medium transition-colors"
          >
            2段階認証を無効にする
          </button>
        ) : (
          <button
            onClick={handleSetup}
            disabled={isLoading}
            className="w-full py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {isLoading ? '準備中...' : '2段階認証を設定する'}
          </button>
        )
      )}

      {/* セットアップ画面：QRコード + コード確認 */}
      {phase === 'setup' && (
        <form onSubmit={handleEnable} className="space-y-4">
          <p className="text-sm text-gray-700">
            1. 認証アプリ（Google Authenticator など）でQRコードをスキャンしてください。
          </p>
          {qrCodeDataUrl && (
            <div className="flex justify-center">
              <img src={qrCodeDataUrl} alt="2FA QR Code" className="w-48 h-48 border rounded-lg" />
            </div>
          )}
          {secret && (
            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-500 mb-1">QRが読めない場合は手動入力：</p>
              <p className="font-mono text-sm text-gray-800 break-all">{secret}</p>
            </div>
          )}
          <p className="text-sm text-gray-700">
            2. アプリに表示された6桁のコードを入力して有効化してください。
          </p>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-leaf-400 focus:ring-2 focus:ring-leaf-100 outline-none text-center text-2xl tracking-widest font-mono"
            required
            autoComplete="one-time-code"
          />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { setPhase('idle'); setCode(''); setError(''); }}
              className="flex-1 py-2.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium transition-colors"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={isLoading || code.length !== 6}
              className="flex-1 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {isLoading ? '確認中...' : '有効化する'}
            </button>
          </div>
        </form>
      )}

      {/* 無効化画面：コード確認 */}
      {phase === 'disable' && (
        <form onSubmit={handleDisable} className="space-y-4">
          <p className="text-sm text-gray-700">
            認証アプリに表示されている6桁のコードを入力して2段階認証を無効にしてください。
          </p>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-leaf-400 focus:ring-2 focus:ring-leaf-100 outline-none text-center text-2xl tracking-widest font-mono"
            required
            autoComplete="one-time-code"
          />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { setPhase('idle'); setCode(''); setError(''); }}
              className="flex-1 py-2.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium transition-colors"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={isLoading || code.length !== 6}
              className="flex-1 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {isLoading ? '処理中...' : '無効にする'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

// アラート設定タブ
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

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-gray-900 mb-3">温度アラート</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">下限 (°C)</label>
            <input type="number" value={settings.tempMin}
              onChange={(e) => handleChange('tempMin', parseFloat(e.target.value))}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">上限 (°C)</label>
            <input type="number" value={settings.tempMax}
              onChange={(e) => handleChange('tempMax', parseFloat(e.target.value))}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500" />
          </div>
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-gray-900 mb-3">湿度アラート</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">下限 (%)</label>
            <input type="number" value={settings.humidityMin}
              onChange={(e) => handleChange('humidityMin', parseFloat(e.target.value))}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">上限 (%)</label>
            <input type="number" value={settings.humidityMax}
              onChange={(e) => handleChange('humidityMax', parseFloat(e.target.value))}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500" />
          </div>
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-gray-900 mb-3">霜アラート</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">警告 (°C)</label>
            <input type="number" value={settings.frostWarning}
              onChange={(e) => handleChange('frostWarning', parseFloat(e.target.value))}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">危険 (°C)</label>
            <input type="number" value={settings.frostCritical}
              onChange={(e) => handleChange('frostCritical', parseFloat(e.target.value))}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500" />
          </div>
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-gray-900 mb-3">通知設定</h3>
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={settings.emailEnabled}
              onChange={(e) => handleChange('emailEnabled', e.target.checked)}
              className="w-4 h-4 text-green-600 rounded focus:ring-green-500" />
            <span className="text-sm text-gray-700">メール通知</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={settings.lineEnabled}
              onChange={(e) => handleChange('lineEnabled', e.target.checked)}
              className="w-4 h-4 text-green-600 rounded focus:ring-green-500" />
            <span className="text-sm text-gray-700">LINE通知</span>
          </label>
        </div>
      </div>

      <button
        onClick={() => onSave(settings)}
        className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2.5 rounded-lg transition-colors"
      >
        保存
      </button>
    </div>
  );
};

export default SettingsModal;
