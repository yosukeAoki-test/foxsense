import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Lock, Eye, EyeOff, AlertCircle, CheckCircle } from 'lucide-react';
import { authApi } from '../api/client';

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== passwordConfirm) {
      setError('パスワードが一致しません');
      return;
    }
    if (password.length < 8) {
      setError('パスワードは8文字以上で入力してください');
      return;
    }

    setIsLoading(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.message || 'パスワードのリセットに失敗しました。リンクの有効期限が切れている可能性があります。');
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <AlertCircle className="w-14 h-14 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-700 mb-2">無効なリンク</h2>
          <p className="text-gray-500 text-sm mb-6">このリセットリンクは無効です。</p>
          <Link to="/forgot-password" className="text-leaf-600 hover:text-leaf-700 font-medium text-sm">
            パスワードリセットをやり直す
          </Link>
        </div>
      </div>
    );
  }

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

        <div className="card p-6 sm:p-8 fade-in">
          <h2 className="text-lg font-bold text-gray-800 mb-2 text-center">新しいパスワードを設定</h2>

          {done ? (
            <div className="text-center py-4">
              <CheckCircle className="w-14 h-14 text-leaf-500 mx-auto mb-4" />
              <p className="text-gray-700 font-medium mb-2">パスワードを変更しました</p>
              <p className="text-sm text-gray-500 mb-6">
                新しいパスワードでログインしてください。
              </p>
              <Link
                to="/login"
                className="inline-block px-6 py-2.5 rounded-xl bg-gradient-to-r from-leaf-500 to-leaf-600 text-white font-medium hover:from-leaf-600 hover:to-leaf-700 transition-all shadow-lg shadow-leaf-500/25 text-sm"
              >
                ログイン画面へ
              </Link>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-500 mb-6 text-center">
                8文字以上の新しいパスワードを入力してください。
              </p>

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 rounded-lg text-red-600 mb-4">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <span className="text-sm">{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    新しいパスワード
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
                      autoFocus
                      autoComplete="new-password"
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

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    パスワード（確認）
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={passwordConfirm}
                      onChange={(e) => setPasswordConfirm(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:border-leaf-400 focus:ring-2 focus:ring-leaf-100 outline-none transition-all"
                      required
                      autoComplete="new-password"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-leaf-500 to-leaf-600 text-white font-medium hover:from-leaf-600 hover:to-leaf-700 disabled:from-gray-300 disabled:to-gray-400 transition-all shadow-lg shadow-leaf-500/25 disabled:shadow-none flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    'パスワードを変更する'
                  )}
                </button>
              </form>

              <div className="mt-6 text-center">
                <Link to="/forgot-password" className="text-sm text-gray-500 hover:text-gray-700">
                  メールを再送する
                </Link>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          © 2025 FoxSense. All rights reserved.
        </p>
      </div>
    </div>
  );
};

export default ResetPassword;
