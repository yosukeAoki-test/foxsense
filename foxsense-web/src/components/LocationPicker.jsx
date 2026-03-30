import { useState, useEffect } from 'react';
import { MapPin, Plus, Loader2, Check, ChevronDown } from 'lucide-react';
import { locationsApi } from '../api/client';

/**
 * 地点セレクター
 * 既存地点の選択 + 新規地点のインライン作成
 *
 * Props:
 *   value       - 現在選択中の locationId (string | null)
 *   onChange    - (locationId: string | null) => void
 */
const LocationPicker = ({ value, onChange }) => {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [form, setForm] = useState({ name: '', latitude: '', longitude: '', address: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [geoLoading, setGeoLoading] = useState(false);

  useEffect(() => {
    locationsApi.getAll()
      .then(setLocations)
      .catch(() => setLocations([]))
      .finally(() => setLoading(false));
  }, []);

  const handleGeolocate = () => {
    if (!navigator.geolocation) return;
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm(f => ({
          ...f,
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        }));
        setGeoLoading(false);
      },
      () => setGeoLoading(false)
    );
  };

  const handleCreate = async () => {
    const lat = parseFloat(form.latitude);
    const lon = parseFloat(form.longitude);
    if (!form.name.trim() || isNaN(lat) || isNaN(lon)) {
      setError('地点名・緯度・経度は必須です');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const loc = await locationsApi.create({
        name: form.name.trim(),
        latitude: lat,
        longitude: lon,
        address: form.address.trim() || undefined,
      });
      setLocations(prev => [...prev, loc].sort((a, b) => a.name.localeCompare(b.name)));
      onChange(loc.id);
      setShowNewForm(false);
      setForm({ name: '', latitude: '', longitude: '', address: '' });
    } catch {
      setError('地点の作成に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const selected = locations.find(l => l.id === value);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />地点を読み込み中…
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* セレクト */}
      <div className="relative">
        <select
          value={value || ''}
          onChange={e => {
            if (e.target.value === '__new__') {
              setShowNewForm(true);
            } else {
              onChange(e.target.value || null);
              setShowNewForm(false);
            }
          }}
          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none text-sm appearance-none bg-white pr-8"
        >
          <option value="">地点を選択しない</option>
          {locations.map(loc => (
            <option key={loc.id} value={loc.id}>
              {loc.name}（{loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}）
            </option>
          ))}
          <option value="__new__">＋ 新しい地点を追加…</option>
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
      </div>

      {/* 選択中地点の座標表示 */}
      {selected && !showNewForm && (
        <div className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 px-2.5 py-1.5 rounded-lg">
          <MapPin className="w-3 h-3 flex-shrink-0" />
          {selected.name}：{selected.latitude.toFixed(5)}, {selected.longitude.toFixed(5)}
          {selected.address && <span className="text-blue-400 ml-1">({selected.address})</span>}
        </div>
      )}

      {/* 新規作成フォーム */}
      {showNewForm && (
        <div className="border border-blue-100 rounded-xl p-3 bg-blue-50/50 space-y-2">
          <p className="text-xs font-medium text-blue-700 mb-1">新しい地点を追加</p>

          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}

          <input
            type="text"
            placeholder="地点名 *（例: 第1農場）"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-blue-400"
          />

          <div className="flex gap-2">
            <input
              type="number"
              placeholder="緯度 * (例: 35.6895)"
              value={form.latitude}
              onChange={e => setForm(f => ({ ...f, latitude: e.target.value }))}
              step="0.000001"
              className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-blue-400"
            />
            <input
              type="number"
              placeholder="経度 * (例: 139.6917)"
              value={form.longitude}
              onChange={e => setForm(f => ({ ...f, longitude: e.target.value }))}
              step="0.000001"
              className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-blue-400"
            />
            <button
              type="button"
              onClick={handleGeolocate}
              disabled={geoLoading}
              title="現在地を使用"
              className="px-2.5 py-2 rounded-lg border border-gray-200 text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-white transition-colors flex-shrink-0"
            >
              {geoLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
            </button>
          </div>

          <input
            type="text"
            placeholder="住所（任意）"
            value={form.address}
            onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-blue-400"
          />

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={saving}
              className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              追加
            </button>
            <button
              type="button"
              onClick={() => { setShowNewForm(false); setError(''); setForm({ name: '', latitude: '', longitude: '', address: '' }); }}
              className="flex-1 py-2 rounded-lg border border-gray-200 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LocationPicker;
