import { useState, useRef, useEffect } from 'react'

export default function AddressSearch({ onSelect }) {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen]       = useState(false)
  const timerRef              = useRef(null)
  const wrapperRef            = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const search = async (q) => {
    if (q.trim().length < 2) { setResults([]); setOpen(false); return }
    setLoading(true)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=6&countrycodes=jp`,
        { headers: { 'Accept-Language': 'ja' } }
      )
      const data = await res.json()
      setResults(data)
      setOpen(data.length > 0)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    const val = e.target.value
    setQuery(val)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => search(val), 400)
  }

  const handleSelect = (r) => {
    setQuery(r.display_name.split(',')[0])
    setOpen(false)
    const lat = parseFloat(r.lat)
    const lon = parseFloat(r.lon)
    const bb  = r.boundingbox
    const bbox = bb
      ? [parseFloat(bb[2]), parseFloat(bb[0]), parseFloat(bb[3]), parseFloat(bb[1])]
      : undefined
    onSelect(lat, lon, bbox)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && results.length > 0) handleSelect(results[0])
    if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div className="flex items-center gap-2 bg-white border rounded-xl px-3 py-2 shadow-sm">
        <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="住所・地名で検索（例: 鶴岡市、庄内平野）"
          className="flex-1 text-sm outline-none bg-transparent placeholder-gray-400"
        />
        {loading && (
          <svg className="w-4 h-4 text-gray-400 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
        )}
        {query && !loading && (
          <button onClick={() => { setQuery(''); setResults([]); setOpen(false) }}
            className="text-gray-400 hover:text-gray-600 shrink-0">✕</button>
        )}
      </div>

      {open && (
        <ul className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-xl shadow-lg z-[2000] max-h-60 overflow-y-auto">
          {results.map(r => (
            <li key={r.place_id}>
              <button
                onClick={() => handleSelect(r)}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-green-50 flex flex-col gap-0.5 border-b last:border-0"
              >
                <span className="font-medium text-gray-800 truncate">
                  {r.display_name.split(',')[0]}
                </span>
                <span className="text-xs text-gray-400 truncate">
                  {r.display_name.split(',').slice(1, 3).join(',')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
