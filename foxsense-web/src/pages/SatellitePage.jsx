import { useState, useRef, useEffect } from 'react'
import FieldMap from '../components/satellite/FieldMap'
import AddressSearch from '../components/satellite/AddressSearch'
import NDVIChart from '../components/satellite/NDVIChart'
import FarmerSummary from '../components/satellite/FarmerSummary'
import AnalysisPanel from '../components/satellite/AnalysisPanel'
import SatelliteLoader from '../components/satellite/SatelliteLoader'
import DiseaseRiskPanel from '../components/satellite/DiseaseRiskPanel'
import { useSatelliteApi } from '../hooks/useSatelliteApi'
import MyFieldsPanel, { SaveFieldModal } from '../components/satellite/MyFieldsPanel'
import { fieldsApi } from '../api/fields'
import MapLayersPanel from '../components/satellite/MapLayersPanel'
import SprayWeatherPanel from '../components/satellite/SprayWeatherPanel'
import { foxCoinApi } from '../api/client'

const DEFAULT_CENTER = { lat: 38.73, lon: 139.83 }

const TABS = [
  { id: 'myfields', label: '圃場管理' },
  { id: 'ndvi',     label: 'NDVI 生育' },
  { id: 'analysis', label: '圃場解析' },
  { id: 'disease',  label: '病害予測' },
  { id: 'maplayers', label: 'マップ' },
  { id: 'spray',    label: '散布予報' },
]

export default function SatellitePage() {
  const [tab, setTab] = useState('myfields')
  const [expertMode, setExpertMode] = useState(false)
  const mapRef = useRef(null)
  const [selectedArea, setSelectedArea] = useState(null)
  const [selectedParcel, setSelectedParcel] = useState(null)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [coinBalance, setCoinBalance] = useState(null)
  const [coinLoading, setCoinLoading] = useState(true)
  const [coinError, setCoinError] = useState(false)

  useEffect(() => {
    foxCoinApi.getBalance()
      .then(data => { setCoinBalance(data); setCoinError(false) })
      .catch(() => { setCoinError(true); setCoinBalance(null) })
      .finally(() => setCoinLoading(false))
  }, [])

  const now = new Date()
  const season = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
  const [startDate, setStartDate] = useState(`${season}-05-01`)
  const [endDate, setEndDate]     = useState(`${season}-09-30`)

  const ndvi = useSatelliteApi()

  const areaHa = selectedParcel?.properties?.area_ha ?? selectedArea?.areaHa ?? 1.0

  const activePolygon =
    selectedParcel?.geometry?.coordinates?.[0] ?? selectedArea?.polygon ?? null

  const fetchNdvi = () => {
    if (!selectedArea) return
    ndvi.post('/ndvi/bbox', {
      bbox: selectedArea.bbox,
      polygon: activePolygon,
      start_date: startDate,
      end_date: endDate,
      cloud_max: 60,
    })
  }

  if (coinLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (coinError) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-green-700 text-white px-4 py-3">
          <h2 className="text-base font-bold">農地衛星モニタリング</h2>
          <p className="text-green-200 text-xs mt-0.5">Sentinel-2 / NASA HLS 衛星データによる農地モニタリング</p>
        </div>
        <div className="flex flex-col items-center justify-center p-10 text-center gap-4">
          <div className="text-4xl">⚠️</div>
          <h3 className="text-lg font-bold text-gray-700">接続エラー</h3>
          <p className="text-sm text-gray-500">残高情報を取得できませんでした。ネットワークを確認してページを再読み込みしてください。</p>
          <button onClick={() => window.location.reload()}
            className="mt-2 bg-green-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium">
            再読み込み
          </button>
        </div>
      </div>
    )
  }

  if (coinBalance && coinBalance.balance <= 0) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-green-700 text-white px-4 py-3">
          <h2 className="text-base font-bold">農地衛星モニタリング</h2>
          <p className="text-green-200 text-xs mt-0.5">Sentinel-2 / NASA HLS 衛星データによる農地モニタリング</p>
        </div>
        <div className="flex flex-col items-center justify-center p-10 text-center gap-4">
          <div className="text-5xl">🪙</div>
          <h3 className="text-lg font-bold text-gray-700">FoxCoin が必要です</h3>
          <p className="text-sm text-gray-500">
            衛星モニタリング機能を利用するには FoxCoin の残高が必要です。<br />
            ダッシュボードのコインアイコンから購入してください。
          </p>
          <a
            href="/"
            className="mt-2 bg-green-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium"
          >
            ダッシュボードへ戻る
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ページヘッダー */}
      <div className="bg-green-700 text-white px-4 py-3">
        <h2 className="text-base font-bold">農地衛星モニタリング</h2>
        <p className="text-green-200 text-xs mt-0.5">Sentinel-2 / NASA HLS 衛星データによる農地モニタリング</p>
      </div>

      {/* 選択状態バー */}
      <div className="bg-white border-b px-4 py-2 flex flex-wrap items-center gap-2 text-xs">
        {selectedParcel ? (
          <>
            <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
              区画選択中: {selectedParcel.properties.field_id}
            </span>
            <span className="text-gray-400">|</span>
            <span className="text-gray-600">{selectedParcel.properties.crop}</span>
            <span className="text-gray-400">|</span>
            <span className="text-gray-600">{selectedParcel.properties.area_ha} ha</span>
          </>
        ) : selectedArea ? (
          <>
            <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              エリア選択中
            </span>
            <span className="text-gray-400">|</span>
            <span className="text-gray-600">
              {selectedArea.bbox.map(v => v.toFixed(4)).join(', ')}
            </span>
            <span className="text-gray-400">|</span>
            <span className="text-gray-600">{selectedArea.areaHa} ha</span>
          </>
        ) : (
          <span className="text-gray-400">地図上で矩形またはポリゴンを描画してエリアを選択してください</span>
        )}
      </div>

      {/* 住所検索 */}
      <div className="bg-white border-b px-3 py-2">
        <AddressSearch
          onSelect={(lat, lon, bbox) => {
            if (bbox) mapRef.current?.fitBbox(bbox)
            else mapRef.current?.flyTo(lat, lon, 14)
          }}
        />
      </div>

      {/* 地図 */}
      <FieldMap
        ref={mapRef}
        lat={DEFAULT_CENTER.lat}
        lon={DEFAULT_CENTER.lon}
        onAreaSelected={area => {
          setSelectedArea(area)
          setSelectedParcel(null)
        }}
        onParcelSelected={parcel => {
          setSelectedParcel(parcel)
        }}
      />

      {/* タブ */}
      <div className="bg-white border-b sticky top-0 z-10 overflow-x-auto">
        <div className="flex min-w-max">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-3 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
                tab === t.id
                  ? 'border-green-600 text-green-700'
                  : 'border-transparent text-gray-400'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* コンテンツ */}
      <div className="p-4 max-w-2xl mx-auto space-y-3">

        {/* 未選択ガイド */}
        {!selectedArea && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-700 text-center">
            地図上で矩形ツール（□）またはポリゴンツール（△）で<br />
            解析したいエリアを描いてください
          </div>
        )}

        {/* NDVI タブ */}
        {tab === 'ndvi' && selectedArea && (
          <div className="space-y-3">
            <div className="flex gap-2 items-center">
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="border rounded-lg px-2 py-1.5 text-xs flex-1" />
              <span className="text-gray-400 text-xs">〜</span>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="border rounded-lg px-2 py-1.5 text-xs flex-1" />
              <button onClick={fetchNdvi} disabled={ndvi.loading}
                className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 whitespace-nowrap">
                {ndvi.loading ? '取得中...' : '取得'}
              </button>
            </div>
            {ndvi.error && <p className="text-xs text-red-500 bg-red-50 rounded p-2">{ndvi.error}</p>}
            {ndvi.loading && <SatelliteLoader />}
            {ndvi.data && !ndvi.loading && (
              <>
                <div className="flex rounded-lg border overflow-hidden text-xs">
                  <button
                    onClick={() => setExpertMode(false)}
                    className={`flex-1 py-1.5 font-medium transition-colors ${!expertMode ? 'bg-green-600 text-white' : 'text-gray-400'}`}
                  >
                    農家向け診断
                  </button>
                  <button
                    onClick={() => setExpertMode(true)}
                    className={`flex-1 py-1.5 font-medium transition-colors ${expertMode ? 'bg-green-600 text-white' : 'text-gray-400'}`}
                  >
                    詳細データ
                  </button>
                </div>
                {expertMode
                  ? <NDVIChart data={ndvi.data} />
                  : <FarmerSummary ndvi={ndvi.data} areaHa={areaHa} />
                }
              </>
            )}
          </div>
        )}

        {/* 圃場解析タブ */}
        {tab === 'analysis' && (
          <AnalysisPanel
            selectedArea={selectedArea}
            startDate={startDate}
            endDate={endDate}
            mapRef={mapRef}
            activePolygon={activePolygon}
          />
        )}

        {/* 病害リスク予測タブ */}
        {tab === 'disease' && (
          <DiseaseRiskPanel
            selectedArea={selectedArea}
            startDate={startDate}
            endDate={endDate}
            activePolygon={activePolygon}
          />
        )}

        {/* マップレイヤータブ */}
        {tab === 'maplayers' && (
          <MapLayersPanel
            selectedArea={selectedArea}
            activePolygon={activePolygon}
            mapRef={mapRef}
          />
        )}

        {/* 散布予報タブ */}
        {tab === 'spray' && (
          <SprayWeatherPanel
            selectedArea={selectedArea}
          />
        )}

        {/* 圃場管理タブ */}
        {tab === 'myfields' && (
          <MyFieldsPanel
            pendingArea={selectedArea}
            activePolygon={activePolygon}
            mapRef={mapRef}
            onSaveRequest={() => setShowSaveModal(true)}
            onLoad={field => {
              const bbox = JSON.parse(field.bbox)
              mapRef.current?.fitBbox(bbox)
              mapRef.current?.highlightSavedField(field)
              setSelectedArea({
                bbox,
                areaHa: field.areaHa ?? 1,
                polygon: field.polygon ? JSON.parse(field.polygon) : null,
              })
            }}
          />
        )}
      </div>

      {/* 保存モーダル */}
      {showSaveModal && (
        <SaveFieldModal
          area={selectedArea}
          onSave={data => fieldsApi.create(data)}
          onClose={() => setShowSaveModal(false)}
        />
      )}
    </div>
  )
}
