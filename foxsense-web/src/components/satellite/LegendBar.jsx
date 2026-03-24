/**
 * カラーマップ凡例コンポーネント
 * legend: [{ value: string, color: string }, ...] の配列を受け取り
 * グラデーションバー + 5点ラベルで表示する
 */
export default function LegendBar({ legend, label }) {
  if (!legend || legend.length === 0) return null

  // 表示するラベル位置：最小・25%・中央・75%・最大 の5点
  const n = legend.length
  const labelIndices = [
    0,
    Math.round(n * 0.25),
    Math.round(n * 0.5),
    Math.round(n * 0.75),
    n - 1,
  ]

  return (
    <div className="rounded-xl border bg-white p-3 space-y-1.5">
      {label && <p className="text-xs font-medium text-gray-500">{label}</p>}

      {/* グラデーションバー */}
      <div
        className="h-5 rounded overflow-hidden"
        style={{
          background: `linear-gradient(to right, ${legend.map(t => t.color).join(', ')})`,
        }}
      />

      {/* 目盛りラベル */}
      <div className="relative h-4">
        {labelIndices.map((idx, i) => {
          const percent = n === 1 ? 0 : (idx / (n - 1)) * 100
          return (
            <span
              key={i}
              className="absolute text-xs font-medium text-gray-600 -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${percent}%` }}
            >
              {legend[idx].value}
            </span>
          )
        })}
      </div>
    </div>
  )
}
