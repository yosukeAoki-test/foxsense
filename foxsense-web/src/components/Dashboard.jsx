import { useState } from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { MapPin, Battery, Signal, Clock, Radio, Trash2 } from 'lucide-react';
import GaugeCard from './GaugeCard';
import HistoryChart from './HistoryChart';

// CSQ (AT+CSQ 値 0-31) → バーレベル(0-4) + 色
const csqToLevel = (csq) => {
  if (!csq || csq >= 99) return null;
  const level = csq <= 5 ? 0 : csq <= 11 ? 1 : csq <= 17 ? 2 : csq <= 23 ? 3 : 4;
  const color = level >= 3 ? 'text-green-500' : level >= 2 ? 'text-leaf-500' : level >= 1 ? 'text-yellow-500' : 'text-red-500';
  const dBm = -113 + 2 * csq;
  return { level, color, dBm };
};

const SignalBars = ({ csq }) => {
  const sig = csqToLevel(csq);
  if (!sig) return null;
  return (
    <div className={`flex items-end gap-px ${sig.color}`} title={`${sig.dBm}dBm`}>
      {[5, 8, 11, 14].map((h, i) => (
        <div key={i} className={`w-2 rounded-sm ${i < sig.level ? 'bg-current' : 'bg-gray-200'}`}
          style={{ height: `${h}px` }} />
      ))}
      <span className="text-xs sm:text-sm ml-1">LTE {sig.dBm}dBm</span>
    </div>
  );
};

const Dashboard = ({ device, latestData, historyData, alerts, isParent, onDelete }) => {
  const [showConfirm, setShowConfirm] = useState(false);

  const lastUpdate = latestData?.timestamp
    ? format(new Date(latestData.timestamp), 'M月d日 HH:mm', { locale: ja })
    : '--';

  return (
    <div className="space-y-4 sm:space-y-6">
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 mx-4 w-full max-w-sm">
            <p className="text-gray-800 font-medium mb-1">{isParent ? '親機' : '子機'}を削除しますか？</p>
            <p className="text-sm text-gray-500 mb-5">「{device.name}」を削除します。センサーデータも削除されます。</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowConfirm(false)} className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">キャンセル</button>
              <button onClick={() => { setShowConfirm(false); onDelete(device.id); }} className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600">削除する</button>
            </div>
          </div>
        </div>
      )}
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

            {/* バッテリー / 電源 */}
            {device.voltage != null ? (
              isParent ? (
                // 親機: VBUS (ファームウェア更新後に表示)
                device.voltage > 3000 && (
                  <div className="flex items-center gap-1 text-blue-500">
                    <Battery className="w-3 h-3 sm:w-4 sm:h-4" />
                    <span className="text-xs sm:text-sm">USB給電 {(device.voltage / 1000).toFixed(1)}V</span>
                  </div>
                )
              ) : (
                // 子機: VCC電圧 (+ バッテリー%)
                <div className="flex items-center gap-1">
                  <Battery className={`w-3 h-3 sm:w-4 sm:h-4 ${(device.battery ?? 100) > 20 ? 'text-leaf-500' : 'text-red-500'}`} />
                  <span className={`text-xs sm:text-sm ${(device.battery ?? 100) > 20 ? 'text-gray-600' : 'text-red-500'}`}>
                    {(device.voltage / 1000).toFixed(2)}V
                    {device.battery != null && device.battery > 0 && ` (${device.battery}%)`}
                  </span>
                </div>
              )
            ) : device.battery != null && device.battery > 0 ? (
              <div className="flex items-center gap-1">
                <Battery className={`w-3 h-3 sm:w-4 sm:h-4 ${device.battery > 20 ? 'text-leaf-500' : 'text-red-500'}`} />
                <span className={`text-xs sm:text-sm ${device.battery > 20 ? 'text-gray-600' : 'text-red-500'}`}>
                  {device.battery}%
                </span>
              </div>
            ) : null}

            {/* 電波強度 */}
            {isParent ? (
              <SignalBars csq={device.signal} />
            ) : (
              device.rssi != null && (
                <div className="flex items-center gap-1">
                  <Radio className="w-3 h-3 sm:w-4 sm:h-4 text-leaf-500" />
                  <span className="text-xs sm:text-sm text-gray-600">{device.rssi} dBm</span>
                </div>
              )
            )}

            {/* 最終更新 */}
            <div className="flex items-center gap-1 text-gray-400">
              <Clock className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="text-xs sm:text-sm">{lastUpdate}</span>
            </div>

            {/* 削除ボタン（子機のみ） */}
            {!isParent && onDelete && (
              <button
                onClick={() => setShowConfirm(true)}
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
            min={-20}
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
