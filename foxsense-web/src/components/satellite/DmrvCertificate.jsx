const CH4_KG_PER_HA_DAY = 3.0
const REDUCTION_RATE = 0.30
const CH4_GWP = 27.9
const CREDIT_UNIT_JPY = 2500

function NdwiChart({ data }) {
  const ts = data.time_series
  const d  = data.drainage_detection
  if (ts.length === 0) return null

  const W = 280
  const H = 64
  const midY = H / 2
  const barW = Math.max(2, (W / ts.length) - 1)

  return (
    <div>
      <p className="text-xs text-gray-400 mb-1">NDWI時系列（青=湛水 / 橙=落水）</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded" style={{ height: 64, background: '#f9fafb' }}>
        <line x1={0} y1={midY} x2={W} y2={midY} stroke="#d1d5db" strokeWidth={1} />
        {ts.map((pt, i) => {
          const v   = pt.ndwi_mean ?? 0
          const h   = Math.max(2, Math.abs(v) * midY)
          const inDrain = d.start && d.end && pt.date >= d.start && pt.date <= d.end
          const color   = inDrain ? '#f97316' : v > 0 ? '#3b82f6' : '#9ca3af'
          const y       = v >= 0 ? midY - h : midY
          const x       = i * (W / ts.length) + 0.5
          return <rect key={i} x={x} y={y} width={barW} height={h} fill={color} rx={1} />
        })}
      </svg>
      <div className="flex gap-4 mt-1">
        <span className="flex items-center gap-1 text-xs text-gray-400">
          <span className="inline-block w-3 h-2 rounded-sm bg-blue-400" />湛水
        </span>
        <span className="flex items-center gap-1 text-xs text-gray-400">
          <span className="inline-block w-3 h-2 rounded-sm bg-orange-400" />中干し期間
        </span>
        <span className="flex items-center gap-1 text-xs text-gray-400">
          <span className="inline-block w-3 h-2 rounded-sm bg-gray-400" />乾燥
        </span>
      </div>
    </div>
  )
}

export default function DmrvCertificate({ data, areaHa }) {
  const d       = data.drainage_detection
  const extDays = Math.max(0, d.duration_days - 7)
  const eligible = d.detected && extDays >= 7

  const ch4Kg  = CH4_KG_PER_HA_DAY * REDUCTION_RATE * extDays * areaHa
  const co2T   = (ch4Kg * CH4_GWP) / 1000
  const creditJpy = Math.round(co2T * CREDIT_UNIT_JPY)

  const sceneCount = data.time_series.length
  const confidence = sceneCount >= 6 ? '高' : sceneCount >= 3 ? '中' : '低'

  return (
    <div className={`rounded-xl border-2 p-4 space-y-4 ${eligible ? 'border-green-400 bg-green-50' : 'border-yellow-300 bg-yellow-50'}`}>
      <div className="flex items-start gap-2">
        <div className="text-2xl">🛰</div>
        <div className="flex-1">
          <p className="text-sm font-bold text-gray-800">衛星dMRV 認証証明書</p>
          <p className="text-xs text-gray-400">Satellite Digital MRV Certificate</p>
        </div>
        <span className={`text-xs font-bold px-2 py-1 rounded-full ${
          eligible ? 'bg-green-200 text-green-800' : 'bg-yellow-200 text-yellow-800'
        }`}>
          {eligible ? '認証済み ✓' : '要確認 △'}
        </span>
      </div>

      <NdwiChart data={data} />

      <div className="bg-white rounded-lg p-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <p className="text-gray-400">観測衛星</p>
          <p className="font-medium text-gray-800">Sentinel-2 (ESA)</p>
        </div>
        <div>
          <p className="text-gray-400">観測シーン数</p>
          <p className="font-medium text-gray-800">{sceneCount}シーン</p>
        </div>
        <div>
          <p className="text-gray-400">データソース</p>
          <p className="font-medium text-gray-800">Planetary Computer</p>
        </div>
        <div>
          <p className="text-gray-400">認証信頼度</p>
          <p className={`font-bold ${confidence === '高' ? 'text-green-600' : confidence === '中' ? 'text-yellow-600' : 'text-red-500'}`}>
            {confidence}
          </p>
        </div>
        {d.detected && (
          <>
            <div>
              <p className="text-gray-400">落水開始（衛星検出）</p>
              <p className="font-medium text-gray-800">{d.start}</p>
            </div>
            <div>
              <p className="text-gray-400">復水日（衛星検出）</p>
              <p className="font-medium text-gray-800">{d.end}</p>
            </div>
            <div>
              <p className="text-gray-400">中干し期間</p>
              <p className="font-bold text-blue-700">{d.duration_days}日間</p>
            </div>
            <div>
              <p className="text-gray-400">標準超過日数</p>
              <p className={`font-bold ${extDays >= 7 ? 'text-green-600' : 'text-yellow-600'}`}>
                +{extDays}日
              </p>
            </div>
          </>
        )}
      </div>

      {eligible && (
        <div className="bg-white rounded-lg p-3 space-y-2">
          <p className="text-xs font-medium text-gray-600">J-クレジット試算（AG-002）</p>
          <div className="flex justify-between items-baseline">
            <span className="text-xs text-gray-400">CO2削減量</span>
            <span className="font-bold text-gray-800">{co2T.toFixed(4)} t-CO2e</span>
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-xs text-gray-400">クレジット試算額</span>
            <span className="text-xl font-bold text-green-700">¥{creditJpy.toLocaleString()}</span>
          </div>
          <p className="text-xs text-gray-400">※ 申告ゼロ・全て衛星データで自動証明</p>
        </div>
      )}

      {!d.detected && (
        <p className="text-xs text-yellow-700 bg-yellow-100 rounded p-2">
          中干し期間を衛星データから検出できませんでした。<br />
          雲量が多い時期はデータが不足する場合があります。
        </p>
      )}
    </div>
  )
}
