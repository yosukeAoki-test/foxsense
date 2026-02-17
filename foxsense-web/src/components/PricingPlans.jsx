import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { paymentsApi } from '../api/client';
import { Check, Loader2, CreditCard, ArrowLeft } from 'lucide-react';

const PLANS = [
  {
    id: 'MONTHLY',
    name: '1ヶ月',
    monthlyPrice: 1980,
    totalPrice: 1980,
    period: 1,
    discount: 0,
  },
  {
    id: 'QUARTERLY',
    name: '3ヶ月',
    monthlyPrice: 1780,
    totalPrice: 5340,
    period: 3,
    discount: 10,
  },
  {
    id: 'BIANNUAL',
    name: '6ヶ月',
    monthlyPrice: 1580,
    totalPrice: 9480,
    period: 6,
    discount: 20,
  },
  {
    id: 'YEARLY',
    name: '1年',
    monthlyPrice: 1480,
    totalPrice: 17760,
    period: 12,
    discount: 25,
    popular: true,
  },
  {
    id: 'TWO_YEAR',
    name: '2年',
    monthlyPrice: 1280,
    totalPrice: 30720,
    period: 24,
    discount: 35,
  },
  {
    id: 'THREE_YEAR',
    name: '3年',
    monthlyPrice: 980,
    totalPrice: 35280,
    period: 36,
    discount: 50,
    bestValue: true,
  },
];

const PricingPlans = () => {
  const [selectedPlan, setSelectedPlan] = useState('YEARLY');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const handleSubscribe = async () => {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: '/pricing' } });
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const result = await paymentsApi.createCheckout(selectedPlan);
      if (result.url) {
        window.location.href = result.url;
      }
    } catch (err) {
      setError(err.response?.data?.message || '決済処理に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 py-12 px-4">
      <div className="max-w-6xl mx-auto">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-5 h-5" />
          戻る
        </button>

        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">料金プラン</h1>
          <p className="text-gray-600 max-w-2xl mx-auto">
            長期契約でお得に利用できます。すべてのプランに親機1台・子機3台の接続が含まれています。
          </p>
        </div>

        {error && (
          <div className="max-w-md mx-auto mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-center">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              onClick={() => setSelectedPlan(plan.id)}
              className={`relative bg-white rounded-xl border-2 p-6 cursor-pointer transition-all ${
                selectedPlan === plan.id
                  ? 'border-green-500 shadow-lg ring-2 ring-green-200'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-green-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                    人気
                  </span>
                </div>
              )}
              {plan.bestValue && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-orange-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                    最もお得
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-900">{plan.name}プラン</h3>
                <div
                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                    selectedPlan === plan.id
                      ? 'border-green-500 bg-green-500'
                      : 'border-gray-300'
                  }`}
                >
                  {selectedPlan === plan.id && (
                    <Check className="w-4 h-4 text-white" />
                  )}
                </div>
              </div>

              <div className="mb-4">
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-gray-900">
                    ¥{plan.monthlyPrice.toLocaleString()}
                  </span>
                  <span className="text-gray-500">/月</span>
                </div>
                {plan.discount > 0 && (
                  <p className="text-green-600 text-sm font-medium mt-1">
                    {plan.discount}% OFF
                  </p>
                )}
              </div>

              <div className="border-t pt-4">
                <p className="text-gray-600 text-sm">
                  {plan.period}ヶ月分: ¥{plan.totalPrice.toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-xl p-6 max-w-2xl mx-auto">
          <h3 className="font-bold text-gray-900 mb-4">すべてのプランに含まれる機能</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              '親機1台の接続',
              '子機3台までの接続',
              'リアルタイム温度・湿度監視',
              '履歴データの閲覧（30日分）',
              'アラート通知（メール）',
              '霜予測機能',
              '収穫日予測機能',
              'LTE通信費込み',
            ].map((feature) => (
              <div key={feature} className="flex items-center gap-2">
                <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
                <span className="text-gray-700">{feature}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 text-center">
          <button
            onClick={handleSubscribe}
            disabled={isLoading}
            className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-8 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                処理中...
              </>
            ) : (
              <>
                <CreditCard className="w-5 h-5" />
                {PLANS.find((p) => p.id === selectedPlan)?.name}プランで申し込む
              </>
            )}
          </button>
          <p className="text-gray-500 text-sm mt-4">
            安全なStripe決済を使用しています
          </p>
        </div>
      </div>
    </div>
  );
};

export default PricingPlans;
