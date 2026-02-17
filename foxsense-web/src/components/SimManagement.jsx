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
} from 'lucide-react';

const STATUS_CONFIG = {
  active: {
    label: '有効',
    color: 'green',
    icon: Wifi,
  },
  ready: {
    label: '準備完了',
    color: 'blue',
    icon: Signal,
  },
  inactive: {
    label: '無効',
    color: 'gray',
    icon: WifiOff,
  },
  suspended: {
    label: '一時停止',
    color: 'yellow',
    icon: Pause,
  },
  terminated: {
    label: '解約済み',
    color: 'red',
    icon: XCircle,
  },
};

const SimManagement = ({ deviceId, soracomSimId }) => {
  const [simDetails, setSimDetails] = useState(null);
  const [usage, setUsage] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const [showUsage, setShowUsage] = useState(false);

  useEffect(() => {
    if (soracomSimId) {
      fetchSimDetails();
    } else {
      setIsLoading(false);
    }
  }, [soracomSimId]);

  const fetchSimDetails = async () => {
    setIsLoading(true);
    setError('');
    try {
      const data = await soracomApi.getSimDetails(soracomSimId);
      setSimDetails(data);
    } catch (err) {
      setError('SIM情報の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchUsage = async () => {
    setShowUsage(true);
    try {
      const data = await soracomApi.getSimUsage(soracomSimId);
      setUsage(data);
    } catch (err) {
      setError('通信量の取得に失敗しました');
    }
  };

  const handleAction = async (action) => {
    const actionLabels = {
      activate: '有効化',
      suspend: '一時停止',
      terminate: '解約',
    };

    if (action === 'terminate') {
      if (!window.confirm('本当にSIMを解約しますか？この操作は取り消せません。')) {
        return;
      }
    }

    setIsProcessing(true);
    setError('');

    try {
      if (action === 'activate') {
        await soracomApi.activateSim(soracomSimId);
      } else if (action === 'suspend') {
        await soracomApi.suspendSim(soracomSimId);
      } else if (action === 'terminate') {
        await soracomApi.terminateSim(soracomSimId);
      }
      await fetchSimDetails();
    } catch (err) {
      setError(`${actionLabels[action]}に失敗しました`);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!soracomSimId) {
    return (
      <div className="bg-gray-50 rounded-lg p-6 text-center">
        <WifiOff className="w-8 h-8 text-gray-400 mx-auto mb-2" />
        <p className="text-gray-600">この親機にはSIMが登録されていません</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-green-600" />
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[simDetails?.status?.toLowerCase()] || STATUS_CONFIG.inactive;
  const StatusIcon = statusConfig.icon;

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg border p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">SIM情報</h3>
          <button
            onClick={fetchSimDetails}
            disabled={isProcessing}
            className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
          >
            <RefreshCw className={`w-4 h-4 ${isProcessing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-xs text-gray-500 mb-1">ステータス</p>
            <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-sm font-medium bg-${statusConfig.color}-100 text-${statusConfig.color}-800`}>
              <StatusIcon className="w-4 h-4" />
              {statusConfig.label}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">SIM ID</p>
            <p className="text-sm font-mono text-gray-900">{soracomSimId}</p>
          </div>
          {simDetails?.imsi && (
            <div>
              <p className="text-xs text-gray-500 mb-1">IMSI</p>
              <p className="text-sm font-mono text-gray-900">{simDetails.imsi}</p>
            </div>
          )}
          {simDetails?.ipAddress && (
            <div>
              <p className="text-xs text-gray-500 mb-1">IPアドレス</p>
              <p className="text-sm font-mono text-gray-900">{simDetails.ipAddress}</p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {simDetails?.status?.toLowerCase() !== 'active' && simDetails?.status?.toLowerCase() !== 'terminated' && (
            <button
              onClick={() => handleAction('activate')}
              disabled={isProcessing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              有効化
            </button>
          )}

          {simDetails?.status?.toLowerCase() === 'active' && (
            <button
              onClick={() => handleAction('suspend')}
              disabled={isProcessing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-medium rounded-lg disabled:opacity-50"
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4" />}
              一時停止
            </button>
          )}

          {simDetails?.status?.toLowerCase() !== 'terminated' && (
            <button
              onClick={() => handleAction('terminate')}
              disabled={isProcessing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
              解約
            </button>
          )}

          <button
            onClick={fetchUsage}
            disabled={isProcessing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg disabled:opacity-50"
          >
            <BarChart3 className="w-4 h-4" />
            通信量を確認
          </button>
        </div>
      </div>

      {showUsage && usage && (
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-gray-900 mb-3">通信量（過去30日間）</h3>
          <div className="space-y-2">
            {usage.dataUsage && usage.dataUsage.length > 0 ? (
              usage.dataUsage.slice(-7).map((day, index) => (
                <div key={index} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">
                    {new Date(day.date).toLocaleDateString('ja-JP')}
                  </span>
                  <span className="font-mono text-gray-900">
                    {((day.uploadByteSizeTotal + day.downloadByteSizeTotal) / 1024).toFixed(2)} KB
                  </span>
                </div>
              ))
            ) : (
              <p className="text-gray-500 text-sm">データがありません</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SimManagement;
