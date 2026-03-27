import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'

const STATUS_COLOR = {
  良好: 'text-green-600 bg-green-50',
  普通: 'text-yellow-600 bg-yellow-50',
  やや不良: 'text-orange-600 bg-orange-50',
  不良: 'text-red-600 bg-red-50',
}

const fmt = (v) => v != null ? v.toFixed(3) : '-'

export default function NDVIChart({ data }) {
  const chartData = [...data.scenes].reverse().map(s => ({
    date: s.datetime.slice(5),
    ndvi: s.ndvi?.mean != null ? +s.ndvi.mean.toFixed(3) : null,
    ndwi: s.ndwi_mean != null ? +s.ndwi_mean.toFixed(3) : null,
    ndre: s.ndre_mean != null ? +s.ndre_mean.toFixed(3) : null,
    ndmi: s.ndmi_mean != null ? +s.ndmi_mean.toFixed(3) : null,
  }))

  const latest = data.scenes[data.scenes.length - 1]

  return (
    <div className="space-y-3">
      {latest && (
        <div className="bg-white rounded-xl border p-4 flex justify-between items-center">
          <div>
            <p className="text-xs text-gray-400">最新観測日</p>
            <p className="font-semibold text-gray-700">{latest.datetime}</p>
            <p className="text-3xl font-bold text-green-700 mt-1">{fmt(latest.ndvi?.mean)}</p>
            <p className="text-xs text-gray-400 mt-0.5">NDVI</p>
          </div>
          <div className="text-right space-y-2">
            <span className={`text-sm font-medium px-3 py-1 rounded-full ${STATUS_COLOR[latest.status] ?? 'text-gray-500 bg-gray-50'}`}>
              {latest.status}
            </span>
            <p className="text-xs text-gray-400">雲量 {latest.cloud_cover?.toFixed(0)}%</p>
          </div>
        </div>
      )}

      {latest && (
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-white rounded-xl border p-3">
            <p className="text-xs text-gray-400">NDWI <span className="text-blue-400">水面</span></p>
            <p className="text-xl font-bold text-blue-700 mt-1">{fmt(latest.ndwi_mean)}</p>
            <p className="text-xs text-gray-400 mt-0.5">正値 = 湛水</p>
          </div>
          <div className="bg-white rounded-xl border p-3">
            <p className="text-xs text-gray-400">NDRE <span className="text-purple-400">窒素状態</span></p>
            <p className="text-xl font-bold text-purple-700 mt-1">{fmt(latest.ndre_mean)}</p>
            <p className="text-xs text-gray-400 mt-0.5">葉クロロフィル</p>
          </div>
          <div className="bg-white rounded-xl border p-3">
            <p className="text-xs text-gray-400">NDMI <span className="text-cyan-400">水分ストレス</span></p>
            <p className="text-xl font-bold text-cyan-700 mt-1">{fmt(latest.ndmi_mean)}</p>
            <p className="text-xs text-gray-400 mt-0.5">正値 = 水分豊富</p>
          </div>
          <div className="bg-white rounded-xl border p-3">
            <p className="text-xs text-gray-400">植生面積率</p>
            <p className="text-xl font-bold text-green-700 mt-1">
              {latest.ndvi?.vegetation_ratio != null
                ? (latest.ndvi.vegetation_ratio * 100).toFixed(1) + '%'
                : '-'}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">NDVI {'>'} 0.3</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border p-4">
        <p className="text-sm font-medium text-gray-600 mb-3">植生指数 時系列</p>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis domain={[-0.3, 1]} tick={{ fontSize: 10 }} />
            <Tooltip />
            <ReferenceLine y={0.6} stroke="#16a34a" strokeDasharray="4 4" />
            <ReferenceLine y={0} stroke="#999" strokeDasharray="2 2" />
            <Line type="monotone" dataKey="ndvi" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} name="NDVI" connectNulls />
            <Line type="monotone" dataKey="ndwi" stroke="#2563eb" strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="5 3" name="NDWI" connectNulls />
            <Line type="monotone" dataKey="ndre" stroke="#9333ea" strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="3 2" name="NDRE" connectNulls />
            <Line type="monotone" dataKey="ndmi" stroke="#0891b2" strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="2 4" name="NDMI" connectNulls />
          </LineChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-400">
          <span><span className="text-green-600">■</span> NDVI 植生</span>
          <span><span className="text-blue-600">■</span> NDWI 水面</span>
          <span><span className="text-purple-600">■</span> NDRE 窒素</span>
          <span><span className="text-cyan-600">■</span> NDMI 水分</span>
        </div>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <p className="text-xs text-gray-400 px-4 py-2 border-b bg-gray-50">取得シーン: {data.scene_count} 件</p>
        <div className="divide-y max-h-48 overflow-y-auto">
          {data.scenes.map((s, i) => (
            <div key={i} className="flex justify-between items-center px-4 py-2 text-sm">
              <span className="text-gray-600">{s.datetime}</span>
              <span className="font-mono text-green-700">{fmt(s.ndvi?.mean)}</span>
              <span className="font-mono text-purple-600 text-xs">{fmt(s.ndre_mean)}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[s.status] ?? ''}`}>{s.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
