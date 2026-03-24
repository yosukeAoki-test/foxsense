import { useEffect, useState } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { foxCoinApi } from '../api/client'

function fmt(n) {
  return n?.toLocaleString('ja-JP') ?? '—'
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

export default function ReceiptPage() {
  const { purchaseId } = useParams()
  const { isAuthenticated, isLoading } = useAuth()
  const [receipt, setReceipt] = useState(null)
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (!isAuthenticated) return
    foxCoinApi.getReceipt(purchaseId)
      .then(setReceipt)
      .catch(() => setError('領収書が見つかりません'))
  }, [purchaseId, isAuthenticated])

  if (isLoading) return null
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (error) return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-red-500 text-sm">{error}</p>
    </div>
  )
  if (!receipt) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const r = receipt

  return (
    <div className="min-h-screen bg-gray-100 flex items-start justify-center py-10 px-4 print:bg-white print:py-0">
      <div className="bg-white w-full max-w-lg shadow-lg print:shadow-none p-8 space-y-6">

        {/* ヘッダー */}
        <div className="text-center border-b pb-4">
          <h1 className="text-2xl font-bold text-gray-900 tracking-wide">領　収　書</h1>
          <p className="text-xs text-gray-400 mt-1">適格簡易請求書</p>
        </div>

        {/* 宛名 */}
        <div>
          <p className="text-lg font-bold text-gray-800 border-b-2 border-gray-800 inline-block pr-8 pb-0.5">
            {r.buyerName} 様
          </p>
        </div>

        {/* 金額 */}
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <p className="text-xs text-gray-500 mb-1">お支払い金額（税込）</p>
          <p className="text-4xl font-bold text-gray-900">¥{fmt(r.priceIncTax)}</p>
          <p className="text-xs text-gray-400 mt-1">但し　{r.itemName}として</p>
        </div>

        {/* 明細 */}
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100 text-gray-600 text-xs">
              <th className="text-left py-2 px-3 font-medium">品目</th>
              <th className="text-right py-2 px-3 font-medium">税抜金額</th>
              <th className="text-right py-2 px-3 font-medium">税率</th>
              <th className="text-right py-2 px-3 font-medium">消費税額</th>
              <th className="text-right py-2 px-3 font-medium">税込金額</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t text-gray-800">
              <td className="py-3 px-3">{r.itemName}</td>
              <td className="py-3 px-3 text-right">¥{fmt(r.priceExTax)}</td>
              <td className="py-3 px-3 text-right">{r.taxRate}%</td>
              <td className="py-3 px-3 text-right">¥{fmt(r.taxAmount)}</td>
              <td className="py-3 px-3 text-right font-bold">¥{fmt(r.priceIncTax)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-800 text-gray-800 font-bold">
              <td className="py-2 px-3" colSpan={3}>合計</td>
              <td className="py-2 px-3 text-right text-xs font-normal text-gray-500">
                （うち消費税 ¥{fmt(r.taxAmount)}）
              </td>
              <td className="py-2 px-3 text-right">¥{fmt(r.priceIncTax)}</td>
            </tr>
          </tfoot>
        </table>

        {/* 発行者情報 */}
        <div className="border-t pt-4 space-y-1 text-xs text-gray-600">
          <p className="font-bold text-sm text-gray-800">{r.issuer.name}</p>
          <p>適格請求書発行事業者登録番号：{r.issuer.registrationNo}</p>
          <p>{r.issuer.address}</p>
          <p>{r.issuer.email}</p>
        </div>

        {/* フッター情報 */}
        <div className="border-t pt-3 flex justify-between text-xs text-gray-400">
          <span>領収書番号：{r.receiptNo}</span>
          <span>発行日：{fmtDate(r.issuedAt)}</span>
        </div>

        {/* 印刷ボタン（印刷時は非表示） */}
        <div className="print:hidden flex gap-2 pt-2">
          <button
            onClick={() => window.print()}
            className="flex-1 bg-gray-800 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-gray-700"
          >
            印刷 / PDF保存
          </button>
          <button
            onClick={() => window.history.back()}
            className="px-4 py-2.5 rounded-lg border text-sm text-gray-500 hover:bg-gray-50"
          >
            戻る
          </button>
        </div>
      </div>
    </div>
  )
}
