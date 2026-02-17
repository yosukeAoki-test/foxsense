import { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, QrCode, Keyboard, Camera, Check, AlertCircle, Trash2, Plus } from 'lucide-react';

const DeviceRegistration = ({ parentId, registeredDevices, onClose, onRegister, onDelete }) => {
  const [mode, setMode] = useState('select'); // select, qr, manual
  const [deviceId, setDeviceId] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [location, setLocation] = useState('');
  const [scanResult, setScanResult] = useState(null);
  const [error, setError] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const scannerRef = useRef(null);
  const html5QrCodeRef = useRef(null);

  // QRスキャナーのクリーンアップ
  useEffect(() => {
    return () => {
      if (html5QrCodeRef.current) {
        html5QrCodeRef.current.stop().catch(() => {});
      }
    };
  }, []);

  // カメラ権限を確認
  const checkCameraPermission = async () => {
    try {
      // 権限状態を確認
      if (navigator.permissions) {
        const result = await navigator.permissions.query({ name: 'camera' });
        return result.state; // 'granted', 'denied', 'prompt'
      }
      return 'prompt';
    } catch {
      return 'prompt';
    }
  };

  // カメラアクセスを要求
  const requestCameraAccess = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      // アクセス成功したらストリームを停止
      stream.getTracks().forEach(track => track.stop());
      return true;
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setError('カメラへのアクセスが拒否されました。ブラウザの設定からカメラの許可を有効にしてください。');
      } else if (err.name === 'NotFoundError') {
        setError('カメラが見つかりません。カメラが接続されているか確認してください。');
      } else {
        setError('カメラにアクセスできません: ' + err.message);
      }
      return false;
    }
  };

  // QRスキャン開始
  const startQrScan = async () => {
    setError('');
    setScanResult(null);

    // まずカメラ権限を確認
    const permissionState = await checkCameraPermission();

    if (permissionState === 'denied') {
      setError('カメラへのアクセスがブロックされています。ブラウザの設定（アドレスバー左のアイコン）からカメラを許可してください。');
      return;
    }

    // カメラアクセスを要求
    const hasAccess = await requestCameraAccess();
    if (!hasAccess) {
      return;
    }

    // 先にモードを変更してDOMを描画
    setMode('qr');
  };

  // QRモードになったらスキャナーを起動
  useEffect(() => {
    if (mode !== 'qr' || scanResult) return;

    // DOMが描画されるまで少し待つ
    const timer = setTimeout(async () => {
      const element = document.getElementById('qr-reader');
      if (!element) {
        setError('QRスキャナーの初期化に失敗しました。ページを再読み込みしてください。');
        setMode('select');
        return;
      }

      try {
        const html5QrCode = new Html5Qrcode('qr-reader');
        html5QrCodeRef.current = html5QrCode;

        await html5QrCode.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
          },
          (decodedText) => {
            // QRコード読み取り成功
            handleQrResult(decodedText);
            html5QrCode.stop().catch(() => {});
            setIsScanning(false);
          },
          () => {} // エラーは無視（スキャン中は常に呼ばれる）
        );
        setIsScanning(true);
      } catch (err) {
        console.error('QR Scanner error:', err);
        setError('QRスキャナーの起動に失敗しました。カメラが他のアプリで使用されていないか確認してください。');
        setMode('select');
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [mode, scanResult]);

  // QR結果処理
  const handleQrResult = (result) => {
    // QRコードフォーマット:
    // 1. 8桁の16進数のみ: 1A2B3C4D
    // 2. TWELITE:プレフィックス付き: TWELITE:1A2B3C4D
    // 3. 0xプレフィックス付き: 0x1A2B3C4D
    let parsedId = result.trim();

    // プレフィックスを除去
    if (parsedId.toUpperCase().startsWith('TWELITE:')) {
      parsedId = parsedId.substring(8);
    } else if (parsedId.toLowerCase().startsWith('0x')) {
      parsedId = parsedId.substring(2);
    }

    // 空白を除去
    parsedId = parsedId.replace(/\s/g, '');

    // 16進数チェック（8桁）
    if (/^[0-9A-Fa-f]{8}$/.test(parsedId)) {
      setScanResult({
        deviceId: parsedId.toUpperCase(),
        raw: result,
      });
      setDeviceId(parsedId.toUpperCase());
      setMode('qr'); // 入力フォームを表示
    } else {
      setError(`無効なQRコード形式です。8桁の16進数が必要です。\n読み取り値: ${result}`);
    }
  };

  // スキャン停止
  const stopQrScan = () => {
    if (html5QrCodeRef.current) {
      html5QrCodeRef.current.stop().catch(() => {});
    }
    setIsScanning(false);
    setMode('select');
  };

  // 手動入力に切り替え
  const switchToManual = () => {
    if (html5QrCodeRef.current) {
      html5QrCodeRef.current.stop().catch(() => {});
    }
    setIsScanning(false);
    setMode('manual');
    setError('');
  };

  // デバイス登録
  const handleRegister = () => {
    if (!deviceId || deviceId.length !== 8) {
      setError('デバイスIDは8桁の16進数で入力してください');
      return;
    }

    if (!deviceName.trim()) {
      setError('デバイス名を入力してください');
      return;
    }

    // 重複チェック
    if (registeredDevices.some(d => d.deviceId.toUpperCase() === deviceId.toUpperCase())) {
      setError('このデバイスは既に登録されています');
      return;
    }

    onRegister({
      deviceId: deviceId.toUpperCase(),
      name: deviceName.trim(),
      location: location.trim(),
      registeredAt: new Date().toISOString(),
    });

    // リセット
    setDeviceId('');
    setDeviceName('');
    setLocation('');
    setScanResult(null);
    setMode('select');
  };

  // 入力フォーム
  const renderInputForm = () => (
    <div className="space-y-4 mt-4">
      {scanResult && (
        <div className="flex items-center gap-2 p-3 bg-leaf-50 rounded-lg text-leaf-700">
          <Check className="w-5 h-5" />
          <span>QRコードを読み取りました</span>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          デバイスID（8桁の16進数）
        </label>
        <input
          type="text"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 8))}
          placeholder="例: 1A2B3C4D"
          className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-leaf-400 focus:ring-2 focus:ring-leaf-100 outline-none transition-all font-mono"
          maxLength={8}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          デバイス名 <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
          placeholder="例: ハウスA 北側センサー"
          className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-leaf-400 focus:ring-2 focus:ring-leaf-100 outline-none transition-all"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          設置場所（任意）
        </label>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="例: 入口から5m、高さ1.5m"
          className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-leaf-400 focus:ring-2 focus:ring-leaf-100 outline-none transition-all"
        />
      </div>

      <button
        onClick={handleRegister}
        disabled={!deviceId || !deviceName}
        className="w-full py-3 rounded-xl bg-gradient-to-r from-leaf-500 to-leaf-600 text-white font-medium hover:from-leaf-600 hover:to-leaf-700 disabled:from-gray-300 disabled:to-gray-400 transition-all shadow-lg shadow-leaf-500/25 disabled:shadow-none"
      >
        子機を登録
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 z-50 overflow-y-auto">
      <div className="card w-full max-w-lg p-4 sm:p-6 fade-in my-2 sm:my-4 max-h-[95vh] overflow-y-auto">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 sm:w-5 sm:h-5 text-leaf-600" />
            <h2 className="text-base sm:text-lg font-bold text-gray-800">子機の登録・管理</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 sm:p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 親機情報 */}
        <div className="bg-gray-50 rounded-lg p-2.5 sm:p-3 mb-3 sm:mb-4 text-xs sm:text-sm">
          <span className="text-gray-500">親機ID: </span>
          <span className="font-mono text-gray-700">{parentId}</span>
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="flex items-center gap-2 p-2.5 sm:p-3 bg-red-50 rounded-lg text-red-600 mb-3 sm:mb-4">
            <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
            <span className="text-xs sm:text-sm">{error}</span>
          </div>
        )}

        {/* モード選択 */}
        {mode === 'select' && (
          <div className="space-y-2 sm:space-y-3">
            <p className="text-xs sm:text-sm text-gray-600 mb-3 sm:mb-4">
              子機のTWELITEモジュールのQRコードをスキャンするか、
              デバイスIDを手動で入力してください。
            </p>
            <div className="bg-gray-50 rounded-lg p-2.5 sm:p-3 mb-3 sm:mb-4 text-xs text-gray-500">
              <div className="font-medium text-gray-600 mb-1">QRコード形式</div>
              <code className="bg-white px-1.5 sm:px-2 py-0.5 rounded text-xs">1A2B3C4D</code>
              <span className="mx-1 sm:mx-2">または</span>
              <code className="bg-white px-1.5 sm:px-2 py-0.5 rounded text-xs">TWELITE:1A2B3C4D</code>
            </div>

            <button
              onClick={startQrScan}
              className="w-full flex flex-col items-center gap-1.5 sm:gap-2 p-3 sm:p-4 rounded-xl border-2 border-leaf-200 hover:border-leaf-400 hover:bg-leaf-50 transition-all"
            >
              <div className="flex items-center gap-2 sm:gap-3">
                <QrCode className="w-5 h-5 sm:w-6 sm:h-6 text-leaf-600" />
                <span className="font-medium text-gray-700 text-sm sm:text-base">QRコードをスキャン</span>
              </div>
              <span className="text-xs text-gray-400">カメラへのアクセス許可が必要です</span>
            </button>

            <button
              onClick={switchToManual}
              className="w-full flex items-center justify-center gap-2 sm:gap-3 p-3 sm:p-4 rounded-xl border-2 border-gray-200 hover:border-gray-400 hover:bg-gray-50 transition-all"
            >
              <Keyboard className="w-5 h-5 sm:w-6 sm:h-6 text-gray-500" />
              <span className="font-medium text-gray-700 text-sm sm:text-base">手動で入力</span>
            </button>
          </div>
        )}

        {/* QRスキャンモード */}
        {mode === 'qr' && (
          <div>
            {!scanResult ? (
              <>
                <div
                  id="qr-reader"
                  ref={scannerRef}
                  className="w-full rounded-xl overflow-hidden bg-black"
                />
                {isScanning && (
                  <div className="flex items-center justify-center gap-2 mt-4 text-sm text-gray-600">
                    <Camera className="w-4 h-4 animate-pulse" />
                    <span>QRコードをカメラに向けてください...</span>
                  </div>
                )}
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={stopQrScan}
                    className="flex-1 py-2 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={switchToManual}
                    className="flex-1 py-2 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    手動入力
                  </button>
                </div>
              </>
            ) : (
              renderInputForm()
            )}
          </div>
        )}

        {/* 手動入力モード */}
        {mode === 'manual' && (
          <div>
            <button
              onClick={() => setMode('select')}
              className="text-sm text-leaf-600 hover:text-leaf-700 mb-4"
            >
              ← 戻る
            </button>
            {renderInputForm()}
          </div>
        )}

        {/* 登録済み子機一覧 */}
        {registeredDevices.length > 0 && mode === 'select' && (
          <div className="mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-gray-100">
            <h3 className="font-medium text-gray-700 mb-2 sm:mb-3 text-sm sm:text-base">登録済み子機 ({registeredDevices.length}台)</h3>
            <div className="space-y-2 max-h-40 sm:max-h-48 overflow-y-auto">
              {registeredDevices.map((device) => (
                <div
                  key={device.deviceId}
                  className="flex items-center justify-between p-2.5 sm:p-3 bg-gray-50 rounded-lg"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-800 text-sm sm:text-base truncate">{device.name}</div>
                    <div className="text-xs text-gray-500 font-mono">ID: {device.deviceId}</div>
                    {device.location && (
                      <div className="text-xs text-gray-400 truncate">{device.location}</div>
                    )}
                  </div>
                  <button
                    onClick={() => onDelete(device.deviceId)}
                    className="p-1.5 sm:p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0 ml-2"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DeviceRegistration;
