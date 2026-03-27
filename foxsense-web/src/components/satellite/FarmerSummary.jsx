// 作物別 NDVI 閾値（バックエンド indices.py の NDVI_THRESHOLDS と同期させること）
const NDVI_THRESHOLDS = {
  '水稲': { good: 0.65, normal: 0.50, poor: 0.35 },
  '大豆': { good: 0.60, normal: 0.45, poor: 0.30 },
  '小麦': { good: 0.55, normal: 0.40, poor: 0.25 },
  '野菜': { good: 0.50, normal: 0.35, poor: 0.20 },
}
const DEFAULT_NDVI_THRESHOLDS = { good: 0.70, normal: 0.55, poor: 0.40 }

function diagnoseGrowth(mean, cropType) {
  if (mean == null) return { icon: '❓', title: '生育状況', message: 'データが取得できませんでした', color: 'gray' }
  const t = NDVI_THRESHOLDS[cropType] ?? DEFAULT_NDVI_THRESHOLDS
  if (mean >= t.good)   return { icon: '🌾', title: '生育状況', message: '非常に良好です', color: 'green' }
  if (mean >= t.normal) return { icon: '🌱', title: '生育状況', message: '順調に育っています', color: 'green' }
  if (mean >= t.poor)   return { icon: '⚠️', title: '生育状況', message: 'やや生育が遅れています', action: '圃場を直接確認することをおすすめします', color: 'yellow' }
  return { icon: '🚨', title: '生育状況', message: '生育不良の可能性があります', action: '早急に圃場を確認してください', color: 'red' }
}

function diagnoseNitrogen(ndre) {
  if (ndre == null) return { icon: '🌿', title: '肥料の効き具合', message: '今回は計測できませんでした（雲が多い日は取得できないことがあります）', color: 'gray' }
  if (ndre >= 0.45) return { icon: '🌿', title: '肥料の効き具合', message: '窒素が多すぎます', action: '追肥は控えてください。倒伏（稲が倒れる）に注意を。', color: 'orange' }
  if (ndre >= 0.30) return { icon: '🌿', title: '肥料の効き具合', message: '適正な状態です', color: 'green' }
  if (ndre >= 0.15) return { icon: '🌿', title: '肥料の効き具合', message: '肥料がやや不足しています', action: '追肥を検討してください（目安：窒素2〜3kg/10a）', color: 'yellow' }
  return { icon: '🌿', title: '肥料の効き具合', message: '肥料が不足しています', action: '土壌診断と追肥をおすすめします', color: 'red' }
}

function diagnoseWater(ndwi) {
  if (ndwi == null) return { icon: '💧', title: '水の状態', message: '今回は計測できませんでした', color: 'gray' }
  if (ndwi > 0.1)  return { icon: '💧', title: '水の状態', message: '田んぼに水があります（湛水中）', color: 'blue' }
  if (ndwi > -0.1) return { icon: '💧', title: '水の状態', message: '水が少なくなっています', color: 'yellow' }
  return { icon: '🏜️', title: '水の状態', message: '落水中です（中干し期間の可能性）', color: 'orange' }
}

const COLOR_MAP = {
  green:  { bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-800',  sub: 'text-green-600' },
  yellow: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-800', sub: 'text-yellow-600' },
  orange: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-800', sub: 'text-orange-600' },
  red:    { bg: 'bg-red-50',    border: 'border-red-200',    text: 'text-red-800',    sub: 'text-red-600' },
  blue:   { bg: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-800',   sub: 'text-blue-600' },
  gray:   { bg: 'bg-gray-50',   border: 'border-gray-200',   text: 'text-gray-600',   sub: 'text-gray-400' },
}

function DiagnosisCard({ d }) {
  const c = COLOR_MAP[d.color]
  return (
    <div className={`rounded-xl border p-4 ${c.bg} ${c.border}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">{d.icon}</span>
        <p className={`text-xs font-medium ${c.sub}`}>{d.title}</p>
      </div>
      <p className={`text-sm font-bold ${c.text}`}>{d.message}</p>
      {d.action && (
        <p className={`text-xs mt-1.5 ${c.sub}`}>→ {d.action}</p>
      )}
    </div>
  )
}

export default function FarmerSummary({ ndvi, cropType }) {
  // scenes は datetime 昇順ソート済み — 末尾が最新シーン
  const latest = ndvi.scenes[ndvi.scenes.length - 1]
  if (!latest) return null

  const growth   = diagnoseGrowth(latest.ndvi?.mean, cropType)
  const nitrogen = diagnoseNitrogen(latest.ndre_mean)
  const water    = diagnoseWater(latest.ndwi_mean)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-gray-400">最終衛星観測日</p>
        <p className="text-xs font-medium text-gray-600">{latest.datetime}（雲量 {latest.cloud_cover?.toFixed(0)}%）</p>
      </div>
      {cropType && (
        <p className="text-xs text-gray-400 px-1">作物: {cropType}</p>
      )}
      <DiagnosisCard d={growth} />
      <DiagnosisCard d={nitrogen} />
      <DiagnosisCard d={water} />
      <p className="text-xs text-gray-300 text-center">
        ※ 衛星データ（Sentinel-2）による自動診断。天候・雲量により精度が変わる場合があります。
      </p>
    </div>
  )
}
