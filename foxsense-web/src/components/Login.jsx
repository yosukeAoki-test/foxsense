import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { authApi } from '../api/client';
import { Mail, Lock, LogIn, AlertCircle, Eye, EyeOff, ShieldCheck } from 'lucide-react';

const Login = () => {
  const { login, completeLogin } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // 2FA step
  const [step, setStep] = useState('password'); // 'password' | '2fa'
  const [tempToken, setTempToken] = useState('');
  const [totpCode, setTotpCode] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const result = await login(email, password);
      if (result?.requiresTwoFactor) {
        setTempToken(result.tempToken);
        setStep('2fa');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'ログインに失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify2fa = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const result = await authApi.verify2fa(tempToken, totpCode);
      completeLogin(result.data.user);
    } catch (err) {
      setError(err.response?.data?.message || err.message || '認証コードが正しくありません');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* ロゴ・タイトル */}
        <div className="text-center mb-8">
          <img
            src="/logo.jpg"
            alt="FoxSense Logo"
            className="w-20 h-20 mx-auto rounded-2xl object-contain mb-4"
          />
          <h1 className="text-2xl sm:text-3xl font-bold gradient-text">FoxSense</h1>
          <p className="text-sm text-leaf-600/70 mt-1">農業環境モニタリング</p>
        </div>

        {/* ログインカード */}
        <div className="card p-6 sm:p-8 fade-in">
          <h2 className="text-lg font-bold text-gray-800 mb-6 text-center">
            {step === '2fa' ? '2段階認証' : 'ログイン'}
          </h2>

          {/* エラーメッセージ */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 rounded-lg text-red-600 mb-4">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {step === 'password' ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* メールアドレス */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  メールアドレス
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@foxsense.jp"
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:border-leaf-400 focus:ring-2 focus:ring-leaf-100 outline-none transition-all"
                    required
                    autoComplete="email"
                  />
                </div>
              </div>

              {/* パスワード */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  パスワード
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-12 py-3 rounded-xl border border-gray-200 focus:border-leaf-400 focus:ring-2 focus:ring-leaf-100 outline-none transition-all"
                    required
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {/* パスワードを忘れた方 */}
              <div className="flex justify-end">
                <Link to="/forgot-password" className="text-xs text-gray-400 hover:text-leaf-600 transition-colors">
                  パスワードをお忘れの方
                </Link>
              </div>

              {/* ログインボタン */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-leaf-500 to-leaf-600 text-white font-medium hover:from-leaf-600 hover:to-leaf-700 disabled:from-gray-300 disabled:to-gray-400 transition-all shadow-lg shadow-leaf-500/25 disabled:shadow-none flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <LogIn className="w-5 h-5" />
                    <span>ログイン</span>
                  </>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerify2fa} className="space-y-4">
              <div className="flex flex-col items-center gap-2 py-2 text-gray-600">
                <ShieldCheck className="w-10 h-10 text-leaf-500" />
                <p className="text-sm text-center">認証アプリに表示されている6桁のコードを入力してください</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  認証コード
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-leaf-400 focus:ring-2 focus:ring-leaf-100 outline-none transition-all text-center text-2xl tracking-widest font-mono"
                  required
                  autoComplete="one-time-code"
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={isLoading || totpCode.length !== 6}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-leaf-500 to-leaf-600 text-white font-medium hover:from-leaf-600 hover:to-leaf-700 disabled:from-gray-300 disabled:to-gray-400 transition-all shadow-lg shadow-leaf-500/25 disabled:shadow-none flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <ShieldCheck className="w-5 h-5" />
                    <span>確認</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => { setStep('password'); setTotpCode(''); setError(''); }}
                className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                パスワード入力に戻る
              </button>
            </form>
          )}

          {/* アカウント登録リンク */}
          {step === 'password' && (
            <div className="mt-6 pt-6 border-t border-gray-100 text-center">
              <p className="text-sm text-gray-600">
                アカウントをお持ちでない方は{' '}
                <Link to="/register" className="text-leaf-600 hover:text-leaf-700 font-medium">
                  新規登録
                </Link>
              </p>
            </div>
          )}
        </div>

        {/* フッター */}
        <p className="text-center text-xs text-gray-400 mt-6">
          © 2025 FoxSense. All rights reserved.
        </p>
      </div>
    </div>
  );
};

export default Login;
