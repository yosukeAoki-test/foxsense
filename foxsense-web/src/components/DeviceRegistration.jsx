import { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  X, QrCode, Keyboard, Camera, Check, AlertCircle, Trash2,
  Radio, Cpu, Loader2, ChevronLeft, Clock, Plus,
} from 'lucide-react';
import {
  registerChildDevice, deleteChildDevice,
  createParentDevice, getParentDevices, deleteParentDevice,
  assignChildToParent,
} from '../api/client';

// ===== QRスキャンフック =====
const useQrScanner = (onResult) => {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const qrRef = useRef(null);

  const stop = useCallback(async () => {
    if (qrRef.current) {
      try { await qrRef.current.stop(); } catch {}
      qrRef.current = null;
    }
    setScanning(false);
  }, []);

  useEffect(() => () => { stop(); }, [stop]);

  const start = useCallback(async (elementId) => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(t => t.stop());
    } catch {
      setError('カメラへのアクセスを許可してください');
      return;
    }
    await new Promise(r => setTimeout(r, 100));
    try {
      const qr = new Html5Qrcode(elementId);
      qrRef.current = qr;
      await qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (text) => {
          let id = text.trim();
          if (id.toUpperCase().startsWith('TWELITE:')) id = id.substring(8);
          else if (id.toLowerCase().startsWith('0x')) id = id.substring(2);
          id = id.replace(/\s/g, '').toUpperCase();
          if (/^[0-9A-F]{8}$/.test(id)) {
            onResult(id);
            stop();
          } else {
            setError(`無効なQRコード: ${text}`);
          }
        },
        () => {}
      );
      setScanning(true);
    } catch {
      setError('カメラの起動に失敗しました');
    }
  }, [onResult, stop]);

  return { scanning, error, setError, start, stop };
};

// ===== ペアリング状態バッジ =====
const PairingBadge = ({ status }) => {
  if (status === 'PAIRED') return (
    <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
      接続済み
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-xs text-yellow-600">
      <Clock className="w-3 h-3 flex-shrink-0 animate-pulse" />
      設定中…
    </span>
  );
};

// ===== 親機追加ビュー =====
const AddParentView = ({ onBack, onSuccess }) => {
  const [name, setName] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!name.trim() || !deviceId.trim()) {
      setError('デバイスIDと名前は必須です');
      return;
    }
    setLoading(true);
    try {
      await createParentDevice({ deviceId: deviceId.trim(), name: name.trim(), location: location.trim() });
      onSuccess();
    } catch (e) {
      setError(e.response?.data?.message || '登録に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ChevronLeft className="w-4 h-4" />戻る
      </button>
      <h3 className="font-semibold text-gray-900 mb-1">親機を追加</h3>
      <p className="text-xs text-gray-400 mb-4">デバイス本体に貼付されたIDを入力してください</p>

      {error && (
        <div className="flex items-center gap-2 p-2.5 bg-red-50 rounded-xl text-red-600 text-sm mb-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
        </div>
      )}
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            デバイスID <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={deviceId}
            onChange={e => setDeviceId(e.target.value)}
            placeholder="例: foxsense-001"
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none font-mono text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            名前 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="例: スイカハウス 親機"
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">設置場所（任意）</label>
          <input
            type="text"
            value={location}
            onChange={e => setLocation(e.target.value)}
            placeholder="例: ハウス入口"
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-gray-300 outline-none text-sm"
          />
        </div>
        <button
          onClick={handleSubmit}
          disabled={!name.trim() || !deviceId.trim() || loading}
          className="w-full py-3 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radio className="w-4 h-4" />}
          登録する
        </button>
      </div>
    </div>
  );
};

// ===== 子機追加ビュー =====
const AddChildView = ({ parent, onBack, onDone }) => {
  const [inputMode, setInputMode] = useState('select'); // 'select' | 'qr' | 'form'
  const [scannedId, setScannedId] = useState('');
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState([]);

  const { scanning, error: qrError, setError: setQrError, start: startQr, stop: stopQr } = useQrScanner(
    (id) => {
      setScannedId(id);
      setInputMode('form');
    }
  );

  const handleStartQr = async () => {
    setError('');
    setQrError('');
    setScannedId('');
    setName('');
    setLocation('');
    setInputMode('qr');
    await startQr('qr-reader');
  };

  const handleAdd = async () => {
    if (scannedId.length !== 8) { setError('8桁のデバイスIDを入力してください'); return; }
    if (!name.trim()) { setError('センサー名を入力してください'); return; }
    setLoading(true);
    setError('');
    try {
      const child = await registerChildDevice({ deviceId: scannedId, name: name.trim(), location: location.trim() });
      await assignChildToParent(parent.id, child.id);
      setAdded(prev => [...prev, { name: name.trim(), deviceId: scannedId }]);
      setScannedId('');
      setName('');
      setLocation('');
      setInputMode('select');
    } catch (e) {
      setError(e.response?.data?.message || '登録に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    stopQr();
    onBack();
  };

  const handleDone = () => {
    stopQr();
    onDone();
  };

  const displayError = error || qrError;

  return (
    <div>
      <button onClick={handleBack} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <ChevronLeft className="w-4 h-4" />戻る
      </button>

      <div className="flex items-center gap-2 mb-4">
        <Radio className="w-4 h-4 text-blue-500 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-xs text-gray-500">子機を追加中</p>
          <p className="font-semibold text-gray-900 text-sm truncate">{parent.name}</p>
        </div>
      </div>

      {/* 追加済みリスト */}
      {added.length > 0 && (
        <div className="mb-4 p-3 bg-green-50 rounded-xl border border-green-100">
          <p className="text-xs font-semibold text-green-700 mb-2">追加済み {added.length}台</p>
          <div className="space-y-1.5">
            {added.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-green-700">
                <Check className="w-3.5 h-3.5 flex-shrink-0 text-green-500" />
                <span className="font-medium">{c.name}</span>
                <span className="text-green-400 font-mono ml-auto">{c.deviceId}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {displayError && (
        <div className="flex items-center gap-2 p-2.5 bg-red-50 rounded-xl text-red-600 text-sm mb-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />{displayError}
        </div>
      )}

      {/* モード選択 */}
      {inputMode === 'select' && (
        <div className="space-y-2">
          <button
            onClick={handleStartQr}
            className="w-full flex items-center gap-3 p-3.5 rounded-xl border-2 border-green-200 hover:border-green-400 hover:bg-green-50 transition-all"
          >
            <QrCode className="w-5 h-5 text-green-600" />
            <div className="text-left">
              <p className="font-medium text-gray-700 text-sm">QRコードをスキャン</p>
              <p className="text-xs text-gray-400">センサー本体のQRコードを読み取る</p>
            </div>
          </button>
          <button
            onClick={() => { setInputMode('form'); setScannedId(''); }}
            className="w-full flex items-center gap-3 p-3.5 rounded-xl border-2 border-gray-200 hover:border-gray-400 hover:bg-gray-50 transition-all"
          >
            <Keyboard className="w-5 h-5 text-gray-500" />
            <div className="text-left">
              <p className="font-medium text-gray-700 text-sm">IDを手動で入力</p>
              <p className="text-xs text-gray-400">8桁の16進数IDを直接入力する</p>
            </div>
          </button>
          {added.length > 0 && (
            <button
              onClick={handleDone}
              className="w-full py-3 rounded-xl bg-gray-900 text-white font-medium hover:bg-gray-700 transition-colors text-sm mt-2"
            >
              完了（{added.length}台追加）
            </button>
          )}
        </div>
      )}

      {/* QRスキャン中 */}
      {inputMode === 'qr' && (
        <div>
          <div id="qr-reader" className="w-full rounded-xl overflow-hidden bg-black" />
          {scanning && (
            <p className="text-center text-xs text-gray-500 mt-2 flex items-center justify-center gap-1.5">
              <Camera className="w-3.5 h-3.5 animate-pulse" />センサーのQRコードをカメラに向けてください
            </p>
          )}
          <button
            onClick={() => { stopQr(); setInputMode('select'); }}
            className="w-full mt-3 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm hover:bg-gray-50"
          >
            キャンセル
          </button>
        </div>
      )}

      {/* 入力フォーム */}
      {inputMode === 'form' && (
        <div className="space-y-3">
          {scannedId && (
            <div className="flex items-center gap-2 p-2.5 bg-green-50 rounded-xl text-green-700 text-sm">
              <Check className="w-4 h-4" />QRコードを読み取りました
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">デバイスID</label>
            <input
              type="text"
              value={scannedId}
              onChange={e => setScannedId(e.target.value.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 8))}
              placeholder="例: 1A2B3C4D"
              readOnly={!!scannedId && inputMode !== 'form'}
              className={`w-full px-3 py-2.5 rounded-xl border font-mono text-sm outline-none transition-colors ${
                scannedId.length === 8
                  ? 'border-green-300 bg-green-50 text-green-800'
                  : 'border-gray-200 focus:border-green-400 focus:ring-2 focus:ring-green-100'
              }`}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              センサー名 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例: 北側センサー"
              autoFocus
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-green-400 focus:ring-2 focus:ring-green-100 outline-none text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">設置場所（任意）</label>
            <input
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="例: 入口から5m"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 outline-none text-sm"
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={scannedId.length !== 8 || !name.trim() || loading}
            className="w-full py-3 rounded-xl bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            追加する
          </button>
          <button
            onClick={() => { setScannedId(''); setName(''); setLocation(''); setInputMode('select'); }}
            className="w-full py-2 text-sm text-gray-400 hover:text-gray-600"
          >
            ← 戻る
          </button>
        </div>
      )}
    </div>
  );
};

// ===== デバイス一覧ビュー =====
const ListView = ({ parents, loading, error, onAddParent, onAddChild, onDeleteParent, onDeleteChild }) => {
  if (loading) return (
    <div className="flex justify-center py-12">
      <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
    </div>
  );

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 p-2.5 bg-red-50 rounded-xl text-red-600 text-sm">
          <AlertCircle className="w-4 h-4" />{error}
        </div>
      )}

      {parents.length === 0 ? (
        <div className="text-center py-12">
          <Radio className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium mb-1">デバイスがありません</p>
          <p className="text-xs text-gray-400 mb-5">まず親機（通信ユニット）を登録してください</p>
          <button
            onClick={onAddParent}
            className="px-6 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            親機を追加する
          </button>
        </div>
      ) : (
        <>
          {parents.map(parent => (
            <div key={parent.id} className="border border-gray-200 rounded-xl overflow-hidden">
              {/* 親機ヘッダー */}
              <div className="flex items-center justify-between px-4 py-3 bg-blue-50 border-b border-blue-100">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <Radio className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 text-sm">{parent.name}</div>
                    <div className="text-xs text-gray-400 font-mono">{parent.deviceId}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => onAddChild(parent)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />子機を追加
                  </button>
                  <button
                    onClick={() => onDeleteParent(parent.id, parent.name)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* 子機リスト */}
              {parent.activeChildren.length > 0 ? (
                <div className="divide-y divide-gray-100">
                  {parent.activeChildren.map(child => (
                    <div key={child.id} className="flex items-center justify-between px-4 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <Cpu className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-gray-800">{child.name}</div>
                          {child.location && (
                            <div className="text-xs text-gray-400">{child.location}</div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <PairingBadge status={child.pairingStatus} />
                        <button
                          onClick={() => onDeleteChild(child.id, child.name)}
                          className="p-1 rounded text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-3">
                  <button
                    onClick={() => onAddChild(parent)}
                    className="text-xs text-blue-500 hover:text-blue-700"
                  >
                    ＋ 子機を追加する
                  </button>
                </div>
              )}
            </div>
          ))}

          <button
            onClick={onAddParent}
            className="w-full py-3 rounded-xl border-2 border-dashed border-gray-200 text-gray-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-all text-sm font-medium flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />親機を追加する
          </button>
        </>
      )}
    </div>
  );
};

// ===== メインモーダル =====
const DeviceRegistration = ({ onClose, onRefresh }) => {
  const [view, setView] = useState('list');
  const [parents, setParents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [targetParent, setTargetParent] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const p = await getParentDevices();
      setParents(p);
    } catch {
      setError('データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDeleteParent = async (id, name) => {
    if (!window.confirm(`「${name}」を削除しますか？\n子機との接続もすべて解除されます。`)) return;
    try {
      await deleteParentDevice(id);
      load();
      onRefresh();
    } catch (e) {
      setError(e.response?.data?.message || '削除に失敗しました');
    }
  };

  const handleDeleteChild = async (childId, name) => {
    if (!window.confirm(`「${name}」を削除しますか？`)) return;
    try {
      await deleteChildDevice(childId);
      load();
      onRefresh();
    } catch (e) {
      setError(e.response?.data?.message || '削除に失敗しました');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-bold text-gray-800">デバイス管理</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {view === 'list' && (
            <ListView
              parents={parents}
              loading={loading}
              error={error}
              onAddParent={() => setView('addParent')}
              onAddChild={(parent) => { setTargetParent(parent); setView('addChild'); }}
              onDeleteParent={handleDeleteParent}
              onDeleteChild={handleDeleteChild}
            />
          )}

          {view === 'addParent' && (
            <AddParentView
              onBack={() => setView('list')}
              onSuccess={() => { load(); onRefresh(); setView('list'); }}
            />
          )}

          {view === 'addChild' && targetParent && (
            <AddChildView
              parent={targetParent}
              onBack={() => { load(); setView('list'); }}
              onDone={() => { load(); onRefresh(); setView('list'); }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default DeviceRegistration;
