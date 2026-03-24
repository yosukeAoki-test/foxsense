import { useSatelliteApi } from '../../hooks/useSatelliteApi'
import SatelliteLoader from './SatelliteLoader'

export default function BoundaryPanel({ selectedArea, activePolygon, mapRef }) {
  const { data, loading, error, post } = useSatelliteApi()

  if (!selectedArea) return null

  const detect = () => post('/boundary/detect', {
    bbox: selectedArea.bbox,
    polygon: activePolygon,
    min_area_ha: 0.01,
  })

  const showOnMap = () => {
    if (!data?.preview_image) return
    mapRef.current?.setOverlay(data.preview_image, selectedArea.bbox)
  }

  const clearMap = () => mapRef.current?.clearOverlay()

  return (
    <div className="space-y-3">
      <button
        onClick={detect}
        disabled={loading}
        className="w-full bg-purple-600 text-white py-2.5 rounded-lg font-medium text-sm disabled:opacity-50"
      >
        {loading ? '衛星画像を解析中...' : '圃場境界線を自動検出'}
      </button>
      {error && <p className="text-xs text-red-500 bg-red-50 rounded p-2">{error}</p>}
      {loading && <SatelliteLoader label="NDVI 勾配解析で圃場境界を検出中..." />}

      {data && !loading && (
        <div className="space-y-3">
          {/* サマリー */}
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold text-gray-800">検出結果</p>
              <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                {data.meta?.total_fields ?? data.features?.length ?? 0} 区画
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
              <div>
                <p className="text-gray-400">衛星観測日</p>
                <p className="font-medium">{data.scene_date}</p>
              </div>
              <div>
                <p className="text-gray-400">雲量</p>
                <p className="font-medium">{data.cloud_cover?.toFixed(0)}%</p>
              </div>
              <div>
                <p className="text-gray-400">検出手法</p>
                <p className="font-medium">NDVI watershed</p>
              </div>
              <div>
                <p className="text-gray-400">解像度</p>
                <p className="font-medium">10m/px (Sentinel-2)</p>
              </div>
            </div>
          </div>

          {/* 地図表示ボタン */}
          {data.preview_image && (
            <div className="flex gap-2">
              <button
                onClick={showOnMap}
                className="flex-1 bg-purple-600 text-white py-2 rounded-lg text-xs font-medium"
              >
                地図に表示
              </button>
              <button
                onClick={clearMap}
                className="px-4 py-2 rounded-lg border text-xs text-gray-500"
              >
                消去
              </button>
            </div>
          )}

          {/* 区画一覧 */}
          {data.features?.length > 0 ? (
            <div className="bg-white rounded-xl border overflow-hidden">
              <p className="text-xs text-gray-400 px-4 py-2 bg-gray-50 border-b">
                検出区画一覧（面積順）
              </p>
              <div className="divide-y max-h-64 overflow-y-auto">
                {data.features.map((f, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div>
                      <p className="font-medium text-gray-700">{f.properties.field_id}</p>
                      <p className="text-xs text-gray-400">{f.properties.crop}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-gray-800">{f.properties.area_ha} ha</p>
                      {f.properties.ndvi_mean != null && (
                        <p className="text-xs text-green-600">
                          NDVI {f.properties.ndvi_mean.toFixed(3)}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-gray-50 rounded-xl border p-4 text-xs text-gray-400 text-center">
              選択エリアで圃場境界が検出できませんでした。<br />
              より拡大した範囲を選択するか、農地のある地域で試してください。
            </div>
          )}

          <p className="text-xs text-gray-300 text-center">
            ※ NDVI勾配解析による自動検出。精度は衛星観測日の雲量・地表状態に依存します。
          </p>
        </div>
      )}
    </div>
  )
}
