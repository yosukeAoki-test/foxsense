import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { paymentsApi } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import {
  CreditCard,
  Calendar,
  AlertCircle,
  Loader2,
  ExternalLink,
  ArrowLeft,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';

const PLAN_NAMES = {
  MONTHLY: '1ヶ月',
  QUARTERLY: '3ヶ月',
  BIANNUAL: '6ヶ月',
  YEARLY: '1年',
  TWO_YEAR: '2年',
  THREE_YEAR: '3年',
};

const STATUS_DISPLAY = {
  ACTIVE: { label: 'アクティブ', color: 'green', icon: CheckCircle },
  CANCELED: { label: 'キャンセル済み', color: 'red', icon: XCircle },
  PAST_DUE: { label: '支払い遅延', color: 'yellow', icon: AlertCircle },
  TRIALING: { label: 'トライアル中', color: 'blue', icon: Calendar },
};

const SubscriptionManagement = () => {
  const [subscription, setSubscription] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    fetchSubscription();
  }, []);

  const fetchSubscription = async () => {
    try {
      const data = await paymentsApi.getSubscription();
      setSubscription(data);
    } catch (err) {
      if (err.response?.status !== 404) {
        setError('サブスクリプション情報の取得に失敗しました');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!window.confirm('サブスクリプションをキャンセルしますか？\n期間終了まではサービスをご利用いただけます。')) {
      return;
    }

    setIsProcessing(true);
    setError('');

    try {
      await paymentsApi.cancelSubscription();
      await fetchSubscription();
    } catch (err) {
      setError(err.response?.data?.message || 'キャンセルに失敗しました');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleOpenPortal = async () => {
    setIsProcessing(true);
    setError('');

    try {
      const result = await paymentsApi.createPortal();
      if (result.url) {
        window.location.href = result.url;
      }
    } catch (err) {
      setError(err.response?.data?.message || 'ポータルを開けませんでした');
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-green-600" />
      </div>
    );
  }

  const StatusIcon = subscription ? STATUS_DISPLAY[subscription.status]?.icon : null;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-5 h-5" />
          戻る
        </button>

        <h1 className="text-2xl font-bold text-gray-900 mb-6">サブスクリプション管理</h1>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            {error}
          </div>
        )}

        {subscription ? (
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="p-6 border-b">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">現在のプラン</h2>
                {StatusIcon && (
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-${STATUS_DISPLAY[subscription.status].color}-100 text-${STATUS_DISPLAY[subscription.status].color}-800`}
                  >
                    <StatusIcon className="w-4 h-4" />
                    {STATUS_DISPLAY[subscription.status].label}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">プラン</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {PLAN_NAMES[subscription.plan] || subscription.plan}プラン
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">次回更新日</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {format(new Date(subscription.currentPeriodEnd), 'yyyy年M月d日', { locale: ja })}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 bg-gray-50">
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={handleOpenPortal}
                  disabled={isProcessing}
                  className="flex-1 inline-flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 text-white font-medium py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50"
                >
                  <ExternalLink className="w-5 h-5" />
                  支払い方法を管理
                </button>

                {subscription.status === 'ACTIVE' && (
                  <button
                    onClick={handleCancel}
                    disabled={isProcessing}
                    className="flex-1 inline-flex items-center justify-center gap-2 bg-white border border-red-300 text-red-600 hover:bg-red-50 font-medium py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {isProcessing ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <XCircle className="w-5 h-5" />
                    )}
                    解約する
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center">
            <CreditCard className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              サブスクリプションがありません
            </h2>
            <p className="text-gray-600 mb-6">
              FoxSenseのすべての機能を利用するには、プランに登録してください。
            </p>
            <button
              onClick={() => navigate('/pricing')}
              className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-medium py-2.5 px-6 rounded-lg transition-colors"
            >
              <CreditCard className="w-5 h-5" />
              プランを選択
            </button>
          </div>
        )}

        <div className="mt-8 bg-white rounded-xl shadow-sm border p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">アカウント情報</h2>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-500">メールアドレス</span>
              <span className="text-gray-900">{user?.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">お名前</span>
              <span className="text-gray-900">{user?.name}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubscriptionManagement;
