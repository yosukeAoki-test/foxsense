import { useState, useEffect, useMemo, useCallback } from 'react';
import { format, addDays } from 'date-fns';
import { ja } from 'date-fns/locale';
import Dashboard from './components/Dashboard';
import DeviceList from './components/DeviceList';
import AlertSettings from './components/AlertSettings';
import DeviceRegistration from './components/DeviceRegistration';
import CropManagement from './components/CropManagement';
import SettingsModal from './components/SettingsModal';
import { getMockData, saveAlertsMock, getParentDevices, deleteChildDevice, foxCoinApi } from './api/client';
import { useAuth } from './contexts/AuthContext';
import { Settings, RefreshCw, Plus, Sprout, Snowflake, AlertTriangle, X, Flower2, LogOut, User, Radio, ChevronDown, Coins, ShieldCheck, Loader2 } from 'lucide-react';

// 作物ごとの積算温度要件（CropManagementと同じ）
const CROP_GDD_REQUIREMENTS = {
  watermelon: { name: 'スイカ', gdd: 1100, baseTemp: 13 },
  cherry: { name: 'さくらんぼ', gdd: 600, baseTemp: 5 },
  cherry_heated: { name: '加温さくらんぼ', gdd: 550, baseTemp: 5 },
  melon: { name: 'メロン', gdd: 1100, baseTemp: 12 },
  tomato: { name: 'トマト', gdd: 1100, baseTemp: 10 },
  strawberry: { name: 'イチゴ', gdd: 600, baseTemp: 5 },
};

function App() {
  const { user, logout } = useAuth();
  const [mockData, setMockData] = useState(null);
  const [parentDevices, setParentDevices] = useState([]);
  const [selectedParent, setSelectedParent] = useState(null);
  const [showParentMenu, setShowParentMenu] = useState(false);
  const [foxCoinBalance, setFoxCoinBalance] = useState(null);
  const [showFoxCoinShop, setShowFoxCoinShop] = useState(false);
  const [purchasingPkg, setPurchasingPkg] = useState(null);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [showAlertSettings, setShowAlertSettings] = useState(false);
  const [showDeviceRegistration, setShowDeviceRegistration] = useState(false);
  const [showCropManagement, setShowCropManagement] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dismissedAlerts, setDismissedAlerts] = useState(() => {
    const saved = sessionStorage.getItem('foxsense_dismissed_alerts');
    return saved ? JSON.parse(saved) : [];
  });

  // 親機一覧をAPIから取得
  const loadParentDevices = useCallback(async () => {
    try {
      const devices = await getParentDevices();
      setParentDevices(devices);
      if (!selectedParent && devices.length > 0) {
        setSelectedParent(devices[0]);
      } else if (selectedParent) {
        const updated = devices.find(d => d.id === selectedParent.id);
        if (updated) setSelectedParent(updated);
      }
    } catch {
      // APIエラー時はモックを使用
    }
  }, [selectedParent]);

  // FoxCoin 残高取得
  useEffect(() => {
    foxCoinApi.getBalance().then(setFoxCoinBalance).catch(() => {});
  }, []);

  // 初期データ読み込み
  useEffect(() => {
    loadData();
    loadParentDevices();
  }, []);

  // 霜予測アラート計算
  const frostAlert = useMemo(() => {
    if (!mockData?.history || mockData.history.length < 6) return null;

    const recentData = mockData.history.slice(-6);
    const temps = recentData.map(d => d.temperature);
    const firstHalf = temps.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
    const secondHalf = temps.slice(3).reduce((a, b) => a + b, 0) / 3;
    const trend = secondHalf - firstHalf;
    const currentTemp = temps[temps.length - 1];
    const predictedMinTemp = currentTemp + trend * 2;

    // アラート設定から閾値を取得（デフォルト: 警告3°C、危険0°C）
    const frostCritical = mockData.alerts?.frostCritical ?? 0;
    const frostWarning = mockData.alerts?.frostWarning ?? 3;

    if (predictedMinTemp <= frostCritical) {
      return { level: 'critical', message: '霜発生の可能性が非常に高いです！', temp: predictedMinTemp.toFixed(1) };
    } else if (predictedMinTemp <= frostWarning) {
      return { level: 'high', message: '霜に注意が必要です', temp: predictedMinTemp.toFixed(1) };
    }
    return null;
  }, [mockData?.history, mockData?.alerts]);

  // 収穫3日前アラート計算
  const harvestAlerts = useMemo(() => {
    if (!mockData?.history) return [];

    const pollinationRecords = JSON.parse(localStorage.getItem('foxsense_pollination') || '[]');
    const alerts = [];

    pollinationRecords.forEach(record => {
      const crop = CROP_GDD_REQUIREMENTS[record.cropType];
      if (!crop) return;

      const pollinationDate = new Date(record.date);
      const dataAfterPollination = mockData.history.filter(d => new Date(d.timestamp) >= pollinationDate);
      if (dataAfterPollination.length === 0) return;

      // 日ごとの積算温度計算
      let totalGDD = 0;
      const dailyData = {};
      dataAfterPollination.forEach(d => {
        const dateKey = format(new Date(d.timestamp), 'yyyy-MM-dd');
        if (!dailyData[dateKey]) dailyData[dateKey] = [];
        dailyData[dateKey].push(d.temperature);
      });

      Object.values(dailyData).forEach(temps => {
        const avgTemp = temps.reduce((a, b) => a + b, 0) / temps.length;
        totalGDD += Math.max(0, avgTemp - crop.baseTemp);
      });

      const daysElapsed = Object.keys(dailyData).length;
      const avgDailyGDD = daysElapsed > 0 ? totalGDD / daysElapsed : 0;
      const remainingGDD = crop.gdd - totalGDD;
      const estimatedDaysRemaining = avgDailyGDD > 0 ? Math.ceil(remainingGDD / avgDailyGDD) : null;

      // 3日以内に収穫予定
      if (estimatedDaysRemaining !== null && estimatedDaysRemaining <= 3 && estimatedDaysRemaining > 0) {
        const estimatedDate = addDays(new Date(), estimatedDaysRemaining);
        alerts.push({
          id: record.id,
          cropName: crop.name,
          note: record.note,
          daysRemaining: estimatedDaysRemaining,
          estimatedDate: format(estimatedDate, 'M月d日', { locale: ja }),
          totalGDD: totalGDD.toFixed(0),
          requiredGDD: crop.gdd,
        });
      } else if (totalGDD >= crop.gdd) {
        // 収穫適期
        alerts.push({
          id: record.id,
          cropName: crop.name,
          note: record.note,
          daysRemaining: 0,
          isReady: true,
          totalGDD: totalGDD.toFixed(0),
          requiredGDD: crop.gdd,
        });
      }
    });

    return alerts;
  }, [mockData?.history]);

  // アラートを非表示にする
  const dismissAlert = (alertId) => {
    const updated = [...dismissedAlerts, alertId];
    setDismissedAlerts(updated);
    sessionStorage.setItem('foxsense_dismissed_alerts', JSON.stringify(updated));
  };

  // 表示するアラート
  const activeAlerts = useMemo(() => {
    const alerts = [];

    if (frostAlert && !dismissedAlerts.includes('frost')) {
      alerts.push({ type: 'frost', ...frostAlert });
    }

    harvestAlerts.forEach(alert => {
      if (!dismissedAlerts.includes(`harvest-${alert.id}`)) {
        alerts.push({ type: 'harvest', ...alert });
      }
    });

    return alerts;
  }, [frostAlert, harvestAlerts, dismissedAlerts]);

  const loadData = () => {
    const data = getMockData();
    setMockData(data);
    if (!selectedDevice && data.parent) {
      setSelectedDevice(data.parent);
    } else if (selectedDevice) {
      const updated = data.devices?.find(d => d.id === selectedDevice.id);
      if (updated) setSelectedDevice(updated);
    }
  };

  // FoxCoin 購入
  const handleFoxCoinPurchase = async (packageId) => {
    setPurchasingPkg(packageId);
    try {
      const { url } = await foxCoinApi.createCheckout(packageId);
      window.location.href = url;
    } catch (err) {
      alert(err.response?.data?.message || '購入ページへの遷移に失敗しました');
    } finally {
      setPurchasingPkg(null);
    }
  };

  // 子機削除
  const handleDeleteChild = useCallback(async (childId) => {
    try {
      await deleteChildDevice(childId);
      loadData();
      loadParentDevices();
    } catch (err) {
      console.error('子機削除失敗:', err);
    }
  }, []);

  // データ更新
  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      loadData();
      loadParentDevices();
      setIsRefreshing(false);
    }, 500);
  };

  // デバイス管理モーダルで変更があった時
  const handleDeviceRefresh = () => {
    loadParentDevices();
    loadData();
  };

  // アラート設定保存
  const handleSaveAlerts = (newAlerts) => {
    saveAlertsMock(newAlerts);
    setMockData(prev => ({ ...prev, alerts: newAlerts }));
    setShowAlertSettings(false);
  };

  if (!mockData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-leaf-600 text-xl">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-3 sm:p-4 md:p-8">
      {/* ヘッダー */}
      <header className="mb-4 sm:mb-6 md:mb-8 fade-in">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <img
              src="/logo.jpg"
              alt="FoxSense Logo"
              className="w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 rounded-lg sm:rounded-xl object-contain flex-shrink-0"
            />
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl md:text-2xl font-bold gradient-text truncate">FoxSense</h1>
              <p className="text-xs sm:text-sm text-leaf-600/70 hidden sm:block">農業環境モニタリング</p>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            {/* 親機セレクター */}
            {parentDevices.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowParentMenu(prev => !prev)}
                  className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-medium transition-colors border border-blue-200 max-w-[140px]"
                >
                  <Radio className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">{selectedParent?.name || '親機選択'}</span>
                  <ChevronDown className="w-3 h-3 flex-shrink-0" />
                </button>
                {showParentMenu && (
                  <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-gray-100 z-50 min-w-[180px] overflow-hidden">
                    {parentDevices.map(p => (
                      <button key={p.id} onClick={() => { setSelectedParent(p); setShowParentMenu(false); }}
                        className={`w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 transition-colors ${selectedParent?.id === p.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'}`}>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-gray-400 font-mono">{p.deviceId}</div>
                      </button>
                    ))}
                    <div className="border-t border-gray-100">
                      <button onClick={() => { setShowDeviceRegistration(true); setShowParentMenu(false); }}
                        className="w-full text-left px-3 py-2.5 text-sm text-green-600 hover:bg-green-50 transition-colors flex items-center gap-2">
                        <Plus className="w-3.5 h-3.5" />親機を追加...
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <button
              onClick={() => setShowDeviceRegistration(true)}
              className="p-2 sm:p-3 rounded-lg sm:rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white shadow-lg shadow-orange-500/30 transition-all flex items-center gap-1 sm:gap-2"
            >
              <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="hidden sm:inline text-xs sm:text-sm font-medium">デバイス管理</span>
            </button>
            <button
              onClick={() => setShowCropManagement(true)}
              className="p-2 sm:p-3 rounded-lg sm:rounded-xl bg-white/80 hover:bg-white text-leaf-600 shadow-sm transition-all flex items-center gap-1 sm:gap-2"
              title="栽培管理"
            >
              <Sprout className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="hidden md:inline text-sm font-medium">栽培管理</span>
            </button>
            <button
              onClick={handleRefresh}
              className={`p-2 sm:p-3 rounded-lg sm:rounded-xl bg-white/80 hover:bg-white text-leaf-600 shadow-sm transition-all ${
                isRefreshing ? 'animate-spin' : ''
              }`}
              disabled={isRefreshing}
            >
              <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            <button
              onClick={() => setShowAlertSettings(true)}
              className="p-2 sm:p-3 rounded-lg sm:rounded-xl bg-white/80 hover:bg-white text-leaf-600 shadow-sm transition-all"
              title="設定"
            >
              <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            {/* FoxCoin 残高（クリックで購入） */}
            {foxCoinBalance !== null && (
              <button
                onClick={() => setShowFoxCoinShop(true)}
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium border transition-opacity hover:opacity-80 ${
                  foxCoinBalance.simStatus === 'ACTIVE' ? 'bg-yellow-50 border-yellow-200 text-yellow-700' :
                  foxCoinBalance.simStatus === 'SUSPENDED' ? 'bg-red-50 border-red-200 text-red-600' :
                  'bg-gray-50 border-gray-200 text-gray-500'
                }`}
                title="FoxCoinを購入"
              >
                <Coins className="w-3.5 h-3.5" />
                <span className="font-bold">{foxCoinBalance.balance}</span>
                <span className="hidden sm:inline">FC</span>
              </button>
            )}

            {/* ユーザー情報・ログアウト */}
            <div className="flex items-center gap-1 sm:gap-2 ml-1 sm:ml-2 pl-2 sm:pl-3 border-l border-gray-200">
              <div className="hidden sm:flex items-center gap-1.5 text-sm text-gray-600">
                <User className="w-4 h-4" />
                <span className="max-w-[100px] truncate">{user?.name}</span>
              </div>
              {user?.role === 'ADMIN' && (
                <a href="/admin"
                  className="p-2 sm:p-3 rounded-lg sm:rounded-xl bg-white/80 hover:bg-purple-50 text-gray-500 hover:text-purple-600 shadow-sm transition-all"
                  title="管理画面">
                  <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5" />
                </a>
              )}
              <button
                onClick={logout}
                className="p-2 sm:p-3 rounded-lg sm:rounded-xl bg-white/80 hover:bg-red-50 text-gray-500 hover:text-red-500 shadow-sm transition-all"
                title="ログアウト"
              >
                <LogOut className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* アラートバナー */}
      {activeAlerts.length > 0 && (
        <div className="space-y-2 mb-4 sm:mb-6 fade-in">
          {activeAlerts.map((alert, index) => (
            <div
              key={alert.type === 'frost' ? 'frost' : `harvest-${alert.id}`}
              className={`rounded-xl p-3 sm:p-4 flex items-start gap-2 sm:gap-3 ${
                alert.type === 'frost'
                  ? alert.level === 'critical'
                    ? 'bg-red-100 border-2 border-red-300'
                    : 'bg-orange-100 border-2 border-orange-300'
                  : alert.isReady
                    ? 'bg-leaf-100 border-2 border-leaf-300'
                    : 'bg-yellow-100 border-2 border-yellow-300'
              }`}
            >
              {alert.type === 'frost' ? (
                <Snowflake className={`w-5 h-5 sm:w-6 sm:h-6 flex-shrink-0 ${
                  alert.level === 'critical' ? 'text-red-600' : 'text-orange-600'
                }`} />
              ) : (
                <Flower2 className={`w-5 h-5 sm:w-6 sm:h-6 flex-shrink-0 ${
                  alert.isReady ? 'text-leaf-600' : 'text-yellow-600'
                }`} />
              )}
              <div className="flex-1 min-w-0">
                <div className={`font-bold text-sm sm:text-base ${
                  alert.type === 'frost'
                    ? alert.level === 'critical' ? 'text-red-800' : 'text-orange-800'
                    : alert.isReady ? 'text-leaf-800' : 'text-yellow-800'
                }`}>
                  {alert.type === 'frost' ? (
                    <>
                      <AlertTriangle className="w-4 h-4 inline mr-1" />
                      {alert.message}
                    </>
                  ) : alert.isReady ? (
                    `${alert.cropName}が収穫適期です！`
                  ) : (
                    `${alert.cropName}の収穫まであと${alert.daysRemaining}日`
                  )}
                </div>
                <div className={`text-xs sm:text-sm mt-0.5 ${
                  alert.type === 'frost'
                    ? 'text-gray-600'
                    : alert.isReady ? 'text-leaf-700' : 'text-yellow-700'
                }`}>
                  {alert.type === 'frost' ? (
                    `予測最低気温: ${alert.temp}°C`
                  ) : (
                    <>
                      {alert.note && <span className="mr-2">{alert.note}</span>}
                      {alert.isReady ? (
                        `積算温度 ${alert.totalGDD}°C日 達成`
                      ) : (
                        `${alert.estimatedDate}頃 収穫予定 (${alert.totalGDD}/${alert.requiredGDD}°C日)`
                      )}
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={() => dismissAlert(alert.type === 'frost' ? 'frost' : `harvest-${alert.id}`)}
                className={`p-1 rounded-lg transition-colors flex-shrink-0 ${
                  alert.type === 'frost'
                    ? 'text-gray-400 hover:text-gray-600 hover:bg-white/50'
                    : 'text-gray-400 hover:text-gray-600 hover:bg-white/50'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* システム概要 */}
      <div className="card p-4 mb-6 fade-in">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="text-sm">
              {selectedParent ? (
                <>
                  <span className="text-gray-500">選択中の親機: </span>
                  <span className="font-medium text-gray-700">{selectedParent.name}</span>
                  <span className="ml-2 text-xs text-gray-400 font-mono">{selectedParent.deviceId}</span>
                  <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">
                    子機 {selectedParent.activeChildren?.length || 0}台紐付け中
                  </span>
                </>
              ) : (
                <>
                  <span className="text-gray-500">親機: </span>
                  <span className="font-medium text-gray-700">{mockData.parent.name}</span>
                  <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                    mockData.parent.isOnline ? 'bg-leaf-100 text-leaf-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {mockData.parent.isOnline ? 'オンライン' : 'オフライン'}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            {parentDevices.length > 0 && (
              <div>
                <span className="text-gray-500">登録親機: </span>
                <span className="font-bold text-blue-600">{parentDevices.length}</span>
                <span className="text-gray-500">台</span>
              </div>
            )}
            <div>
              <span className="text-gray-500">登録子機: </span>
              <span className="font-bold text-leaf-600">{mockData.children.length}</span>
              <span className="text-gray-500">台</span>
            </div>
            <div>
              <span className="text-gray-500">オンライン: </span>
              <span className="font-bold text-leaf-600">
                {mockData.children.filter(c => c.isOnline).length}
              </span>
              <span className="text-gray-500">台</span>
            </div>
          </div>
        </div>
      </div>

      {/* メインコンテンツ */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* デバイスリスト */}
        <div className="lg:col-span-1 fade-in fade-in-delay-1">
          <DeviceList
            parent={mockData.parent}
            children={mockData.children}
            selectedDevice={selectedDevice}
            onSelectDevice={setSelectedDevice}
            latestData={mockData.latest}
            onAddChild={() => setShowDeviceRegistration(true)}
            onDeleteChild={handleDeleteChild}
          />
        </div>

        {/* ダッシュボード */}
        <div className="lg:col-span-3 fade-in fade-in-delay-2">
          {selectedDevice && (
            <Dashboard
              device={selectedDevice}
              latestData={mockData.latest[selectedDevice.id]}
              historyData={mockData.historyByDevice?.[selectedDevice.id] || mockData.history}
              alerts={mockData.alerts}
              isParent={selectedDevice.id === mockData.parent.id}
              onDelete={handleDeleteChild}
            />
          )}
        </div>
      </div>

      {/* 設定モーダル（アラート・SIM・サブスクリプション） */}
      {showAlertSettings && (
        <SettingsModal
          alerts={mockData.alerts}
          parentDevice={mockData.parent}
          onClose={() => setShowAlertSettings(false)}
          onSaveAlerts={handleSaveAlerts}
        />
      )}

      {/* デバイス管理モーダル */}
      {showDeviceRegistration && (
        <DeviceRegistration
          onClose={() => setShowDeviceRegistration(false)}
          onRefresh={handleDeviceRefresh}
        />
      )}

      {/* FoxCoin 購入モーダル */}
      {showFoxCoinShop && foxCoinBalance && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-gray-900">FoxCoin 購入</h3>
                <p className="text-xs text-gray-500 mt-0.5">残高: <span className="font-bold text-yellow-600">{foxCoinBalance.balance} FC</span></p>
              </div>
              <button onClick={() => setShowFoxCoinShop(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              {(foxCoinBalance.packages || []).map(pkg => (
                <div key={pkg.id} className="flex items-center justify-between p-3 border rounded-xl hover:border-yellow-300 transition-colors">
                  <div>
                    <div className="font-semibold text-gray-800">{pkg.name}</div>
                    <div className="text-sm text-yellow-600 font-bold">{pkg.coins} FC</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {pkg.price > 0 && <span className="text-sm text-gray-500">¥{pkg.price.toLocaleString()}</span>}
                    <button
                      onClick={() => handleFoxCoinPurchase(pkg.id)}
                      disabled={!!purchasingPkg || !pkg.stripePriceId}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      {purchasingPkg === pkg.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Coins className="w-3.5 h-3.5" />}
                      {pkg.stripePriceId ? '購入' : '準備中'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-4 text-center">Stripe の安全な決済画面に移動します</p>
          </div>
        </div>
      )}

      {/* 栽培管理モーダル */}
      {showCropManagement && (
        <CropManagement
          historyData={mockData.history}
          latestData={selectedDevice ? mockData.latest[selectedDevice.id] : null}
          alerts={mockData.alerts}
          onClose={() => setShowCropManagement(false)}
        />
      )}
    </div>
  );
}

export default App;
