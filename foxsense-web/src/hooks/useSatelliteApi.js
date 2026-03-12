import { useState } from 'react'

const BASE = import.meta.env.VITE_SATELLITE_API_URL || '/api'

export function useSatelliteApi() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const get = async (path) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${BASE}${path}`)
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.detail ?? 'エラーが発生しました')
      }
      setData(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const post = async (path, body) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.detail ?? 'エラーが発生しました')
      }
      const json = await res.json()
      setData(json)
      return json
    } catch (e) {
      setError(e.message)
      return null
    } finally {
      setLoading(false)
    }
  }

  return { data, loading, error, get, post }
}
