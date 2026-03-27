import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import L from 'leaflet'
import '@geoman-io/leaflet-geoman-free'
import 'leaflet/dist/leaflet.css'
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const PM_LANG_JA = {
  tooltips: {
    placeMarker:       'クリックしてマーカーを配置',
    firstVertex:       'クリックして開始点を配置',
    continueLine:      'クリックして頂点を追加',
    finishLine:        '最初の点をクリックして完成',
    finishPoly:        '最初の点をクリックして完成',
    finishRect:        'クリックして矩形を完成',
    startCircle:       'クリックして円の中心を配置',
    finishCircle:      'クリックして円を完成',
    placeCircleMarker: 'クリックして配置',
  },
  actions: {
    finish:  '完了',
    cancel:  'キャンセル',
    removeLastVertex: '最後の点を削除',
  },
  buttonTitles: {
    drawMarkerButton:       'マーカーを描く',
    drawPolyButton:         'ポリゴンを描く',
    drawLineButton:         'ラインを描く',
    drawCircleButton:       '円を描く',
    drawRectButton:         '矩形を描く',
    drawCircleMarkerButton: '円マーカーを描く',
    editButton:             '図形を編集',
    dragButton:             '図形を移動',
    cutButton:              '図形を切り抜く',
    deleteButton:           '図形を削除',
    drawTextButton:         'テキストを描く',
    rotateButton:           '図形を回転',
  },
}

function calcAreaHa(layer) {
  const bounds = layer.getBounds?.()
  if (!bounds) return 0
  const latDiff = Math.abs(bounds.getNorth() - bounds.getSouth())
  const lonDiff = Math.abs(bounds.getEast()  - bounds.getWest())
  const latM = latDiff * 111320
  const lonM = lonDiff * 111320 * Math.cos(bounds.getCenter().lat * Math.PI / 180)
  return Math.round(latM * lonM / 10000 * 10) / 10
}

const SATELLITE_BASE   = import.meta.env.VITE_SATELLITE_API_URL || '/api'
const SATELLITE_APIKEY = import.meta.env.VITE_SATELLITE_API_KEY || ''

const CROP_COLOR = {
  '水稲': { color: '#047857', fillColor: '#10b981' },
  '大豆': { color: '#b45309', fillColor: '#f59e0b' },
  '小麦': { color: '#c2410c', fillColor: '#f97316' },
  '野菜': { color: '#0f766e', fillColor: '#14b8a6' },
}
const DEFAULT_FIELD_COLOR = { color: '#4b5563', fillColor: '#9ca3af' }

const FieldMap = forwardRef(function FieldMap({ lat, lon, onAreaSelected, onParcelSelected }, ref) {
  const divRef              = useRef(null)
  const mapRef              = useRef(null)
  const parcelLayerRef      = useRef(null)
  const selectedLayerRef    = useRef(null)
  const overlayLayerRef     = useRef(null)
  const selectedParcelLayer = useRef(null)
  const savedFieldLayersRef = useRef(new Map()) // fieldId -> L.polygon

  const makeFieldPolygon = (field, highlighted = false) => {
    const bbox = typeof field.bbox === 'string' ? JSON.parse(field.bbox) : field.bbox
    const raw = field.polygon
      ? (typeof field.polygon === 'string' ? JSON.parse(field.polygon) : field.polygon)
      : null
    const coords = raw ?? [
      [bbox[0], bbox[1]], [bbox[2], bbox[1]],
      [bbox[2], bbox[3]], [bbox[0], bbox[3]],
      [bbox[0], bbox[1]],
    ]
    const latlngs = coords.map(([lng, lat]) => [lat, lng])
    const { color, fillColor } = CROP_COLOR[field.cropType] ?? DEFAULT_FIELD_COLOR
    const layer = L.polygon(latlngs, {
      color, fillColor,
      weight: highlighted ? 3 : 1.5,
      fillOpacity: highlighted ? 0.55 : 0.25,
      opacity: highlighted ? 1 : 0.6,
    })
    const label = `<b>${field.name}</b><br>${field.cropType ?? ''} ${field.areaHa ? field.areaHa + ' ha' : ''}`
    layer.bindTooltip(label, { permanent: highlighted, direction: 'center', className: 'field-label' })
    return layer
  }

  useImperativeHandle(ref, () => ({
    flyTo: (lat, lon, zoom = 14) => mapRef.current?.flyTo([lat, lon], zoom),
    fitBbox: (bbox) => {
      mapRef.current?.fitBounds(
        [[bbox[1], bbox[0]], [bbox[3], bbox[2]]],
        { padding: [30, 30] }
      )
    },
    showAllSavedFields: (fields) => {
      const map = mapRef.current
      if (!map) return
      savedFieldLayersRef.current.forEach(l => map.removeLayer(l))
      savedFieldLayersRef.current.clear()
      fields.forEach(field => {
        const layer = makeFieldPolygon(field, false)
        layer._fieldData = field
        layer.addTo(map)
        savedFieldLayersRef.current.set(field.id, layer)
      })
    },
    highlightSavedField: (field) => {
      const map = mapRef.current
      if (!map) return
      // 全レイヤーを薄く戻す
      savedFieldLayersRef.current.forEach(layer => {
        const f = layer._fieldData
        const { color, fillColor } = CROP_COLOR[f?.cropType] ?? DEFAULT_FIELD_COLOR
        layer.setStyle({ color, fillColor, weight: 1.5, fillOpacity: 0.2, opacity: 0.5 })
        layer.closeTooltip()
      })
      // 対象をハイライト
      const target = savedFieldLayersRef.current.get(field.id)
      if (target) {
        const { color, fillColor } = CROP_COLOR[field.cropType] ?? DEFAULT_FIELD_COLOR
        target.setStyle({ color, fillColor, weight: 3, fillOpacity: 0.55, opacity: 1 })
        target.openTooltip()
        target.bringToFront()
      }
    },
    setOverlay: (base64png, bbox) => {
      const map = mapRef.current
      if (!map) return
      if (overlayLayerRef.current) map.removeLayer(overlayLayerRef.current)
      // 選択域・保存済み圃場ポリゴンをすべて非表示
      if (selectedLayerRef.current) selectedLayerRef.current.setStyle({ opacity: 0, fillOpacity: 0 })
      savedFieldLayersRef.current.forEach(l => l.setStyle({ opacity: 0, fillOpacity: 0 }))
      const bounds = [[bbox[1], bbox[0]], [bbox[3], bbox[2]]]
      overlayLayerRef.current = L.imageOverlay(
        `data:image/png;base64,${base64png}`,
        bounds,
        { opacity: 0.85, interactive: false }
      ).addTo(map)
      // オーバーレイが見えるよう地図をフィット
      map.fitBounds(bounds, { padding: [20, 20] })
    },
    clearOverlay: () => {
      if (overlayLayerRef.current && mapRef.current) {
        mapRef.current.removeLayer(overlayLayerRef.current)
        overlayLayerRef.current = null
      }
      // 選択域を再表示
      if (selectedLayerRef.current) {
        selectedLayerRef.current.setStyle({ opacity: 1, fillOpacity: 0.2 })
      }
      // 保存済み圃場ポリゴンを元のスタイルに戻す
      savedFieldLayersRef.current.forEach(layer => {
        const f = layer._fieldData
        const { color, fillColor } = CROP_COLOR[f?.cropType] ?? DEFAULT_FIELD_COLOR
        layer.setStyle({ color, fillColor, weight: 1.5, opacity: 0.6, fillOpacity: 0.25 })
      })
    },
  }))

  useEffect(() => {
    if (!divRef.current || mapRef.current) return

    const map = L.map(divRef.current).setView([lat, lon], 13)

    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    })
    const satellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: '© Esri' }
    )
    osm.addTo(map)
    L.control.layers({ '地図': osm, '衛星画像': satellite }).addTo(map)

    map.pm.setLang('ja', PM_LANG_JA, 'en')
    map.pm.addControls({
      position:         'topleft',
      drawMarker:       false,
      drawCircle:       false,
      drawCircleMarker: false,
      drawPolyline:     false,
      drawText:         false,
      rotateMode:       false,
      cutPolygon:       false,
      dragMode:         false,
      drawRectangle:    true,
      drawPolygon:      true,
      editMode:         true,
      removalMode:      true,
    })
    map.pm.setGlobalOptions({ snapDistance: 5 })

    map.on('pm:create', (e) => {
      if (selectedLayerRef.current) map.removeLayer(selectedLayerRef.current)
      selectedLayerRef.current = e.layer

      const bounds = e.layer.getBounds()
      const bbox = [
        bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(),
      ]

      let polygon
      if (e.shape === 'Polygon') {
        const latlngs = e.layer.getLatLngs()[0]
        polygon = latlngs.map(ll => [ll.lng, ll.lat])
        if (polygon.length > 0) polygon.push(polygon[0])
      } else {
        polygon = [
          [bounds.getWest(),  bounds.getSouth()],
          [bounds.getEast(),  bounds.getSouth()],
          [bounds.getEast(),  bounds.getNorth()],
          [bounds.getWest(),  bounds.getNorth()],
          [bounds.getWest(),  bounds.getSouth()],
        ]
      }

      onAreaSelected?.({
        bbox,
        areaHa: calcAreaHa(e.layer),
        type: e.shape === 'Rectangle' ? 'rectangle' : 'polygon',
        polygon,
      })
      loadParcels(map, bbox)
    })

    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [lat, lon])

  const loadParcels = async (map, bbox) => {
    if (parcelLayerRef.current) map.removeLayer(parcelLayerRef.current)
    try {
      const [lonMin, latMin, lonMax, latMax] = bbox
      const res = await fetch(
        `${SATELLITE_BASE}/fields/parcels?lon_min=${lonMin}&lat_min=${latMin}&lon_max=${lonMax}&lat_max=${latMax}`,
        { headers: { 'X-API-Key': SATELLITE_APIKEY } }
      )
      const geojson = await res.json()
      if (!geojson.features?.length) return

      const selectParcel = (feature, lyr) => {
        if (selectedParcelLayer.current) {
          selectedParcelLayer.current.setStyle({ fillColor: '#4caf50', fillOpacity: 0.3, color: '#1a6b1a' })
        }
        lyr.setStyle({ fillColor: '#ff9800', fillOpacity: 0.6, color: '#e65100' })
        selectedParcelLayer.current = lyr
        onParcelSelected?.(feature)
      }

      const layer = L.geoJSON(geojson, {
        style: () => ({ color: '#1a6b1a', weight: 1.5, fillColor: '#4caf50', fillOpacity: 0.3 }),
        onEachFeature: (feature, lyr) => {
          const p = feature.properties
          lyr.bindTooltip(`${p.crop} / ${p.area_ha}ha`, { sticky: true })
          lyr.on('click', (e) => {
            L.DomEvent.stopPropagation(e)
            selectParcel(feature, lyr)
          })
          lyr.on('mouseover', () => { lyr.setStyle({ fillOpacity: 0.55 }) })
          lyr.on('mouseout', () => {
            if (selectedParcelLayer.current !== lyr) {
              lyr.setStyle({ fillOpacity: 0.3, fillColor: '#4caf50', color: '#1a6b1a' })
            }
          })
        },
      }).addTo(map)

      parcelLayerRef.current = layer
      map.fitBounds(layer.getBounds(), { padding: [20, 20] })
    } catch (e) {
      console.warn('parcel load failed', e)
    }
  }

  return (
    <div className="relative">
      <div ref={divRef} className="w-full h-[420px]" />
      <div className="absolute bottom-2 right-2 bg-white/90 rounded-lg px-2 py-1 text-xs text-gray-500 z-[1000] pointer-events-none">
        矩形/ポリゴンで範囲選択 → 農地区画が表示されます
      </div>
    </div>
  )
})

export default FieldMap
