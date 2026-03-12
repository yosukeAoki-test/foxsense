import { useState, useRef } from 'react'
import FieldMap from '../components/satellite/FieldMap'
import AddressSearch from '../components/satellite/AddressSearch'
import NDVIChart from '../components/satellite/NDVIChart'
import FarmerSummary from '../components/satellite/FarmerSummary'
import DrainagePanel from '../components/satellite/DrainagePanel'
import CarbonPanel from '../components/satellite/CarbonPanel'
import AnalysisPanel from '../components/satellite/AnalysisPanel'
import SatelliteLoader from '../components/satellite/SatelliteLoader'
import { useSatelliteApi } from '../hooks/useSatelliteApi'

const DEFAULT_CENTER = { lat: 38.73, lon: 139.83 }

const TABS = [
  { id: 'ndvi',     label: 'NDVI 生育' },
  { id: 'drainage', label: '中干し' },
  { id: 'carbon',   label: 'CO2試算' },
  { id: 'analysis', label: '圃場解析' },
]

export default function SatellitePage() {
  const [tab, setTab] = useState('ndvi')
  const [expertMode, setExpertMode] = useState(false)
  const mapRef = useRef(null)
  const [selectedArea, setSelectedArea] = useState(null)
  const [selectedParcel, setSelectedParcel] = useState(null)

  const now = new Date()
  const season = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
  const [startDate, setStartDate] = useState(`${season}-05-01`)
  const [endDate, setEndDate]     = useState(`${season}-09-30`)

  const ndvi     = useSatelliteApi()
  const drainage = useSatelliteApi()

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
      cloud_max: 30,
    })
  }

  const fetchDrainage = () => {
    if (!selectedArea) return
    drainage.post('/drainage/polygon', {
      bbox: selectedArea.bbox,
      polygon: activePolygon,
      year: season,
      cloud_max: 30,
    })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ページヘッダー */}
      <div className="bg-green-700 text-white px-4 py-3">
        <h2 className="text-base font-bold">農地衛星モニタリング</h2>
        <p className="text-green-200 text-xs mt-0.5">Sentinel-2 衛星データ × カーボンクレジット試算</p>
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
      <div className="flex bg-white border-b sticky top-0 z-10">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-3 text-xs font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-green-600 text-green-700'
                : 'border-transparent text-gray-400'
            }`}
          >
            {t.label}
          </button>
        ))}
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

        {/* 中干し検出タブ */}
        {tab === 'drainage' && selectedArea && (
          <div className="space-y-3">
            <button onClick={fetchDrainage} disabled={drainage.loading}
              className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium text-sm disabled:opacity-50">
              {drainage.loading ? '解析中...' : `${season}年の中干し期間を検出`}
            </button>
            {drainage.error && <p className="text-xs text-red-500 bg-red-50 rounded p-2">{drainage.error}</p>}
            {drainage.loading && <SatelliteLoader label="中干し期間を衛星データから検出中..." />}
            {drainage.data && !drainage.loading && <DrainagePanel data={drainage.data} areaHa={areaHa} />}
          </div>
        )}

        {/* CO2試算タブ */}
        {tab === 'carbon' && (
          <CarbonPanel
            areaHa={areaHa}
            drainageDays={drainage.data?.drainage_detection?.duration_days ?? null}
          />
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
      </div>
    </div>
  )
}
