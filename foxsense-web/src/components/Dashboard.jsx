import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { MapPin, Battery, Signal, Clock, Wifi, Radio, Trash2 } from 'lucide-react';
import GaugeCard from './GaugeCard';
import HistoryChart from './HistoryChart';

const Dashboard = ({ device, latestData, historyData, alerts, isParent, onDelete }) => {
  const lastUpdate = latestData?.timestamp
    ? format(new Date(latestData.timestamp), 'M月d日 HH:mm', { locale: ja })
    : '--';

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* デバイス情報ヘッダー */}
      <div className="card p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg sm:text-xl font-bold text-gray-800">{device.name}</h2>
              {isParent ? (
                <span className="px-2 py-0.5 bg-blue-100 text-blue-600 text-xs rounded-md font-medium">
                  親機
                </span>
              ) : (
                <span className="px-2 py-0.5 bg-leaf-100 text-leaf-600 text-xs rounded-md font-medium">
                  子機
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 text-gray-500">
              <MapPin className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="text-xs sm:text-sm">{device.location || '場所未設定'}</span>
            </div>
            {!isParent && device.id && (
              <div className="mt-1 text-xs text-gray-400 font-mono">
                ID: {device.id}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            {/* ステータス */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              <div
                className={`w-2 h-2 sm:w-3 sm:h-3 rounded-full ${
                  device.isOnline ? 'bg-leaf-500 pulse-soft' : 'bg-gray-300'
                }`}
              />
              <span className={`text-xs sm:text-sm font-medium ${device.isOnline ? 'text-leaf-600' : 'text-gray-400'}`}>
                {device.isOnline ? 'オンライン' : 'オフライン'}
              </span>
            </div>

            {/* バッテリー */}
            <div className="flex items-center gap-1">
              <Battery
                className={`w-3 h-3 sm:w-4 sm:h-4 ${
                  device.battery > 20 ? 'text-leaf-500' : 'text-red-500'
                }`}
              />
              <span
                className={`text-xs sm:text-sm ${
                  device.battery > 20 ? 'text-gray-600' : 'text-red-500'
                }`}
              >
                {device.battery}%
              </span>
            </div>

            {/* 電波強度 */}
            {isParent ? (
              <div className="flex items-center gap-1">
                <Wifi className="w-3 h-3 sm:w-4 sm:h-4 text-blue-500" />
                <span className="text-xs sm:text-sm text-gray-600">LTE {device.signal}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <Radio className="w-3 h-3 sm:w-4 sm:h-4 text-leaf-500" />
                <span className="text-xs sm:text-sm text-gray-600">{device.rssi} dBm</span>
              </div>
            )}

            {/* 最終更新 */}
            <div className="flex items-center gap-1 text-gray-400">
              <Clock className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="text-xs sm:text-sm">{lastUpdate}</span>
            </div>

            {/* 削除ボタン（子機のみ） */}
            {!isParent && onDelete && (
              <button
                onClick={() => onDelete(device.id)}
                className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                title="この子機を削除"
              >
                <Trash2 className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="text-xs sm:text-sm">削除</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ゲージカード */}
      {device.isOnline && latestData ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
          <GaugeCard
            type="temperature"
            value={latestData?.temperature}
            min={0}
            max={50}
            alertMin={alerts.tempMin}
            alertMax={alerts.tempMax}
          />
          <GaugeCard
            type="humidity"
            value={latestData?.humidity}
            min={0}
            max={100}
            alertMin={alerts.humidityMin}
            alertMax={alerts.humidityMax}
          />
        </div>
      ) : (
        <div className="card p-6 sm:p-8 text-center">
          <div className="text-gray-400">
            <Signal className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-2 sm:mb-3 opacity-50" />
            <p className="text-base sm:text-lg font-medium">データなし</p>
            <p className="text-xs sm:text-sm mt-1">デバイスがオフラインか、まだデータを受信していません</p>
          </div>
        </div>
      )}

      {/* 履歴チャート */}
      <HistoryChart data={historyData} alerts={alerts} deviceName={device.name} />
    </div>
  );
};

export default Dashboard;
