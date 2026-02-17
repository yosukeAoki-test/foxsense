import { useState } from 'react';
import { X, Bell, Mail, MessageCircle, Thermometer, Droplets, Snowflake } from 'lucide-react';

const AlertSettings = ({ alerts, onClose, onSave }) => {
  const [settings, setSettings] = useState({ ...alerts });

  const handleChange = (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(settings);
  };

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 z-50">
      <div className="card w-full max-w-md p-4 sm:p-6 fade-in max-h-[95vh] overflow-y-auto">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 sm:w-5 sm:h-5 text-leaf-600" />
            <h2 className="text-base sm:text-lg font-bold text-gray-800">アラート設定</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 sm:p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
          {/* 温度設定 */}
          <div>
            <div className="flex items-center gap-2 mb-2 sm:mb-3">
              <Thermometer className="w-4 h-4 text-orange-500" />
              <span className="font-medium text-gray-700 text-sm sm:text-base">温度アラート</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">下限 (°C)</label>
                <input
                  type="number"
                  value={settings.tempMin}
                  onChange={(e) => handleChange('tempMin', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-leaf-400 focus:ring-2 focus:ring-leaf-100 outline-none transition-all text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">上限 (°C)</label>
                <input
                  type="number"
                  value={settings.tempMax}
                  onChange={(e) => handleChange('tempMax', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-leaf-400 focus:ring-2 focus:ring-leaf-100 outline-none transition-all text-sm"
                />
              </div>
            </div>
          </div>

          {/* 湿度設定 */}
          <div>
            <div className="flex items-center gap-2 mb-2 sm:mb-3">
              <Droplets className="w-4 h-4 text-blue-500" />
              <span className="font-medium text-gray-700 text-sm sm:text-base">湿度アラート</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">下限 (%)</label>
                <input
                  type="number"
                  value={settings.humidityMin}
                  onChange={(e) => handleChange('humidityMin', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-leaf-400 focus:ring-2 focus:ring-leaf-100 outline-none transition-all text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">上限 (%)</label>
                <input
                  type="number"
                  value={settings.humidityMax}
                  onChange={(e) => handleChange('humidityMax', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-leaf-400 focus:ring-2 focus:ring-leaf-100 outline-none transition-all text-sm"
                />
              </div>
            </div>
          </div>

          {/* 霜予測設定 */}
          <div>
            <div className="flex items-center gap-2 mb-2 sm:mb-3">
              <Snowflake className="w-4 h-4 text-blue-400" />
              <span className="font-medium text-gray-700 text-sm sm:text-base">霜予測アラート</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">警告温度 (°C)</label>
                <input
                  type="number"
                  step="0.5"
                  value={settings.frostWarning ?? 3}
                  onChange={(e) => handleChange('frostWarning', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-leaf-400 focus:ring-2 focus:ring-leaf-100 outline-none transition-all text-sm"
                />
                <p className="text-xs text-gray-400 mt-1">この温度以下で注意</p>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">危険温度 (°C)</label>
                <input
                  type="number"
                  step="0.5"
                  value={settings.frostCritical ?? 0}
                  onChange={(e) => handleChange('frostCritical', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-leaf-400 focus:ring-2 focus:ring-leaf-100 outline-none transition-all text-sm"
                />
                <p className="text-xs text-gray-400 mt-1">この温度以下で緊急警報</p>
              </div>
            </div>
          </div>

          {/* 通知方法 */}
          <div>
            <span className="font-medium text-gray-700 block mb-2 sm:mb-3 text-sm sm:text-base">通知方法</span>
            <div className="space-y-2 sm:space-y-3">
              <label className="flex items-center gap-2 sm:gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.emailEnabled}
                  onChange={(e) => handleChange('emailEnabled', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-leaf-500 focus:ring-leaf-400"
                />
                <Mail className="w-4 h-4 text-gray-500" />
                <span className="text-sm text-gray-700">メール通知</span>
              </label>
              <label className="flex items-center gap-2 sm:gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.lineEnabled}
                  onChange={(e) => handleChange('lineEnabled', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-leaf-500 focus:ring-leaf-400"
                />
                <MessageCircle className="w-4 h-4 text-gray-500" />
                <span className="text-sm text-gray-700">LINE通知</span>
              </label>
            </div>
          </div>

          {/* ボタン */}
          <div className="flex gap-2 sm:gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-3 sm:px-4 py-2 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors text-sm"
            >
              キャンセル
            </button>
            <button
              type="submit"
              className="flex-1 px-3 sm:px-4 py-2 rounded-xl bg-gradient-to-r from-leaf-500 to-leaf-600 text-white font-medium hover:from-leaf-600 hover:to-leaf-700 transition-all shadow-lg shadow-leaf-500/25 text-sm"
            >
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AlertSettings;
