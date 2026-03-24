import { useState, useEffect } from 'react'
import { fieldsApi } from '../../api/fields'
import { useSatelliteApi } from '../../hooks/useSatelliteApi'
import SatelliteLoader from './SatelliteLoader'

const CROP_OPTIONS = ['水稲', '大豆', '小麦', '野菜', 'その他']
const SATELLITE_API_READY = !!import.meta.env.VITE_SATELLITE_API_URL

const CROP_STYLE = {
  '水稲': { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-l-emerald-400' },
  '大豆': { bg: 'bg-amber-100',   text: 'text-amber-700',   border: 'border-l-amber-400'   },
  '小麦': { bg: 'bg-orange-100',  text: 'text-orange-700',  border: 'border-l-orange-400'  },
  '野菜': { bg: 'bg-teal-100',    text: 'text-teal-700',    border: 'border-l-teal-400'    },
  'その他':{ bg: 'bg-gray-100',   text: 'text-gray-500',    border: 'border-l-gray-300'    },
}

function getCropStyle(cropType) {
  return CROP_STYLE[cropType] ?? CROP_STYLE['その他']
}

export default function MyFieldsPanel({ onLoad, onSaveRequest, pendingArea, activePolygon, mapRef }) {
  const [fields, setFields]   = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [showBoundary, setShowBoundary] = useState(false)
  const boundary = useSatelliteApi()

  const load = async () => {
    setLoading(true)
    try {
      const data = await fieldsApi.list()
      setFields(data)
      mapRef?.current?.showAllSavedFields(data)
    } catch {
      setError('圃場一覧の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (id) => {
    if (!confirm('この圃場を削除しますか？')) return
    await fieldsApi.remove(id)
    const updated = fields.filter(x => x.id !== id)
    setFields(updated)
    mapRef?.current?.showAllSavedFields(updated)
  }

  const detectBoundary = () => {
    if (!pendingArea) return
    boundary.post('/boundary/detect', {
      bbox: pendingArea.bbox,
      polygon: activePolygon,
      min_area_ha: 0.01,
    })
  }

  const showOnMap = () => {
    if (!boundary.data?.preview_image) return
    mapRef.current?.setOverlay(boundary.data.preview_image, pendingArea.bbox)
  }

  const clearMap = () => mapRef.current?.clearOverlay()

  return (
    <div className="space-y-4">

      {/* 保存ボタン */}
      {pendingArea && (
        <button
          onClick={onSaveRequest}
          className="w-full bg-green-600 text-white py-2.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2"
        >
          <span>＋</span> 選択中のエリアを圃場として保存
        </button>
      )}

      {/* 境界線検出セクション */}
      {pendingArea && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700"
            onClick={() => setShowBoundary(v => !v)}
          >
            <span className="flex items-center gap-2">
              <span className="text-purple-500">⬡</span> 圃場境界線を自動検出
            </span>
            <span className="text-gray-400 text-xs">{showBoundary ? '▲' : '▼'}</span>
          </button>

          {showBoundary && (
            <div className="border-t px-4 pb-4 pt-3 space-y-3">
              <p className="text-xs text-gray-400">
                選択エリアの衛星画像をNDVI勾配解析し、圃場の境界線を自動で検出します。
              </p>
              {!SATELLITE_API_READY ? (
                <div className="bg-gray-50 border border-dashed rounded-lg p-3 text-center text-xs text-gray-400">
                  衛星解析バックエンド（VITE_SATELLITE_API_URL）が未設定です
                </div>
              ) : (
                <button
                  onClick={detectBoundary}
                  disabled={boundary.loading}
                  className="w-full bg-purple-600 text-white py-2.5 rounded-lg font-medium text-sm disabled:opacity-50"
                >
                  {boundary.loading ? '衛星画像を解析中...' : '境界線を検出する'}
                </button>
              )}
              {boundary.error && (
                <p className="text-xs text-red-500 bg-red-50 rounded p-2">{boundary.error}</p>
              )}
              {boundary.loading && (
                <SatelliteLoader label="NDVI 勾配解析で圃場境界を検出中..." />
              )}

              {boundary.data && !boundary.loading && (
                <div className="space-y-3">
                  <div className="bg-purple-50 border border-purple-200 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-bold text-gray-800">検出結果</p>
                      <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                        {boundary.data.meta?.total_fields ?? boundary.data.features?.length ?? 0} 区画
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                      <div>
                        <p className="text-gray-400">観測日</p>
                        <p className="font-medium">{boundary.data.scene_date}</p>
                      </div>
                      <div>
                        <p className="text-gray-400">雲量</p>
                        <p className="font-medium">{boundary.data.cloud_cover?.toFixed(0)}%</p>
                      </div>
                    </div>
                  </div>

                  {boundary.data.preview_image && (
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

                  {boundary.data.features?.length > 0 && (
                    <div className="bg-gray-50 rounded-xl border overflow-hidden">
                      <p className="text-xs text-gray-400 px-3 py-2 border-b bg-white">
                        検出区画一覧（面積順）
                      </p>
                      <div className="divide-y max-h-48 overflow-y-auto">
                        {boundary.data.features.map((f, i) => (
                          <div key={i} className="flex items-center justify-between px-3 py-2 text-sm bg-white">
                            <p className="font-medium text-gray-700">{f.properties.field_id}</p>
                            <div className="text-right">
                              <p className="font-semibold text-gray-800">{f.properties.area_ha} ha</p>
                              {f.properties.ndvi_mean != null && (
                                <p className="text-xs text-green-600">NDVI {f.properties.ndvi_mean.toFixed(3)}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 保存済み圃場一覧 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">保存済み圃場</p>
          {fields.length > 0 && (
            <span className="text-xs text-gray-400">{fields.length} 件</span>
          )}
        </div>

        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

        {loading ? (
          <p className="text-xs text-gray-400 text-center py-6">読み込み中...</p>
        ) : fields.length === 0 ? (
          <div className="bg-gray-50 rounded-xl border border-dashed p-6 text-center text-xs text-gray-400 space-y-1">
            <p className="text-2xl">🌾</p>
            <p className="font-medium text-gray-500">圃場が登録されていません</p>
            <p>地図でエリアを選択して「保存」してください</p>
          </div>
        ) : (
          <div className="space-y-2">
            {fields.map(f => {
              const style = getCropStyle(f.cropType)
              return (
                <div
                  key={f.id}
                  className={`bg-white rounded-xl border border-l-4 ${style.border} p-3 flex items-center gap-3`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-gray-800 truncate">{f.name}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {f.cropType && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${style.bg} ${style.text}`}>
                          {f.cropType}
                        </span>
                      )}
                      {f.areaHa ? (
                        <span className="text-xs text-gray-500 font-medium">
                          {f.areaHa} ha
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">面積不明</span>
                      )}
                    </div>
                    {f.note && (
                      <p className="text-xs text-gray-400 mt-1 truncate">{f.note}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => onLoad(f)}
                      className="bg-green-50 text-green-700 border border-green-200 px-3 py-1.5 rounded-lg text-xs font-medium"
                    >
                      地図へ
                    </button>
                    <button
                      onClick={() => handleDelete(f.id)}
                      className="text-gray-300 hover:text-red-400 px-1.5 py-1 text-xs"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}


export function SaveFieldModal({ area, onSave, onClose }) {
  const [name, setName]       = useState('')
  const [cropType, setCrop]   = useState('水稲')
  const [note, setNote]       = useState('')
  const [saving, setSaving]   = useState(false)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await onSave({ name: name.trim(), cropType, note, areaHa: area.areaHa, bbox: area.bbox, polygon: area.polygon })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[9999] flex items-end justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-4">
        <p className="font-bold text-gray-800">圃場を登録</p>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500">圃場名 *</label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例：自宅前の田んぼ"
              className="w-full mt-1 border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">作物</label>
            <select
              value={cropType}
              onChange={e => setCrop(e.target.value)}
              className="w-full mt-1 border rounded-lg px-3 py-2 text-sm"
            >
              {CROP_OPTIONS.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">メモ（任意）</label>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="例：圃場番号A-3"
              className="w-full mt-1 border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          {area && (
            <p className="text-xs text-gray-400">面積: {area.areaHa} ha</p>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 border rounded-lg py-2.5 text-sm text-gray-500"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="flex-1 bg-green-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
