import { useState } from 'react'
import { useSatelliteApi } from '../../hooks/useSatelliteApi'
import SatelliteLoader from './SatelliteLoader'
import LegendBar from './LegendBar'

const INDEX_OPTIONS = [
  { id: 'ndvi', label: 'NDVI', desc: '生育状況' },
  { id: 'ndre', label: 'NDRE', desc: '窒素量' },
  { id: 'ndwi', label: 'NDWI', desc: '水分' },
  { id: 'ndmi', label: 'NDMI', desc: '乾燥ストレス' },
]

const FERTILIZER_COLORS = {
  excess:    'bg-orange-50 border-orange-300 text-orange-700',
  optimal:   'bg-green-50  border-green-300  text-green-700',
  low:       'bg-yellow-50 border-yellow-300 text-yellow-700',
  deficient: 'bg-red-50    border-red-300    text-red-700',
}
const RANK_COLORS = {
  S: 'text-green-600', A: 'text-green-500', B: 'text-blue-500',
  C: 'text-yellow-600', D: 'text-red-500',
}

export default function AnalysisPanel({ selectedArea, startDate, endDate, mapRef, activePolygon }) {
  const analysis  = useSatelliteApi()
  const colormap  = useSatelliteApi()
  const [activeIndex, setActiveIndex] = useState(null)
  const [overlayOn, setOverlayOn] = useState(false)

  if (!selectedArea) return null

  const runAnalysis = () => {
    analysis.post('/analysis/field', {
      bbox: selectedArea.bbox,
      polygon: activePolygon,
      start_date: startDate,
      end_date: endDate,
      cloud_max: 60,
    })
    setOverlayOn(false)
    mapRef.current?.clearOverlay()
  }

  const showOverlay = async (index, sceneDate) => {
    if (!selectedArea) return
    setActiveIndex(index)
    const date = sceneDate ?? startDate
    const res = await colormap.post('/analysis/colormap', {
      bbox: selectedArea.bbox,
      date,
      index,
      polygon: activePolygon ?? null,
    })
    if (res?.image_base64) {
      mapRef.current?.setOverlay(res.image_base64, selectedArea.bbox)
      setOverlayOn(true)
    }
  }

  const clearOverlay = () => {
    mapRef.current?.clearOverlay()
    setOverlayOn(false)
    setActiveIndex(null)
  }

  const f = analysis.data?.fertilizer
  const y = analysis.data?.yield_prediction
  const latestScene = analysis.data?.scenes?.[analysis.data.scenes.length - 1]?.datetime?.slice(0, 10)

  return (
    <div className="space-y-3">
      <button
        onClick={runAnalysis}
        disabled={analysis.loading}
        className="w-full bg-indigo-600 text-white py-2.5 rounded-lg font-medium text-sm disabled:opacity-50"
      >
        {analysis.loading ? '衛星データ解析中...' : '施肥診断・収量予測を実行'}
      </button>
      {analysis.error && <p className="text-xs text-red-500 bg-red-50 rounded p-2">{analysis.error}</p>}
      {analysis.loading && <SatelliteLoader label="施肥診断・収量予測を解析中..." />}

      {analysis.data && (
        <div className="bg-white rounded-xl border p-3 space-y-2">
          <p className="text-xs font-medium text-gray-600">地図上にインデックスを表示</p>
          <div className="grid grid-cols-4 gap-1">
            {INDEX_OPTIONS.map(opt => (
              <button
                key={opt.id}
                onClick={() => activeIndex === opt.id && overlayOn ? clearOverlay() : showOverlay(opt.id, latestScene)}
                disabled={colormap.loading}
                className={`py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  activeIndex === opt.id && overlayOn
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-gray-50 text-gray-600 border-gray-200'
                }`}
              >
                <div>{opt.label}</div>
                <div className="text-gray-400 text-[10px]">{opt.desc}</div>
              </button>
            ))}
          </div>
          {colormap.loading && <p className="text-xs text-gray-400 text-center">画像生成中...</p>}
          {colormap.error && <p className="text-xs text-red-500">{colormap.error}</p>}

          {overlayOn && colormap.data?.legend && (
            <LegendBar
              legend={colormap.data.legend}
              label={INDEX_OPTIONS.find(o => o.id === activeIndex)?.desc + ' 凡例'}
            />
          )}
        </div>
      )}

      {f && f.available && (
        <div className={`rounded-xl border p-4 space-y-2 ${FERTILIZER_COLORS[f.status]}`}>
          <div className="flex items-center gap-2">
            <span className="text-lg">🌿</span>
            <div>
              <p className="text-xs opacity-70">施肥診断（NDRE）</p>
              <p className="font-bold text-base">{f.label}</p>
            </div>
            <span className="ml-auto text-xs opacity-70">NDRE {f.ndre_peak?.toFixed(3)}</span>
          </div>
          <p className="text-xs">{f.recommendation}</p>
        </div>
      )}
      {f && !f.available && analysis.data && (
        <div className="bg-gray-50 rounded-xl border p-4 text-xs text-gray-400">
          施肥診断には RedEdge バンド（B05）のデータが必要です。取得できませんでした。
        </div>
      )}

      {y && y.available && (
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">🌾</span>
            <p className="text-xs font-medium text-gray-600">収量予測（出穂期NDVI）</p>
          </div>
          <div className="flex items-baseline gap-3">
            <span className={`text-4xl font-bold ${RANK_COLORS[y.rank]}`}>{y.rank}</span>
            <div>
              <p className="text-2xl font-bold text-gray-800">
                {y.yield_kg_per_10a}
                <span className="text-sm font-normal text-gray-400 ml-1">kg/10a</span>
              </p>
              <p className="text-xs text-gray-400">ピークNDVI {y.peak_ndvi?.toFixed(3)}</p>
            </div>
          </div>
          <p className="text-xs text-gray-500 bg-gray-50 rounded p-2">{y.comment}</p>
          <p className="text-xs text-gray-300">※ 庄内平野・水稲実績値に基づく統計的推定</p>
        </div>
      )}
      {y && !y.available && analysis.data && (
        <div className="bg-gray-50 rounded-xl border p-4 text-xs text-gray-400">
          収量予測には出穂期（8月）のNDVIデータが必要です。取得できませんでした。
        </div>
      )}

      {analysis.data && (
        <p className="text-xs text-gray-400 text-center">
          解析シーン数: {analysis.data.scene_count}件（{startDate}〜{endDate}）
        </p>
      )}
    </div>
  )
}
