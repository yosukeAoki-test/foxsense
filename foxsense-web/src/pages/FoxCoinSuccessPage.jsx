import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { foxCoinApi } from '../api/client'

export default function FoxCoinSuccessPage() {
  const [searchParams] = useSearchParams()
  const sessionId = searchParams.get('session_id')
  const { isAuthenticated } = useAuth()
  const [purchaseId, setPurchaseId] = useState(null)
  const retriesRef = useRef(0)
  const MAX_RETRIES = 8

  useEffect(() => {
    if (!isAuthenticated) return

    // sessionId が mock（テストモード）の場合は最新購入をそのまま使う
    const isMock = !sessionId || sessionId === 'mock'

    const tryFind = () => {
      foxCoinApi.getPurchases()
        .then(purchases => {
          if (!purchases?.length) return

          if (isMock) {
            // テストモード: 最新の購入レコードを使う
            setPurchaseId(purchases[0].id)
            return
          }

          const match = purchases.find(p => p.stripeSessionId === sessionId)
          if (match) {
            setPurchaseId(match.id)
          } else if (retriesRef.current < MAX_RETRIES) {
            // webhookがまだ処理されていない場合はリトライ
            retriesRef.current++
            setTimeout(tryFind, 2000)
          } else {
            // タイムアウト: 最新購入にフォールバック
            setPurchaseId(purchases[0].id)
          }
        })
        .catch(() => {})
    }

    // 少し待ってからfetch（webhookの処理時間を確保）
    const timer = setTimeout(tryFind, 1500)
    return () => clearTimeout(timer)
  }, [sessionId, isAuthenticated])

  return (
    <div className="min-h-screen bg-green-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-lg p-8 text-center max-w-md w-full">
        <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">購入完了</h1>
        <p className="text-gray-600 mb-6">FoxCoin が有効になりました。</p>
        <div className="flex flex-col gap-2">
          <a
            href="/"
            className="bg-yellow-500 hover:bg-yellow-600 text-white font-medium py-2.5 px-6 rounded-lg transition-colors"
          >
            ダッシュボードへ
          </a>
          {purchaseId ? (
            <a
              href={`/receipt/${purchaseId}`}
              target="_blank"
              rel="noreferrer"
              className="border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium py-2.5 px-6 rounded-lg transition-colors text-sm"
            >
              領収書を表示（適格請求書）
            </a>
          ) : (
            <p className="text-xs text-gray-400 animate-pulse">領収書を準備中...</p>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-4">
          領収書は後からアカウント設定でも確認できます。
        </p>
      </div>
    </div>
  )
}
