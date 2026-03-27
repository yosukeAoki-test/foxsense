import { useState } from 'react'
import { useSatelliteApi } from '../../hooks/useSatelliteApi'
import SatelliteLoader from './SatelliteLoader'
import LegendBar from './LegendBar'

const LAYERS = [
  { id: 'growth',    label: '生育マップ',  desc: 'NDVI 植生指数',     unit: '' },
  { id: 'fertility', label: '地力マップ',  desc: 'NDRE 葉緑素密度',   unit: '' },
  { id: 'weed',      label: '雑草マップ',  desc: '雑草リスク指数',     unit: '' },
  { id: 'elevation', label: '標高マップ',  desc: '数値標高モデル',     unit: 'm' },
  { id: 'slope',     label: '傾斜マップ',  desc: '傾斜角',            unit: '°' },
]

const LAYER_COLORS = {
  growth:    'bg-green-600',
  fertility: 'bg-amber-600',
  weed:      'bg-orange-600',
  elevation: 'bg-blue-600',
  slope:     'bg-purple-600',
}

export default function MapLayersPanel({ selectedArea, activePolygon, mapRef }) {
  const { data, loading, error, post } = useSatelliteApi()
  const [activeLayer, setActiveLayer] = useState(null)

  if (!selectedArea) return null

  const fetchLayer = async (layerId) => {
    setActiveLayer(layerId)
    mapRef.current?.clearOverlay()
    const result = await post('/map/layer', {
      bbox: selectedArea.bbox,
      layer_type: layerId,
      polygon: activePolygon ?? null,
    })
    if (result?.image_base64) {
      mapRef.current?.setOverlay(result.image_base64, selectedArea.bbox)
    }
  }

  const clearMap = () => {
    mapRef.current?.clearOverlay()
    setActiveLayer(null)
  }

  return (
    <div className="space-y-4">
      {/* レイヤー選択 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {LAYERS.map(layer => (
          <button
            key={layer.id}
            onClick={() => fetchLayer(layer.id)}
            disabled={loading}
            className={`rounded-xl border-2 p-3 text-left transition-all disabled:opacity-40 ${
              activeLayer === layer.id
                ? 'border-green-500 bg-green-50'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <p className="text-sm font-bold text-gray-800">{layer.label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{layer.desc}</p>
          </button>
        ))}
      </div>

      {loading && <SatelliteLoader label="衛星データからマップを生成中..." />}
      {error && <p className="text-xs text-red-500 bg-red-50 rounded p-2">{error}</p>}

      {data && !loading && (
        <div className="space-y-3">
          {/* メタ情報 */}
          <div className="bg-gray-50 rounded-xl border p-3 flex flex-wrap gap-3 text-xs text-gray-600">
            {data.scene_date && (
              <span>撮影日: <strong>{data.scene_date}</strong></span>
            )}
            {data.cloud_cover != null && (
              <span>雲量: <strong>{data.cloud_cover}%</strong></span>
            )}
            {data.stats?.mean != null && (
              <span>
                平均: <strong>{data.stats.mean}{LAYERS.find(l => l.id === data.layer_type)?.unit}</strong>
                　最小: <strong>{data.stats.min}{LAYERS.find(l => l.id === data.layer_type)?.unit}</strong>
                　最大: <strong>{data.stats.max}{LAYERS.find(l => l.id === data.layer_type)?.unit}</strong>
              </span>
            )}
          </div>

          {/* 消去ボタン */}
          <button
            onClick={clearMap}
            className="w-full py-2 rounded-lg border text-xs text-gray-500"
          >
            地図から消去
          </button>

          {/* 凡例 */}
          {data.legend && (
            <LegendBar
              legend={data.legend}
              label={LAYERS.find(l => l.id === data.layer_type)?.label + ' 凡例'}
            />
          )}
        </div>
      )}
    </div>
  )
}
