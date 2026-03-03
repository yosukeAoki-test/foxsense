import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft, AlertCircle, CheckCircle } from 'lucide-react';
import { authApi } from '../api/client';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.message || 'リクエストに失敗しました');
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

        <div className="card p-6 sm:p-8 fade-in">
          <h2 className="text-lg font-bold text-gray-800 mb-2 text-center">パスワードをお忘れの方</h2>

          {sent ? (
            <div className="text-center py-4">
              <CheckCircle className="w-14 h-14 text-leaf-500 mx-auto mb-4" />
              <p className="text-gray-700 font-medium mb-2">メールを送信しました</p>
              <p className="text-sm text-gray-500 mb-6">
                <span className="font-medium text-gray-700">{email}</span> にパスワードリセット用のリンクを送りました。
                メールが届かない場合は迷惑メールフォルダをご確認ください。
              </p>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 text-leaf-600 hover:text-leaf-700 font-medium text-sm"
              >
                <ArrowLeft className="w-4 h-4" />
                ログインに戻る
              </Link>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-500 mb-6 text-center">
                登録済みのメールアドレスを入力してください。パスワードリセット用のリンクをお送りします。
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
                      autoFocus
                      autoComplete="email"
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
                    'リセットメールを送信'
                  )}
                </button>
              </form>

              <div className="mt-6 text-center">
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
                >
                  <ArrowLeft className="w-4 h-4" />
                  ログインに戻る
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

export default ForgotPassword;
