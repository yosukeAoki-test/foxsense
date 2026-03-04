import { Link } from 'react-router-dom';
import { Radio, CheckCircle2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const OnboardingBanner = ({ parentDevices, onOpen2fa }) => {
  const { user } = useAuth();
  const has2fa = user?.twoFactorEnabled;
  const hasDevice = parentDevices.length > 0;

  if (has2fa && hasDevice) return null;

  return (
    <div className="mb-4 sm:mb-6 fade-in">
      <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 overflow-hidden shadow-sm">
        <div className="px-4 sm:px-5 py-3 border-b border-amber-200/60 flex items-center gap-2.5">
          <span className="text-lg">🦊</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900">はじめての設定</p>
            <p className="text-xs text-amber-700/70">
              {[!has2fa && '2段階認証', !hasDevice && '親機の登録'].filter(Boolean).join('・')}が未完了です
            </p>
          </div>
          <span className="text-xs text-amber-700 font-medium">
            {(has2fa ? 1 : 0) + (hasDevice ? 1 : 0)} / 2 完了
          </span>
        </div>

        <div className="divide-y divide-amber-100">
          {/* 2FAステップ */}
          <div className={`flex items-center gap-3 px-4 sm:px-5 py-3 ${has2fa ? 'opacity-50' : ''}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${has2fa ? 'bg-green-100' : 'bg-white border-2 border-amber-300'}`}>
              {has2fa ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <ShieldCheck className="w-4 h-4 text-amber-500" />}
            </div>
            <div className="flex-1">
              <p className={`text-sm font-semibold ${has2fa ? 'text-gray-400 line-through' : 'text-gray-800'}`}>2段階認証を設定する</p>
              <p className="text-xs text-gray-500">{has2fa ? '設定済み' : 'アカウントをより安全に保護します'}</p>
            </div>
            {!has2fa && (
              <button
                onClick={onOpen2fa}
                className="flex-shrink-0 px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors"
              >
                設定する →
              </button>
            )}
          </div>

          {/* デバイスステップ */}
          <div className={`flex items-center gap-3 px-4 sm:px-5 py-3 ${hasDevice ? 'opacity-50' : ''}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${hasDevice ? 'bg-green-100' : 'bg-white border-2 border-amber-300'}`}>
              {hasDevice ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <Radio className="w-4 h-4 text-amber-500" />}
            </div>
            <div className="flex-1">
              <p className={`text-sm font-semibold ${hasDevice ? 'text-gray-400 line-through' : 'text-gray-800'}`}>最初の親機を登録する</p>
              <p className="text-xs text-gray-500">{hasDevice ? '登録済み' : 'センサーデータの受信を開始します'}</p>
            </div>
            {!hasDevice && (
              <Link to="/devices" className="flex-shrink-0 px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors">
                登録する →
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingBanner;
