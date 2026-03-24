import { useState } from 'react'
import { useSatelliteApi } from '../../hooks/useSatelliteApi'

export default function CarbonPanel({ areaHa, drainageDays }) {
  const [days, setDays] = useState(drainageDays ?? 14)
  const { data, loading, error, post } = useSatelliteApi()

  const calculate = () =>
    post('/carbon', {
      field_id: 'foxsense-field',
      area_ha: areaHa,
      actual_drainage_days: days,
      standard_drainage_days: 7,
    })

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-4 space-y-3">
        <p className="text-sm font-medium text-gray-700">CO2削減量の見える化</p>
        <p className="text-xs text-gray-400">中干しを延長した分のメタン削減量・CO2換算量を確認できます。JAへの交渉材料や補助金申請の参考数値としてご活用ください。</p>

        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 w-24">田んぼの広さ</span>
          <span className="font-semibold text-gray-800">{areaHa} ha</span>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500 w-24">中干し期間</span>
            <input
              type="number"
              value={days}
              onChange={e => setDays(+e.target.value)}
              className="w-20 border rounded-lg px-2 py-1 text-center text-sm"
              min={1}
              max={60}
            />
            <span className="text-sm text-gray-500">日</span>
          </div>
          {drainageDays ? (
            <button
              onClick={() => setDays(drainageDays)}
              className="text-xs bg-blue-50 text-blue-600 border border-blue-200 rounded-lg px-3 py-1.5 w-full flex items-center justify-center gap-1"
            >
              🛰 衛星検出値を使用（{drainageDays}日）
            </button>
          ) : (
            <p className="text-xs text-gray-400">※「中干し検出」タブで衛星解析すると自動入力できます</p>
          )}
        </div>

        <p className="text-xs text-gray-400">通常より長く水を抜いた日数分がクレジットになります（基準：7日超）</p>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <button
          onClick={calculate}
          disabled={loading}
          className="w-full bg-green-600 text-white py-2 rounded-lg font-medium text-sm disabled:opacity-50"
        >
          {loading ? '計算中...' : '計算する'}
        </button>
      </div>

      {data && (
        <div className="space-y-3">
          <div className={`rounded-xl border p-4 ${data.eligible ? 'bg-green-50 border-green-300' : 'bg-yellow-50 border-yellow-300'}`}>
            <p className="text-xs text-gray-400 mb-1">J-クレジット 申請資格</p>
            <p className={`font-bold text-lg ${data.eligible ? 'text-green-700' : 'text-yellow-700'}`}>
              {data.eligible ? '✓ J-クレジット基準（7日超）を満たしています' : '△ 基準まであと少しです（7日超が目安）'}
            </p>
            <p className="text-xs text-gray-400 mt-1">通常より {data.extension_days}日長く中干しをしました</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-xl border p-4">
              <p className="text-xs text-gray-400">メタンガス削減量</p>
              <p className="text-xl font-bold text-gray-800 mt-1">
                {data.ch4_reduction_kg.toFixed(2)}
                <span className="text-sm font-normal text-gray-400 ml-1">kg</span>
              </p>
            </div>
            <div className="bg-white rounded-xl border p-4">
              <p className="text-xs text-gray-400">CO2削減量</p>
              <p className="text-xl font-bold text-gray-800 mt-1">
                {data.co2_equivalent_t.toFixed(4)}
                <span className="text-sm font-normal text-gray-400 ml-1">t-CO2e</span>
              </p>
            </div>
          </div>

          <div className="bg-white rounded-xl border p-4">
            <p className="text-xs text-gray-400">受け取れる収入の目安</p>
            <p className="text-4xl font-bold text-green-700 mt-1">
              ¥{data.estimated_credit_value_jpy.toLocaleString()}
            </p>
            <p className="text-xs text-gray-400 mt-1">※ 参考試算（単価2,500円/t-CO2）。実際の申請はJAや専門機関にご相談ください。</p>
          </div>
        </div>
      )}
    </div>
  )
}
