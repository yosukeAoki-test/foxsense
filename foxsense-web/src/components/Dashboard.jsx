import { useState } from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { MapPin, Battery, Signal, Clock, Radio, Trash2, Wind, Thermometer, Send, Pencil, Check, X, PowerOff } from 'lucide-react';
import GaugeCard from './GaugeCard';
import HistoryChart from './HistoryChart';
import { updateParentDevice, updateChildDevice } from '../api/client';

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

const AC_MODES = [
  { value: 'COOL', label: '冷房' },
  { value: 'HEAT', label: '暖房' },
  { value: 'DRY',  label: '除湿' },
  { value: 'FAN',  label: '送風' },
];

const AcPanel = ({ deviceId }) => {
  const [mode, setMode] = useState('COOL');
  const [temp, setTemp] = useState(26);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const sendCommand = async (m, t) => {
    setSending(true);
    setResult(null);
    try {
      const token = localStorage.getItem('foxsense_access_token');
      const res = await fetch(`/api/devices/parents/${deviceId}/ac`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mode: m, tempC: (m === 'FAN' || m === 'OFF') ? 25 : t }),
      });
      const data = await res.json();
      setResult(data.success ? '送信しました' : data.message);
    } catch {
      setResult('エラーが発生しました');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="card p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-4">
        <Wind className="w-4 h-4 text-blue-500" />
        <h3 className="text-sm font-semibold text-gray-700">エアコン操作</h3>
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        {AC_MODES.map(m => (
          <button
            key={m.value}
            onClick={() => setMode(m.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              mode === m.value ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      {mode !== 'FAN' && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1 text-gray-500">
              <Thermometer className="w-3.5 h-3.5" />
              <span className="text-xs">温度</span>
            </div>
            <span className="text-lg font-bold text-blue-600">{temp}°C</span>
          </div>
          <input
            type="range" min={16} max={31} step={0.5}
            value={temp} onChange={e => setTemp(parseFloat(e.target.value))}
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-0.5">
            <span>16°C</span><span>31°C</span>
          </div>
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          onClick={() => sendCommand(mode, temp)}
          disabled={sending}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <Send className="w-3.5 h-3.5" />
          {sending ? '送信中...' : '送信'}
        </button>
        <button
          onClick={() => sendCommand('OFF', 25)}
          disabled={sending}
          className="flex items-center gap-1.5 px-4 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <PowerOff className="w-3.5 h-3.5" />
          停止
        </button>
        {result && <span className="text-xs text-gray-500">{result}</span>}
      </div>
    </div>
  );
};

const Dashboard = ({ device, latestData, historyData, alerts, isParent, onDelete, onUpdate }) => {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setEditName(device.name);
    setEditLocation(device.location || '');
    setIsEditing(true);
  };

  const cancelEdit = () => setIsEditing(false);

  const saveEdit = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      if (isParent) {
        await updateParentDevice(device.id, { name: editName.trim(), location: editLocation.trim() });
      } else {
        await updateChildDevice(device.id, { name: editName.trim(), location: editLocation.trim() });
      }
      setIsEditing(false);
      onUpdate?.({ name: editName.trim(), location: editLocation.trim() });
    } catch {
      alert('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

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
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  placeholder="デバイス名"
                  className="w-full text-base font-bold border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:border-blue-400"
                />
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-3 h-3 text-gray-400 shrink-0" />
                  <input
                    type="text"
                    value={editLocation}
                    onChange={e => setEditLocation(e.target.value)}
                    placeholder="場所（任意）"
                    className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:border-blue-400"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={saveEdit}
                    disabled={saving || !editName.trim()}
                    className="flex items-center gap-1 px-3 py-1 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    <Check className="w-3 h-3" />
                    {saving ? '保存中...' : '保存'}
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="flex items-center gap-1 px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-medium rounded-lg transition-colors"
                  >
                    <X className="w-3 h-3" />
                    キャンセル
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg sm:text-xl font-bold text-gray-800">{device.name}</h2>
                  {isParent ? (
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-600 text-xs rounded-md font-medium">親機</span>
                  ) : (
                    <span className="px-2 py-0.5 bg-leaf-100 text-leaf-600 text-xs rounded-md font-medium">子機</span>
                  )}
                  <button
                    onClick={startEdit}
                    className="p-1 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                    title="編集"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-1 text-gray-500">
                  <MapPin className="w-3 h-3 sm:w-4 sm:h-4" />
                  <span className="text-xs sm:text-sm">{device.location || '場所未設定'}</span>
                </div>
                {!isParent && device.id && (
                  <div className="mt-1 text-xs text-gray-400 font-mono">ID: {device.id}</div>
                )}
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

      {/* ACコントロール */}
      {isParent && device.acEnabled && <AcPanel deviceId={device.id} />}

      {/* 履歴チャート */}
      <HistoryChart data={historyData} alerts={alerts} deviceName={device.name} />
    </div>
  );
};

export default Dashboard;
