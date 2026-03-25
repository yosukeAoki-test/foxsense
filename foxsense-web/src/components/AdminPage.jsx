import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Radio, BarChart3, Package, ArrowLeft, Trash2,
  ShieldCheck, ShieldOff, Coins, Loader2, AlertCircle,
  ChevronDown, Plus, Minus, RefreshCw, Cpu, Edit2, Check, X, KeyRound, Link,
  Tag, Printer, RotateCcw, Database,
} from 'lucide-react';
import QRCode from 'react-qr-code';
import client, { adminInventoryApi, printApi } from '../api/client';

const api = {
  get: (url) => client.get(url).then(r => r.data.data),
  post: (url, d) => client.post(url, d).then(r => r.data.data),
  put: (url, d) => client.put(url, d).then(r => r.data.data),
  delete: (url) => client.delete(url).then(r => r.data),
};

// ===== 統計タブ =====
const StatsTab = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/stats').then(setStats).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  if (!stats) return null;

  const cards = [
    { label: '総ユーザー数', value: stats.users.total, icon: Users, color: 'blue' },
    { label: '親機', value: stats.devices.parents, icon: Radio, color: 'green' },
    { label: '子機', value: stats.devices.children, icon: Cpu, color: 'green' },
    { label: 'アクティブSIM', value: stats.sim.active, icon: ShieldCheck, color: 'emerald' },
    { label: '停止中SIM', value: stats.sim.suspended, icon: ShieldOff, color: 'red' },
    { label: '発行済みFoxCoin', value: stats.foxCoins.totalIssued, icon: Coins, color: 'yellow' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {cards.map(c => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="bg-white rounded-xl border p-4">
              <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg bg-${c.color}-100 mb-3`}>
                <Icon className={`w-5 h-5 text-${c.color}-600`} />
              </div>
              <div className="text-2xl font-bold text-gray-900">{c.value}</div>
              <div className="text-sm text-gray-500">{c.label}</div>
            </div>
          );
        })}
      </div>

      {stats.foxCoins.recentPurchases.length > 0 && (
        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-semibold text-gray-800 mb-3">最近の購入</h3>
          <div className="space-y-2">
            {stats.foxCoins.recentPurchases.map(p => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium text-gray-700">{p.user.name}</span>
                  <span className="text-gray-400 ml-2">{p.user.email}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-yellow-600">+{p.coins} FC</span>
                  <span className="text-gray-400">{new Date(p.purchasedAt).toLocaleDateString('ja-JP')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ===== ユーザー一覧タブ =====
const UsersTab = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [coinModal, setCoinModal] = useState(null); // { userId, name }
  const [coinAmount, setCoinAmount] = useState(0);
  const [coinNote, setCoinNote] = useState('');
  const [processing, setProcessing] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/admin/users').then(setUsers).catch(() => setError('取得失敗')).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const handleDelete = async (userId, name) => {
    if (!window.confirm(`「${name}」を削除しますか？この操作は取り消せません。`)) return;
    try {
      await api.delete(`/admin/users/${userId}`);
      load();
    } catch (e) {
      setError(e.response?.data?.message || '削除失敗');
    }
  };

  const handleRoleToggle = async (userId, currentRole) => {
    const newRole = currentRole === 'ADMIN' ? 'USER' : 'ADMIN';
    if (!window.confirm(`権限を ${newRole} に変更しますか？`)) return;
    try {
      await api.put(`/admin/users/${userId}/role`, { role: newRole });
      load();
    } catch { setError('権限変更失敗'); }
  };

  const handleCoinAdjust = async () => {
    if (!coinModal || coinAmount === 0) return;
    setProcessing(true);
    try {
      await api.post(`/admin/users/${coinModal.userId}/coins`, { coins: coinAmount, note: coinNote });
      setCoinModal(null); setCoinAmount(0); setCoinNote('');
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'コイン操作失敗');
    } finally { setProcessing(false); }
  };

  const simStatusColor = { ACTIVE: 'green', SUSPENDED: 'yellow', INACTIVE: 'gray' };
  const simStatusLabel = { ACTIVE: '通信中', SUSPENDED: '停止中', INACTIVE: '未設定' };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;

  return (
    <div>
      {error && <div className="flex items-center gap-2 p-3 bg-red-50 rounded-lg text-red-600 text-sm mb-4"><AlertCircle className="w-4 h-4" />{error}</div>}

      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              {['名前・メール', '権限', 'デバイス', 'FoxCoin', 'SIM', '操作'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map(u => {
              const sc = simStatusColor[u.simStatus] || 'gray';
              return (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{u.name}</div>
                    <div className="text-xs text-gray-500">{u.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleRoleToggle(u.id, u.role)}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                        u.role === 'ADMIN' ? 'bg-purple-100 text-purple-700 hover:bg-purple-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}>
                      {u.role === 'ADMIN' ? <ShieldCheck className="w-3 h-3" /> : <ShieldOff className="w-3 h-3" />}
                      {u.role}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    <span title="親機"><Radio className="w-3.5 h-3.5 inline mr-1 text-blue-500" />{u.parentCount}</span>
                    <span className="mx-2 text-gray-300">|</span>
                    <span title="子機"><Cpu className="w-3.5 h-3.5 inline mr-1 text-green-500" />{u.childCount}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Coins className="w-3.5 h-3.5 text-yellow-500" />
                      <span className="font-semibold">{u.foxCoins}</span>
                      <button onClick={() => setCoinModal({ userId: u.id, name: u.name })}
                        className="ml-1 p-1 rounded hover:bg-yellow-50 text-yellow-500 transition-colors">
                        <Edit2 className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-${sc}-100 text-${sc}-700`}>
                      {simStatusLabel[u.simStatus]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleDelete(u.id, u.name)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* FoxCoin 調整モーダル */}
      {coinModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="font-bold text-gray-900 mb-1">FoxCoin 調整</h3>
            <p className="text-sm text-gray-500 mb-4">{coinModal.name}</p>
            <div className="flex items-center gap-3 mb-3">
              <button onClick={() => setCoinAmount(a => a - 10)} className="p-2 rounded-lg border hover:bg-gray-50"><Minus className="w-4 h-4" /></button>
              <button onClick={() => setCoinAmount(a => a - 1)} className="p-2 rounded-lg border hover:bg-gray-50"><Minus className="w-3 h-3" /></button>
              <span className={`flex-1 text-center text-2xl font-bold ${coinAmount >= 0 ? 'text-green-600' : 'text-red-600'}`}>{coinAmount > 0 ? '+' : ''}{coinAmount}</span>
              <button onClick={() => setCoinAmount(a => a + 1)} className="p-2 rounded-lg border hover:bg-gray-50"><Plus className="w-3 h-3" /></button>
              <button onClick={() => setCoinAmount(a => a + 10)} className="p-2 rounded-lg border hover:bg-gray-50"><Plus className="w-4 h-4" /></button>
            </div>
            <div className="flex gap-2 mb-3">
              {[30, 100, 200, 300].map(n => (
                <button key={n} onClick={() => setCoinAmount(n)} className="flex-1 py-1.5 text-xs rounded-lg border hover:bg-green-50 hover:border-green-400 hover:text-green-600 transition-colors">+{n}</button>
              ))}
            </div>
            <input type="text" value={coinNote} onChange={e => setCoinNote(e.target.value)}
              placeholder="備考（任意）"
              className="w-full px-3 py-2 rounded-lg border text-sm mb-4 focus:outline-none focus:border-blue-400" />
            <div className="flex gap-2">
              <button onClick={() => { setCoinModal(null); setCoinAmount(0); setCoinNote(''); }}
                className="flex-1 py-2 rounded-xl border text-gray-600 hover:bg-gray-50 text-sm">キャンセル</button>
              <button onClick={handleCoinAdjust} disabled={coinAmount === 0 || processing}
                className="flex-1 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 text-sm flex items-center justify-center gap-1">
                {processing && <Loader2 className="w-4 h-4 animate-spin" />}適用
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ===== デバイス一覧タブ =====
const DevicesTab = () => {
  const [devices, setDevices] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ownerFilter, setOwnerFilter] = useState('');

  useEffect(() => {
    api.get('/admin/devices').then(setDevices).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  if (!devices) return null;

  const q = ownerFilter.trim().toLowerCase();
  const filteredParents = q
    ? devices.parents.filter(p => p.owner.email.toLowerCase().includes(q) || p.owner.name.toLowerCase().includes(q))
    : devices.parents;
  const filteredOrphans = q
    ? devices.orphanChildren.filter(c => c.owner.email.toLowerCase().includes(q) || c.owner.name.toLowerCase().includes(q))
    : devices.orphanChildren;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          type="text" value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}
          placeholder="オーナーで絞り込み（メール・名前）"
          className="flex-1 px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:border-blue-400"
        />
        {ownerFilter && (
          <button onClick={() => setOwnerFilter('')} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50 flex items-center gap-2">
          <Radio className="w-4 h-4 text-blue-600" />
          <h3 className="font-semibold text-gray-800 text-sm">親機一覧 ({filteredParents.length}台{q ? ` / 全${devices.parents.length}台` : ''})</h3>
        </div>
        <div className="divide-y">
          {filteredParents.map(p => (
            <div key={p.id} className="px-4 py-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium text-gray-900">{p.name}</div>
                  <div className="text-xs text-gray-400 font-mono">ID: {p.deviceId}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    オーナー: {p.owner.name} ({p.owner.email})
                  </div>
                </div>
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">子機 {p.activeChildCount}台</span>
              </div>
              {p.activeChildren.length > 0 && (
                <div className="mt-2 pl-3 border-l-2 border-blue-200 space-y-1">
                  {p.activeChildren.map(c => (
                    <div key={c.id} className="text-xs text-gray-600">
                      <span className="font-mono">{c.deviceId}</span> — {c.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {filteredOrphans.length > 0 && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-gray-500" />
            <h3 className="font-semibold text-gray-800 text-sm">未紐付け子機 ({filteredOrphans.length}台)</h3>
          </div>
          <div className="divide-y">
            {filteredOrphans.map(c => (
              <div key={c.id} className="px-4 py-3">
                <div className="font-medium text-gray-900">{c.name}</div>
                <div className="text-xs text-gray-400 font-mono">ID: {c.deviceId}</div>
                <div className="text-xs text-gray-500">オーナー: {c.owner.name}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ===== ラベル発行タブ =====
const TAPE_SIZES = [
  { label: '18mm', mm: 18, width: '70mm', height: '18mm', qr: 40, fontSize: '6px', idFontSize: '5.5px' },
  { label: '12mm', mm: 12, width: '55mm', height: '12mm', qr: 28, fontSize: '5px', idFontSize: '4.5px' },
  { label: '9mm',  mm: 9,  width: '45mm', height: '9mm',  qr: 20, fontSize: '4.5px', idFontSize: '4px' },
];

const BRIDGE_URL = 'http://localhost:3333';

const randomHex = (len) => {
  const chars = '0123456789ABCDEF';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * 16)]).join('');
};

// ===== TWELITE R2 Web Serial ハードウェアアドレス取得 =====
// 子機起動時のシリアル出力 "HWADDR:XXXXXXXX" を読み取る
const HWADDR_RE = /HWADDR:([0-9A-Fa-f]{8})/;

const LabelsTab = () => {
  const [deviceType, setDeviceType] = useState('PARENT');
  const [count, setCount] = useState(5);
  const [tapeSize, setTapeSize] = useState(TAPE_SIZES[0]);
  const [labels, setLabels] = useState([]);
  const [registering, setRegistering] = useState(false);
  const [registerResult, setRegisterResult] = useState(null);
  const [error, setError] = useState('');
  const [inventory, setInventory] = useState([]);
  const [loadingInv, setLoadingInv] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState(null); // null | 'ok' | 'error'
  const [bridgePrinting, setBridgePrinting] = useState(false);
  const [bridgeProgress, setBridgeProgress] = useState('');
  const [r2Detecting, setR2Detecting] = useState(false);
  const [r2Status, setR2Status] = useState(''); // 検出状況メッセージ
  const [availableSims, setAvailableSims] = useState(null); // null=未ロード, []=ロード済み
  const [loadingSims, setLoadingSims] = useState(false);
  const printRef = useRef(null);

  const loadInventory = useCallback(() => {
    setLoadingInv(true);
    adminInventoryApi.list().then(setInventory).catch(() => {}).finally(() => setLoadingInv(false));
  }, []);

  useEffect(() => { loadInventory(); }, [loadInventory]);

  useEffect(() => {
    if (deviceType !== 'PARENT' || availableSims !== null) return;
    setLoadingSims(true);
    adminInventoryApi.getAvailableSims()
      .then(setAvailableSims)
      .catch(() => setAvailableSims([]))
      .finally(() => setLoadingSims(false));
  }, [deviceType, availableSims]);

  const refreshSims = async () => {
    setLoadingSims(true);
    try {
      const sims = await adminInventoryApi.getAvailableSims();
      setAvailableSims(sims);
    } catch {
      setAvailableSims([]);
    } finally {
      setLoadingSims(false);
    }
  };

  const checkBridge = useCallback(async () => {
    try {
      const { alive } = await printApi.getBridgeStatus();
      setBridgeStatus(alive ? 'ok' : 'error');
    } catch {
      setBridgeStatus('error');
    }
  }, []);

  useEffect(() => { checkBridge(); }, [checkBridge]);

  const generate = () => {
    setRegisterResult(null);
    setError('');
    const existingIds = new Set([
      ...inventory.map(i => i.deviceId),
      ...labels.map(l => l.deviceId),
    ]);
    const newLabels = [];
    let attempts = 0;
    while (newLabels.length < count && attempts < 10000) {
      const id = randomHex(8);
      if (!existingIds.has(id)) {
        existingIds.add(id);
        newLabels.push({ deviceId: id, type: deviceType, imsi: '' });
      }
      attempts++;
    }
    setLabels(newLabels);
  };

  const handleR2Detect = async () => {
    if (!('serial' in navigator)) {
      setError('Web Serial APIはChrome/Edgeが必要です（Chrome/Edgeをご使用ください）');
      return;
    }
    setR2Status('');
    setError('');
    let port;
    try {
      port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
    } catch (e) {
      setError('ポートを開けませんでした: ' + e.message);
      return;
    }
    setR2Detecting(true);
    setR2Status('アドレスを要求中...');
    try {
      const writer = port.writable.getWriter();
      await writer.write(new Uint8Array([0x3F])); // '?'
      writer.releaseLock();
    } catch {}
    setR2Status('子機の電源を入れるか、既に起動済みなら数秒待ってください...');

    const existingIds = new Set([
      ...inventory.map(i => i.deviceId),
      ...labels.map(l => l.deviceId),
    ]);
    let lineBuffer = '';
    let newCount = 0;
    const decoder = new TextDecoder();
    const reader = port.readable.getReader();
    const timer = setTimeout(() => reader.cancel(), 30000);
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop();
        for (const line of lines) {
          const m = line.match(HWADDR_RE);
          if (m) {
            const id = m[1].toUpperCase();
            if (!existingIds.has(id)) {
              existingIds.add(id);
              setLabels(prev => [...prev, { deviceId: id, type: 'CHILD', imsi: '' }]);
              newCount++;
              setR2Status(`検出: ${id} — 電源を入れ直すと次の子機を追加できます`);
            }
          }
        }
      }
    } catch {}
    clearTimeout(timer);
    try { reader.releaseLock(); } catch {}
    try { await port.close(); } catch {}
    setR2Detecting(false);
    setR2Status(newCount > 0 ? `完了: ${newCount}台を追加しました` : '検出されませんでした（子機の電源を確認してください）');
  };

  const handleRemove = (idx) => {
    setLabels(prev => prev.filter((_, i) => i !== idx));
  };

  const handleImsiChange = (idx, value) => {
    setLabels(prev => prev.map((l, i) => i === idx ? { ...l, imsi: value } : l));
  };

  const handlePrint = () => {
    const tape = tapeSize;
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: white; }
  .page { display: flex; flex-wrap: wrap; gap: 2mm; padding: 2mm; }
  .label {
    width: ${tape.width};
    height: ${tape.height};
    border: 0.3mm solid #ccc;
    display: flex;
    align-items: center;
    gap: 1mm;
    padding: 1mm;
    overflow: hidden;
    page-break-inside: avoid;
  }
  .label svg { flex-shrink: 0; }
  .label-text { display: flex; flex-direction: column; gap: 0.5mm; min-width: 0; }
  .label-brand { font-family: sans-serif; font-weight: bold; font-size: ${tape.fontSize}; color: #1a1a1a; white-space: nowrap; }
  .label-type { font-family: sans-serif; font-size: ${tape.fontSize}; color: #555; white-space: nowrap; }
  .label-id { font-family: monospace; font-size: ${tape.idFontSize}; color: #333; word-break: break-all; letter-spacing: 0.3px; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<div class="page">
${labels.map(l => `  <div class="label">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tape.qr} ${tape.qr}" width="${tape.qr}" height="${tape.qr}">
      ${document.getElementById(`qr-${l.deviceId}`)?.innerHTML || ''}
    </svg>
    <div class="label-text">
      <span class="label-brand">FoxSense</span>
      <span class="label-type">${l.type === 'PARENT' ? '親機' : '子機'}</span>
      <span class="label-id">${l.deviceId}</span>
    </div>
  </div>`).join('\n')}
</div>
</body>
</html>`;

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    win.onload = () => { win.print(); };
  };

  const handleRegister = async () => {
    if (labels.length === 0) return;
    setRegistering(true);
    setError('');
    setRegisterResult(null);
    try {
      const result = await adminInventoryApi.bulkCreate(labels.map(l => ({ ...l, imsi: l.imsi || undefined })));
      setRegisterResult(result);
      loadInventory();
    } catch (e) {
      setError(e.response?.data?.message || '登録に失敗しました');
    } finally {
      setRegistering(false);
    }
  };

  const handleBridgePrint = async () => {
    if (labels.length === 0) return;
    setBridgePrinting(true);
    setError('');
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i];
      setBridgeProgress(`印刷中 ${i + 1} / ${labels.length}`);
      try {
        const job = await printApi.createJob(`QR:${l.deviceId}:${l.imsi || ''}`, tapeSize.mm);
        // 完了まで最大30秒ポーリング
        let done = false;
        for (let attempt = 0; attempt < 30 && !done; attempt++) {
          await new Promise(r => setTimeout(r, 1000));
          const j = await printApi.getJobById(job.id);
          if (j.status === 'done') { done = true; }
          else if (j.status === 'failed') { throw new Error(j.error || '印刷失敗'); }
        }
        if (!done) throw new Error('タイムアウト（30秒）');
        if (i < labels.length - 1) await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        setError(`${l.deviceId} の印刷に失敗: ${e.message}`);
        break;
      }
    }
    setBridgePrinting(false);
    setBridgeProgress('');
  };

  const handleDeleteInventory = async (id) => {
    if (!window.confirm('この在庫IDを削除しますか？')) return;
    try {
      await adminInventoryApi.delete(id);
      loadInventory();
    } catch (e) {
      setError(e.response?.data?.message || '削除に失敗しました');
    }
  };

  const parents = inventory.filter(i => i.type === 'PARENT');
  const children = inventory.filter(i => i.type === 'CHILD');

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 rounded-lg text-red-600 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
        </div>
      )}

      {/* 生成パネル */}
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Tag className="w-4 h-4 text-blue-600" />ラベル発行
          </h3>
          <button onClick={checkBridge} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border hover:bg-gray-50 transition-colors text-gray-500">
            <span className={`w-2 h-2 rounded-full ${bridgeStatus === 'ok' ? 'bg-green-500' : bridgeStatus === 'no-device' ? 'bg-yellow-400' : bridgeStatus === 'error' ? 'bg-red-400' : 'bg-gray-300'}`} />
            {bridgeStatus === 'ok' ? 'テプラ接続中' : bridgeStatus === 'no-device' ? 'テプラ未検出' : bridgeStatus === 'error' ? 'ブリッジ未起動' : '確認中...'}
          </button>
        </div>

        <div className="flex flex-wrap gap-3 mb-4">
          {/* タイプ選択 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">デバイス種別</label>
            <div className="flex rounded-lg border overflow-hidden">
              {[['PARENT', '親機'], ['CHILD', '子機']].map(([val, label]) => (
                <button key={val} onClick={() => setDeviceType(val)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${deviceType === val ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* テープ幅 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">テープ幅</label>
            <div className="flex rounded-lg border overflow-hidden">
              {TAPE_SIZES.map(t => (
                <button key={t.label} onClick={() => setTapeSize(t)}
                  className={`px-3 py-2 text-sm font-medium transition-colors ${tapeSize.label === t.label ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {deviceType === 'PARENT' && (<>
            {/* 枚数 */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">発行枚数</label>
              <div className="flex items-center gap-1">
                <button onClick={() => setCount(c => Math.max(1, c - 1))} className="w-8 h-9 rounded-lg border flex items-center justify-center hover:bg-gray-50"><Minus className="w-3 h-3" /></button>
                <input type="number" value={count} min={1} max={100}
                  onChange={e => setCount(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
                  className="w-16 text-center py-2 border rounded-lg text-sm outline-none focus:border-blue-400" />
                <button onClick={() => setCount(c => Math.min(100, c + 1))} className="w-8 h-9 rounded-lg border flex items-center justify-center hover:bg-gray-50"><Plus className="w-3 h-3" /></button>
              </div>
            </div>
            <div className="flex items-end">
              <button onClick={generate}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors">
                <RotateCcw className="w-4 h-4" />ID発行
              </button>
            </div>
          </>)}

          {deviceType === 'CHILD' && (
            <div className="flex items-end flex-col gap-1">
              <button onClick={handleR2Detect} disabled={r2Detecting}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50">
                {r2Detecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cpu className="w-4 h-4" />}
                R2で検出
              </button>
              {r2Status && <p className="text-xs text-emerald-700">{r2Status}</p>}
            </div>
          )}
        </div>

        {/* ラベルプレビュー */}
        {labels.length > 0 && (
          <>
            {deviceType === 'PARENT' && (
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-500">SIMを割り当てる場合は下のドロップダウンで選択してください</p>
                <button
                  type="button"
                  onClick={refreshSims}
                  disabled={loadingSims}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={`w-3 h-3 ${loadingSims ? 'animate-spin' : ''}`} />
                  SIM一覧を更新
                </button>
              </div>
            )}
            <div ref={printRef} className="flex flex-wrap gap-2 p-3 bg-gray-50 rounded-xl border border-dashed border-gray-300 mb-4 max-h-80 overflow-y-auto">
              {labels.map((l, idx) => (
                <div key={l.deviceId} className="relative bg-white border border-gray-200 rounded p-2 flex flex-col gap-1.5 group hover:border-blue-300 transition-colors">
                  <div className="flex items-center gap-2">
                    <div id={`qr-${l.deviceId}`}>
                      <QRCode value={l.deviceId} size={tapeSize.qr} level="M" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-gray-700">FoxSense</p>
                      <p className="text-xs text-gray-500">{l.type === 'PARENT' ? '親機' : '子機'}</p>
                      <p className="text-xs font-mono text-gray-800 tracking-wider">{l.deviceId}</p>
                    </div>
                  </div>
                  {l.type === 'PARENT' && (
                    loadingSims ? (
                      <div className="flex items-center gap-1 text-xs text-gray-400 py-1">
                        <Loader2 className="w-3 h-3 animate-spin" />SIM読み込み中...
                      </div>
                    ) : (
                      <select
                        value={l.imsi}
                        onChange={e => handleImsiChange(idx, e.target.value)}
                        className="w-full px-2 py-1 text-xs border border-gray-200 rounded font-mono focus:border-blue-400 outline-none bg-white"
                      >
                        <option value="">SIMなし（後で設定）</option>
                        {availableSims
                          ?.filter(s => s.imsi === l.imsi || !labels.some((lb, i) => i !== idx && lb.imsi === s.imsi))
                          .map(s => (
                            <option key={s.simId} value={s.imsi}>
                              {s.imsi}{s.groupName ? ` [${s.groupName}]` : ''}
                            </option>
                          ))
                        }
                        {l.imsi && !availableSims?.some(s => s.imsi === l.imsi) && (
                          <option value={l.imsi}>{l.imsi} ※未取得</option>
                        )}
                      </select>
                    )
                  )}
                  <button onClick={() => handleRemove(idx)}
                    className="absolute top-1 right-1 w-4 h-4 rounded-full bg-red-100 text-red-400 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-200">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>

            {registerResult && (
              <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg text-green-700 text-sm mb-3">
                <Check className="w-4 h-4 flex-shrink-0" />
                {registerResult.created}件をDBに登録しました
                {registerResult.skipped > 0 && `（${registerResult.skipped}件はスキップ）`}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button onClick={handlePrint}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors">
                <Printer className="w-4 h-4" />ブラウザ印刷
              </button>
              <button onClick={handleBridgePrint} disabled={bridgePrinting || bridgeStatus !== 'ok'}
                title={bridgeStatus !== 'ok' ? 'ブリッジサーバーを起動してください (python3.11 bridge.py)' : ''}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors">
                {bridgePrinting
                  ? <><Loader2 className="w-4 h-4 animate-spin" />{bridgeProgress}</>
                  : <><Printer className="w-4 h-4" />テプラで印刷（{labels.length}件）</>
                }
              </button>
              <button onClick={handleRegister} disabled={registering}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors">
                {registering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                DBに登録する（{labels.length}件）
              </button>
            </div>
          </>
        )}
      </div>

      {/* 在庫一覧 */}
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Database className="w-4 h-4 text-gray-500" />
            在庫一覧
            <span className="text-xs font-normal text-gray-400 ml-1">
              親機 {parents.filter(i => !i.claimed).length}/{parents.length}未使用 ／ 子機 {children.filter(i => !i.claimed).length}/{children.length}未使用
            </span>
          </h3>
          <button onClick={loadInventory} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <RefreshCw className={`w-4 h-4 ${loadingInv ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {inventory.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">在庫IDがありません。上のパネルでIDを発行してDBに登録してください。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {['デバイスID', '種別', 'IMSI', '状態', '登録日', ''].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-gray-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {inventory.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono font-semibold text-gray-800">{item.deviceId}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${item.type === 'PARENT' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                        {item.type === 'PARENT' ? <Radio className="w-3 h-3" /> : <Cpu className="w-3 h-3" />}
                        {item.type === 'PARENT' ? '親機' : '子機'}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-gray-500">
                      {item.imsi || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {item.claimed ? (
                        <span className="flex items-center gap-1 text-gray-400"><Check className="w-3 h-3" />登録済</span>
                      ) : (
                        <span className="flex items-center gap-1 text-emerald-600 font-medium">● 未使用</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-400">{new Date(item.createdAt).toLocaleDateString('ja-JP')}</td>
                    <td className="px-3 py-2">
                      {!item.claimed && (
                        <button onClick={() => handleDeleteInventory(item.id)}
                          className="p-1 rounded text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ===== パッケージタブ（Stripe紐付け確認） =====
const PackagesTab = () => {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/packages').then(setPackages).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        Stripe Price IDはサーバーの環境変数（<code className="bg-gray-100 px-1 rounded text-xs">STRIPE_FOXCOIN_PRICE_30</code> 等）で設定し、seedを再実行してください。
      </p>
      {packages.map(pkg => (
        <div key={pkg.id} className="bg-white rounded-xl border p-4">
          <div className="flex items-center gap-4">
            <div className="text-center w-16 flex-shrink-0">
              <div className="text-2xl font-bold text-yellow-600">{pkg.coins}</div>
              <div className="text-xs text-gray-400">FoxCoin</div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-gray-800">{pkg.name}</span>
                {pkg.price > 0 && <span className="text-sm text-gray-500">¥{pkg.price.toLocaleString()}</span>}
                {!pkg.isActive && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">無効</span>}
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                <Link className="w-3 h-3 flex-shrink-0 text-gray-400" />
                {pkg.stripePriceId ? (
                  <span className="font-mono text-green-700 bg-green-50 px-2 py-0.5 rounded">{pkg.stripePriceId}</span>
                ) : (
                  <span className="text-gray-400 italic">Stripe未連携</span>
                )}
              </div>
            </div>
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${pkg.stripePriceId ? 'bg-green-500' : 'bg-gray-300'}`} />
          </div>
        </div>
      ))}
    </div>
  );
};

// ===== パスワード変更タブ =====
const PasswordTab = () => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (next !== confirm) { setError('新しいパスワードと確認用が一致しません'); return; }
    if (next.length < 8) { setError('新しいパスワードは8文字以上にしてください'); return; }
    setLoading(true);
    try {
      await client.put('/admin/me/password', { currentPassword: current, newPassword: next });
      setSuccess('パスワードを変更しました');
      setCurrent(''); setNext(''); setConfirm('');
    } catch (e) {
      setError(e.response?.data?.message || 'パスワード変更に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md">
      <div className="bg-white rounded-xl border p-6">
        <h3 className="font-semibold text-gray-900 mb-4">パスワード変更</h3>
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 rounded-lg text-red-600 text-sm mb-4">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg text-green-600 text-sm mb-4">
            <Check className="w-4 h-4 flex-shrink-0" />{success}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">現在のパスワード</label>
            <input
              type="password" value={current} onChange={e => setCurrent(e.target.value)} required
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:border-blue-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">新しいパスワード</label>
            <input
              type="password" value={next} onChange={e => setNext(e.target.value)} required
              placeholder="8文字以上"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:border-blue-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">新しいパスワード（確認）</label>
            <input
              type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:border-blue-400"
            />
          </div>
          <button
            type="submit" disabled={loading}
            className="w-full py-2.5 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            パスワードを変更する
          </button>
        </form>
      </div>
    </div>
  );
};

// ===== 印刷タブ =====
const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-700',
  printing: 'bg-blue-100 text-blue-700',
  done: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};
const STATUS_LABELS = { pending: '待機中', printing: '印刷中', done: '完了', failed: '失敗' };

const PrintTab = () => {
  const [text, setText] = useState('');
  const [tapeMm, setTapeMm] = useState(12);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadJobs = () => {
    printApi.getJobs().then(setJobs).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { loadJobs(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSubmitting(true);
    setError(''); setSuccess('');
    try {
      await printApi.createJob(text.trim(), tapeMm);
      setSuccess('印刷ジョブを追加しました');
      setText('');
      loadJobs();
    } catch (e) {
      setError(e.response?.data?.message || '送信に失敗しました');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-6">
      {/* 印刷フォーム */}
      <div className="bg-white rounded-xl border p-5">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
          <Printer className="w-4 h-4 text-blue-600" />テプラ印刷
        </h3>
        {error && <div className="flex items-center gap-2 p-3 bg-red-50 rounded-lg text-red-600 text-sm mb-3"><AlertCircle className="w-4 h-4 flex-shrink-0" />{error}</div>}
        {success && <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg text-green-700 text-sm mb-3"><Check className="w-4 h-4 flex-shrink-0" />{success}</div>}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">印刷テキスト</label>
            <input
              type="text" value={text} onChange={e => setText(e.target.value)}
              placeholder="例: FoxSense 親機"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:border-blue-400"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">テープ幅</label>
            <div className="flex rounded-lg border overflow-hidden w-fit">
              {[12, 18].map(mm => (
                <button key={mm} type="button" onClick={() => setTapeMm(mm)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${tapeMm === mm ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                  {mm}mm
                </button>
              ))}
            </div>
          </div>
          <div>
            <button type="submit" disabled={submitting || !text.trim()}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              印刷ジョブを送信
            </button>
          </div>
        </form>
      </div>

      {/* ジョブ履歴 */}
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 text-sm">ジョブ履歴</h3>
          <button onClick={loadJobs} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {jobs.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">印刷ジョブがありません</p>
        ) : (
          <div className="space-y-2">
            {jobs.map(j => (
              <div key={j.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-800 text-sm truncate">{j.text}</div>
                  <div className="text-xs text-gray-400">{j.tapeMm}mm · {new Date(j.createdAt).toLocaleString('ja-JP')}</div>
                  {j.error && <div className="text-xs text-red-500 mt-0.5">{j.error}</div>}
                </div>
                <span className={`ml-3 flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[j.status] || 'bg-gray-100 text-gray-600'}`}>
                  {STATUS_LABELS[j.status] || j.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ===== メイン管理ページ =====
const AdminPage = () => {
  const [tab, setTab] = useState('stats');
  const navigate = useNavigate();

  const tabs = [
    { id: 'stats', label: '統計', icon: BarChart3 },
    { id: 'users', label: 'ユーザー', icon: Users },
    { id: 'devices', label: 'デバイス', icon: Radio },
    { id: 'labels', label: 'ラベル発行', icon: Tag },
    { id: 'packages', label: 'パッケージ', icon: Package },
    { id: 'password', label: 'パスワード', icon: KeyRound },
    { id: 'print', label: '印刷', icon: Printer },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-900">管理画面</h1>
            <p className="text-xs text-gray-500">FoxSense Admin Dashboard</p>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* タブ */}
        <div className="flex gap-1 mb-6 bg-white rounded-xl border p-1">
          {tabs.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex-1 justify-center ${
                  tab === t.id ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}>
                <Icon className="w-4 h-4" />{t.label}
              </button>
            );
          })}
        </div>

        {tab === 'stats' && <StatsTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'devices' && <DevicesTab />}
        {tab === 'labels' && <LabelsTab />}
        {tab === 'packages' && <PackagesTab />}
        {tab === 'password' && <PasswordTab />}
        {tab === 'print' && <PrintTab />}
      </div>
    </div>
  );
};

export default AdminPage;
