import { useState, useEffect } from 'react';
import { soracomApi } from '../api/client';
import {
  Wifi,
  WifiOff,
  Signal,
  Loader2,
  AlertCircle,
  Play,
  Pause,
  XCircle,
  BarChart3,
  RefreshCw,
  Radio,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

const STATUS_CONFIG = {
  active: { label: '有効', color: 'green', icon: Wifi },
  ready: { label: '準備完了', color: 'blue', icon: Signal },
  inactive: { label: '無効', color: 'gray', icon: WifiOff },
  suspended: { label: '一時停止', color: 'yellow', icon: Pause },
  terminated: { label: '解約済み', color: 'red', icon: XCircle },
};

const SimCard = ({ sim }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const [currentStatus, setCurrentStatus] = useState(sim.status);
  const [showUsage, setShowUsage] = useState(false);
  const [usage, setUsage] = useState(null);
  const [showTerminateConfirm, setShowTerminateConfirm] = useState(false);

  const statusConfig = STATUS_CONFIG[currentStatus?.toLowerCase()] || STATUS_CONFIG.inactive;
  const StatusIcon = statusConfig.icon;

  const handleAction = async (action) => {
    setIsProcessing(true);
    setError('');
    try {
      if (action === 'activate') {
        await soracomApi.activateSim(sim.simId);
        setCurrentStatus('active');
      } else if (action === 'suspend') {
        await soracomApi.suspendSim(sim.simId);
        setCurrentStatus('suspended');
      } else if (action === 'terminate') {
        await soracomApi.terminateSim(sim.simId);
        setCurrentStatus('terminated');
      }
    } catch {
      const labels = { activate: '有効化', suspend: '一時停止', terminate: '解約' };
      setError(`${labels[action]}に失敗しました`);
    } finally {
      setIsProcessing(false);
      setShowTerminateConfirm(false);
    }
  };

  const fetchUsage = async () => {
    if (showUsage) { setShowUsage(false); return; }
    setShowUsage(true);
    try {
      const data = await soracomApi.getSimUsage(sim.simId);
      setUsage(data);
    } catch {
      setError('通信量の取得に失敗しました');
    }
  };

  return (
    <div className="border rounded-xl p-4 space-y-3">
      {/* 親機名 + ステータス */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <span className="font-semibold text-gray-800">{sim.deviceName || '親機'}</span>
          {sim.testMode && (
            <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">テスト</span>
          )}
        </div>
        <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium bg-${statusConfig.color}-100 text-${statusConfig.color}-800`}>
          <StatusIcon className="w-3.5 h-3.5" />
          {statusConfig.label}
        </div>
      </div>

      {/* SIM情報 */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div>
          <span className="text-gray-400">SIM ID</span>
          <p className="font-mono text-gray-700 truncate">{sim.simId}</p>
        </div>
        {sim.imsi && (
          <div>
            <span className="text-gray-400">IMSI</span>
            <p className="font-mono text-gray-700">{sim.imsi}</p>
          </div>
        )}
        {sim.ipAddress && (
          <div>
            <span className="text-gray-400">IP</span>
            <p className="font-mono text-gray-700">{sim.ipAddress}</p>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 p-2 rounded-lg">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* 操作ボタン */}
      <div className="flex flex-wrap gap-2">
        {currentStatus?.toLowerCase() !== 'active' && currentStatus?.toLowerCase() !== 'terminated' && (
          <button
            onClick={() => handleAction('activate')}
            disabled={isProcessing}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg disabled:opacity-50"
          >
            {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            有効化
          </button>
        )}
        {currentStatus?.toLowerCase() === 'active' && (
          <button
            onClick={() => handleAction('suspend')}
            disabled={isProcessing}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white text-xs font-medium rounded-lg disabled:opacity-50"
          >
            {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pause className="w-3.5 h-3.5" />}
            一時停止
          </button>
        )}
        {currentStatus?.toLowerCase() !== 'terminated' && (
          <button
            onClick={() => setShowTerminateConfirm(true)}
            disabled={isProcessing}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg disabled:opacity-50"
          >
            <XCircle className="w-3.5 h-3.5" />
            解約
          </button>
        )}
        <button
          onClick={fetchUsage}
          disabled={isProcessing}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-lg disabled:opacity-50"
        >
          <BarChart3 className="w-3.5 h-3.5" />
          通信量
          {showUsage ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {/* 通信量 */}
      {showUsage && usage && (
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs font-medium text-gray-600 mb-2">通信量（直近7日間）</p>
          <div className="space-y-1">
            {usage.dataUsage && usage.dataUsage.length > 0 ? (
              usage.dataUsage.slice(-7).map((day, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">{new Date(day.date).toLocaleDateString('ja-JP')}</span>
                  <span className="font-mono text-gray-700">
                    {((day.uploadByteSizeTotal + day.downloadByteSizeTotal) / 1024).toFixed(1)} KB
                  </span>
                </div>
              ))
            ) : (
              <p className="text-xs text-gray-400">データがありません</p>
            )}
          </div>
        </div>
      )}

      {/* 解約確認ダイアログ */}
      {showTerminateConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <XCircle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900">SIMを解約しますか？</h3>
                <p className="text-sm text-gray-500">{sim.deviceName}</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-1">この操作は<span className="font-semibold text-red-600">取り消せません。</span></p>
            <p className="text-sm text-gray-500 mb-6">解約後はSIMによる通信ができなくなります。</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowTerminateConfirm(false)}
                disabled={isProcessing}
                className="flex-1 px-4 py-2.5 border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium rounded-xl transition-colors disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                onClick={() => handleAction('terminate')}
                disabled={isProcessing}
                className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isProcessing && <Loader2 className="w-4 h-4 animate-spin" />}
                本当に解約する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SimManagement = () => {
  const [sims, setSims] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchSims = async () => {
    setIsLoading(true);
    setError('');
    try {
      const data = await soracomApi.getSims();
      setSims(data);
    } catch {
      setError('SIM情報の取得に失敗しました');
      setSims([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSims();
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-green-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {sims?.length ? `${sims.length}台の親機のSIM` : 'SIMが登録されていません'}
        </p>
        <button
          onClick={fetchSims}
          className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {sims?.length === 0 && !error && (
        <div className="bg-gray-50 rounded-xl p-6 text-center">
          <WifiOff className="w-8 h-8 text-gray-400 mx-auto mb-2" />
          <p className="text-gray-600 text-sm">SIMが登録された親機がありません</p>
        </div>
      )}

      {sims?.map(sim => (
        <SimCard key={sim.simId} sim={sim} />
      ))}
    </div>
  );
};

export default SimManagement;
