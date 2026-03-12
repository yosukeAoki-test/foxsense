import { useEffect, useState } from 'react'

const STEPS = [
  { text: '衛星シーンを検索中...', sub: 'Planetary Computer / Sentinel-2' },
  { text: 'バンドデータを取得中...', sub: 'B04 B08 B03 B05 B11 を並列取得' },
  { text: 'NDVI / NDWI を計算中...', sub: 'ピクセル単位で植生・水分指数を算出' },
  { text: '統計を集計中...', sub: 'ポリゴン内ピクセルのみ対象' },
]

export default function SatelliteLoader({ label }) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setStep(s => (s + 1) % STEPS.length)
    }, 2800)
    return () => clearInterval(timer)
  }, [])

  const current = STEPS[step]

  return (
    <div className="flex flex-col items-center justify-center py-10 gap-5">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-2 border-green-200 animate-ping opacity-40" />
        <div className="absolute inset-2 rounded-full border-2 border-green-300 animate-ping opacity-30"
             style={{ animationDelay: '0.5s' }} />
        <div className="w-16 h-16 flex items-center justify-center text-3xl">🛰</div>
        <div className="absolute inset-0 animate-spin" style={{ animationDuration: '3s' }}>
          <div className="absolute top-0 left-1/2 w-2 h-2 -ml-1 -mt-1 bg-green-400 rounded-full" />
        </div>
      </div>

      <div className="text-center transition-all duration-500">
        <p className="text-sm font-medium text-gray-700">{label ?? current.text}</p>
        <p className="text-xs text-gray-400 mt-1">{current.sub}</p>
      </div>

      <div className="w-48 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-green-500 rounded-full"
          style={{
            width: `${((step + 1) / STEPS.length) * 100}%`,
            transition: 'width 2.8s ease-in-out',
          }}
        />
      </div>

      <p className="text-xs text-gray-300">10〜20秒ほどお待ちください</p>
    </div>
  )
}
