import { useState } from 'react';
import { ShieldCheck, X, CheckCircle2 } from 'lucide-react';
import { authApi } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

const TwoFactorSetupModal = ({ onClose }) => {
  const { updateTwoFactorEnabled } = useAuth();
  const [phase, setPhase] = useState('intro'); // intro | setup | done
  const [qrUrl, setQrUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleStart = async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await authApi.setup2fa();
      setQrUrl(res.data.qrCodeDataUrl);
      setSecret(res.data.secret);
      setPhase('setup');
    } catch (e) {
      setError('セットアップの準備に失敗しました。もう一度お試しください。');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEnable = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      await authApi.enable2fa(code);
      updateTwoFactorEnabled(true);
      setPhase('done');
    } catch (e) {
      setError(e.response?.data?.message || '認証コードが正しくありません');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 背景オーバーレイ */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* モーダル本体 */}
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">

        {/* ヘッダーグラデーション */}
        <div className="bg-gradient-to-br from-green-500 to-emerald-600 px-6 pt-8 pb-6 text-white">
          <div className="flex justify-between items-start">
            <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center mb-4">
              <ShieldCheck className="w-8 h-8 text-white" />
            </div>
            {phase !== 'done' && (
              <button
                onClick={onClose}
                className="text-white/60 hover:text-white transition-colors p-1"
                title="後で設定する"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
          <h2 className="text-xl font-bold">2段階認証を設定しましょう</h2>
          <p className="text-green-100 text-sm mt-1">
            アカウントを不正アクセスから守るため、認証アプリによる2段階認証を設定してください。
          </p>
        </div>

        {/* コンテンツ */}
        <div className="px-6 py-5">

          {/* イントロ */}
          {phase === 'intro' && (
            <div className="space-y-4">
              <div className="space-y-3">
                {[
                  { icon: '📱', title: '認証アプリをインストール', desc: 'Google Authenticator または Authy をスマートフォンにインストールします' },
                  { icon: '📷', title: 'QRコードをスキャン', desc: '次の画面に表示されるQRコードをアプリでスキャンします' },
                  { icon: '🔢', title: '6桁コードで確認', desc: 'アプリに表示される6桁のコードを入力して設定完了です' },
                ].map((step, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <span className="text-xl flex-shrink-0 mt-0.5">{step.icon}</span>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{step.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{step.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

              <button
                onClick={handleStart}
                disabled={isLoading}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white font-semibold hover:from-green-600 hover:to-emerald-700 disabled:opacity-50 transition-all shadow-lg shadow-green-500/25"
              >
                {isLoading ? '準備中...' : '設定を始める'}
              </button>
              <button
                onClick={onClose}
                className="w-full py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                後で設定する
              </button>
            </div>
          )}

          {/* セットアップ */}
          {phase === 'setup' && (
            <form onSubmit={handleEnable} className="space-y-4">
              <div className="flex gap-4 items-start">
                <div className="flex-shrink-0">
                  <div className="bg-gray-50 p-2 rounded-xl border border-gray-200 inline-block">
                    <img src={qrUrl} alt="2FA QR" className="w-32 h-32" />
                  </div>
                </div>
                <div className="flex-1 space-y-2 text-xs text-gray-600">
                  <p className="font-semibold text-gray-800 text-sm">① QRをスキャン</p>
                  <p>Google Authenticator または Authy でスキャンしてください。</p>
                  {secret && (
                    <div className="bg-gray-50 rounded-lg px-2.5 py-2 mt-2">
                      <p className="text-gray-400 mb-0.5">手動入力</p>
                      <p className="font-mono text-gray-700 break-all text-[10px]">{secret}</p>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-gray-800 mb-2">② 6桁コードを入力して有効化</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className="flex-1 px-3 py-2.5 rounded-xl border border-gray-200 text-center text-xl tracking-widest font-mono focus:border-green-400 focus:ring-2 focus:ring-green-100 outline-none"
                    autoComplete="one-time-code"
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={isLoading || code.length !== 6}
                    className="px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold transition-colors"
                  >
                    {isLoading ? '...' : '有効化'}
                  </button>
                </div>
                {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
              </div>

              <button type="button" onClick={onClose} className="w-full py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors">
                後で設定する
              </button>
            </form>
          )}

          {/* 完了 */}
          {phase === 'done' && (
            <div className="text-center space-y-4 py-2">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-9 h-9 text-green-500" />
              </div>
              <div>
                <p className="font-bold text-gray-900">2段階認証が有効になりました！</p>
                <p className="text-sm text-gray-500 mt-1">次回ログインから認証アプリが必要になります。</p>
              </div>
              <button
                onClick={onClose}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white font-semibold transition-all shadow-lg shadow-green-500/25"
              >
                ダッシュボードへ
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TwoFactorSetupModal;
