import DmrvCertificate from './DmrvCertificate'

export default function DrainagePanel({ data, areaHa }) {
  const d = data.drainage_detection

  return (
    <div className="space-y-3">
      <div className={`rounded-xl border p-4 ${d.detected ? 'bg-blue-50 border-blue-200' : 'bg-gray-50'}`}>
        <p className="text-xs text-gray-400 mb-1">中干し期間 検出結果</p>
        {d.detected ? (
          <>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm text-blue-600 font-medium">{d.start} 〜 {d.end}</p>
              {d.confidence && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                  d.confidence === 'high'   ? 'bg-green-100 text-green-700' :
                  d.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                              'bg-gray-100 text-gray-500'
                }`}>
                  信頼度: {d.confidence === 'high' ? '高' : d.confidence === 'medium' ? '中' : '低'}
                </span>
              )}
            </div>
            <p className="text-4xl font-bold text-blue-800 mt-1">
              {d.duration_days}
              <span className="text-lg font-normal ml-1">日間</span>
            </p>
            <p className="text-xs text-blue-400 mt-1">（標準7日超 +{Math.max(0, d.duration_days - 7)}日）</p>
            {d.note && <p className="text-xs text-gray-400 mt-1">{d.note}</p>}
          </>
        ) : (
          <div>
            <p className="text-gray-500 text-sm">中干し期間を検出できませんでした</p>
            {d.note && <p className="text-xs text-gray-400 mt-1">{d.note}</p>}
          </div>
        )}
      </div>

      <DmrvCertificate data={data} areaHa={areaHa} />

      <details className="bg-white rounded-xl border overflow-hidden">
        <summary className="text-xs text-gray-400 px-4 py-2 bg-gray-50 cursor-pointer select-none">
          観測生データを見る（NDWI値）
        </summary>
        <div className="divide-y max-h-52 overflow-y-auto">
          {data.time_series.map((row, i) => (
            <div key={i} className="flex justify-between items-center px-4 py-2 text-xs">
              <span className="text-gray-500 w-24 shrink-0">{row.date}</span>
              <span className={`font-mono px-2 py-0.5 rounded ${
                row.ndwi_mean > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
              }`}>
                NDWI {row.ndwi_mean?.toFixed(3) ?? '--'}
              </span>
              <span className="font-mono text-green-700">
                NDVI {row.ndvi_mean?.toFixed(3) ?? '--'}
              </span>
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}
