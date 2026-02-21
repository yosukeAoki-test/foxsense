import { useState } from 'react';
import { X, Bell, Wifi } from 'lucide-react';
import AlertSettings from './AlertSettings';
import SimManagement from './SimManagement';

const TABS = [
  { id: 'alerts', label: 'アラート', icon: Bell },
  { id: 'sim', label: 'SIM管理', icon: Wifi },
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
            <SimManagement
              deviceId={parentDevice?.id}
              soracomSimId={parentDevice?.soracomSimId || `mock_sim_${parentDevice?.deviceId}`}
            />
          )}
        </div>
      </div>
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
