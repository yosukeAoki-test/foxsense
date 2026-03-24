import { useEffect } from 'react'
import { useSatelliteApi } from '../../hooks/useSatelliteApi'
import SatelliteLoader from './SatelliteLoader'

const RATING_STYLE = {
  S: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300' },
  A: { bg: 'bg-blue-100',  text: 'text-blue-700',  border: 'border-blue-300'  },
  B: { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-300' },
  C: { bg: 'bg-red-100',   text: 'text-red-700',   border: 'border-red-300'   },
}

const DOW = ['日', '月', '火', '水', '木', '金', '土']

function dayLabel(dateStr) {
  const d = new Date(dateStr)
  const today = new Date()
  today.setHours(0,0,0,0)
  const diff = Math.round((d - today) / 86400000)
  if (diff === 0) return '今日'
  if (diff === 1) return '明日'
  return `${d.getMonth()+1}/${d.getDate()}(${DOW[d.getDay()]})`
}

export default function SprayWeatherPanel({ selectedArea }) {
  const { data, loading, error, post } = useSatelliteApi()

  useEffect(() => {
    if (selectedArea) {
      post('/weather/spray', { bbox: selectedArea.bbox })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedArea?.bbox?.join(',')])

  if (!selectedArea) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-gray-800">散布天気予報（7日間）</p>
        <button
          onClick={() => post('/weather/spray', { bbox: selectedArea.bbox })}
          disabled={loading}
          className="text-xs text-green-600 border border-green-300 rounded px-2 py-0.5 disabled:opacity-40"
        >
          更新
        </button>
      </div>

      {loading && <SatelliteLoader label="天気データを取得中..." />}
      {error && <p className="text-xs text-red-500 bg-red-50 rounded p-2">{error}</p>}

      {data?.forecast && !loading && (
        <>
          {/* 本日のハイライト */}
          {data.forecast[0] && (() => {
            const d = data.forecast[0]
            const s = RATING_STYLE[d.rating]
            return (
              <div className={`rounded-xl border-2 p-4 ${s.bg} ${s.border}`}>
                <div className="flex items-center justify-between mb-2">
                  <p className={`text-base font-bold ${s.text}`}>{d.label}</p>
                  <span className="text-xs text-gray-500">本日</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-xs text-gray-700">
                  <div>💨 風速 <strong>{d.wind_max} m/s</strong></div>
                  <div>🌧 降水 <strong>{d.precip} mm</strong></div>
                  <div>🌡 気温 <strong>{d.temp_min}〜{d.temp_max}°C</strong></div>
                  <div>💧 湿度 <strong>{d.humid_max}%</strong></div>
                  {d.sunrise && <div>🌅 日の出 <strong>{d.sunrise}</strong></div>}
                  {d.sunset  && <div>🌆 日の入 <strong>{d.sunset}</strong></div>}
                </div>
                {d.issues.length > 0 && (
                  <p className={`mt-2 text-xs ${s.text}`}>⚠️ {d.issues.join(' / ')}</p>
                )}
              </div>
            )
          })()}

          {/* 7日間カレンダー */}
          <div className="rounded-xl border bg-white overflow-hidden">
            <p className="text-xs text-gray-400 px-3 py-2 bg-gray-50 border-b">7日間予報</p>
            <div className="divide-y">
              {data.forecast.map((d, i) => {
                const s = RATING_STYLE[d.rating]
                return (
                  <div key={i} className="flex items-center px-3 py-2.5 gap-3">
                    <span className="text-xs text-gray-600 w-16 shrink-0">{dayLabel(d.date)}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.bg} ${s.text} w-16 text-center shrink-0`}>
                      {d.label}
                    </span>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                      <span>💨{d.wind_max}m/s</span>
                      <span>🌧{d.precip}mm</span>
                      <span>🌡{d.temp_max}°C</span>
                      <span>💧{d.humid_max}%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 散布条件の目安 */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700 space-y-1">
            <p className="font-bold">散布適性の目安</p>
            <p>◎ 最適: 風速&lt;3m/s・降水なし・気温10〜35°C・湿度&lt;90%</p>
            <p>△ 注意: 風速3〜5m/s または小雨</p>
            <p>× NG: 風速≥5m/s または降水≥1mm</p>
          </div>
        </>
      )}
    </div>
  )
}
