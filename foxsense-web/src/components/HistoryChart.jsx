import { useState, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts';
import { format, subDays, startOfDay, endOfDay, isWithinInterval, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Calendar, ChevronLeft, ChevronRight, Thermometer, Droplets, X } from 'lucide-react';

const HistoryChart = ({ data, alerts, deviceName }) => {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [dateRangeMode, setDateRangeMode] = useState('day'); // day, week, month, custom
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [customRange, setCustomRange] = useState({
    start: format(subDays(new Date(), 7), 'yyyy-MM-dd'),
    end: format(new Date(), 'yyyy-MM-dd'),
  });

  // 日付フィルタリング
  const filteredData = useMemo(() => {
    if (!data || data.length === 0) return [];

    let startDate, endDate;

    switch (dateRangeMode) {
      case 'day':
        startDate = startOfDay(selectedDate);
        endDate = endOfDay(selectedDate);
        break;
      case 'week':
        startDate = subDays(startOfDay(selectedDate), 6);
        endDate = endOfDay(selectedDate);
        break;
      case 'month':
        startDate = subDays(startOfDay(selectedDate), 29);
        endDate = endOfDay(selectedDate);
        break;
      case 'custom':
        startDate = startOfDay(new Date(customRange.start));
        endDate = endOfDay(new Date(customRange.end));
        break;
      default:
        startDate = startOfDay(selectedDate);
        endDate = endOfDay(selectedDate);
    }

    return data
      .filter((item) => {
        const itemDate = parseISO(item.timestamp);
        return isWithinInterval(itemDate, { start: startDate, end: endDate });
      })
      .map((item) => ({
        ...item,
        time: format(parseISO(item.timestamp), dateRangeMode === 'day' ? 'HH:mm' : 'M/d', { locale: ja }),
        fullTime: format(parseISO(item.timestamp), 'M月d日 HH:mm', { locale: ja }),
      }));
  }, [data, selectedDate, dateRangeMode, customRange]);

  // 統計情報
  const stats = useMemo(() => {
    if (filteredData.length === 0) return null;

    const temps = filteredData.map(d => d.temperature).filter(t => !isNaN(t));
    const humids = filteredData.map(d => d.humidity).filter(h => !isNaN(h));

    return {
      tempMin: Math.min(...temps).toFixed(1),
      tempMax: Math.max(...temps).toFixed(1),
      tempAvg: (temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1),
      humidMin: Math.min(...humids).toFixed(1),
      humidMax: Math.max(...humids).toFixed(1),
      humidAvg: (humids.reduce((a, b) => a + b, 0) / humids.length).toFixed(1),
      latest: filteredData[filteredData.length - 1],
    };
  }, [filteredData]);

  // 日付移動
  const moveDate = (direction) => {
    const days = dateRangeMode === 'month' ? 30 : dateRangeMode === 'week' ? 7 : 1;
    setSelectedDate(prev => {
      const newDate = new Date(prev);
      newDate.setDate(newDate.getDate() + (direction * days));
      return newDate;
    });
  };

  // カスタムツールチップ
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white/95 backdrop-blur-sm p-2 sm:p-3 rounded-xl shadow-lg border border-leaf-100 text-xs sm:text-sm">
          <p className="text-gray-600 mb-1">{payload[0]?.payload?.fullTime}</p>
          {payload.map((entry, index) => (
            <p key={index} className="font-medium" style={{ color: entry.color }}>
              {entry.dataKey === 'temperature' ? '温度' : '湿度'}: {entry.value?.toFixed(1)}
              {entry.dataKey === 'temperature' ? '°C' : '%'}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="card p-4 sm:p-6">
      {/* ヘッダー */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 sm:mb-6">
        <div>
          <h3 className="font-bold text-gray-800 text-sm sm:text-base">履歴データ</h3>
          {deviceName && (
            <p className="text-xs sm:text-sm text-gray-500">{deviceName}</p>
          )}
        </div>

        {/* 期間選択 */}
        <div className="flex flex-wrap items-center gap-1 sm:gap-2">
          {['day', 'week', 'month', 'custom'].map((mode) => (
            <button
              key={mode}
              onClick={() => {
                setDateRangeMode(mode);
                if (mode === 'custom') setShowDatePicker(true);
              }}
              className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs sm:text-sm transition-all ${
                dateRangeMode === mode
                  ? 'bg-leaf-500 text-white'
                  : 'bg-leaf-50 text-leaf-600 hover:bg-leaf-100'
              }`}
            >
              {mode === 'day' ? '1日' : mode === 'week' ? '1週間' : mode === 'month' ? '1ヶ月' : '期間指定'}
            </button>
          ))}
        </div>
      </div>

      {/* 日付ナビゲーション（カスタム以外） */}
      {dateRangeMode !== 'custom' && (
        <div className="flex items-center justify-between mb-4 bg-gray-50 rounded-lg p-2">
          <button
            onClick={() => moveDate(-1)}
            className="p-1.5 sm:p-2 rounded-lg hover:bg-white text-gray-600 transition-colors"
          >
            <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          <button
            onClick={() => setShowDatePicker(!showDatePicker)}
            className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg hover:bg-white transition-colors"
          >
            <Calendar className="w-3 h-3 sm:w-4 sm:h-4 text-leaf-600" />
            <span className="font-medium text-gray-700 text-xs sm:text-sm">
              {dateRangeMode === 'day'
                ? format(selectedDate, 'M月d日(E)', { locale: ja })
                : dateRangeMode === 'week'
                ? `${format(subDays(selectedDate, 6), 'M/d')} 〜 ${format(selectedDate, 'M/d')}`
                : `${format(subDays(selectedDate, 29), 'M/d')} 〜 ${format(selectedDate, 'M/d')}`
              }
            </span>
          </button>

          <button
            onClick={() => moveDate(1)}
            className="p-1.5 sm:p-2 rounded-lg hover:bg-white text-gray-600 transition-colors disabled:opacity-30"
            disabled={selectedDate >= new Date()}
          >
            <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>
      )}

      {/* 期間指定（カスタム） */}
      {dateRangeMode === 'custom' && (
        <div className="mb-4 p-3 sm:p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-700">期間を指定</span>
            <button
              onClick={() => setShowDatePicker(false)}
              className="p-1 rounded text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">開始日</label>
              <input
                type="date"
                value={customRange.start}
                onChange={(e) => setCustomRange({ ...customRange, start: e.target.value })}
                max={customRange.end}
                className="w-full px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg border border-gray-200 focus:border-leaf-400 outline-none text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">終了日</label>
              <input
                type="date"
                value={customRange.end}
                onChange={(e) => setCustomRange({ ...customRange, end: e.target.value })}
                min={customRange.start}
                max={format(new Date(), 'yyyy-MM-dd')}
                className="w-full px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg border border-gray-200 focus:border-leaf-400 outline-none text-sm"
              />
            </div>
          </div>
          <div className="mt-2 text-xs text-gray-500 text-center">
            {format(new Date(customRange.start), 'M月d日', { locale: ja })} 〜 {format(new Date(customRange.end), 'M月d日', { locale: ja })}
            （{Math.ceil((new Date(customRange.end) - new Date(customRange.start)) / (1000 * 60 * 60 * 24)) + 1}日間）
          </div>
        </div>
      )}

      {/* 日付ピッカー（単日選択） */}
      {showDatePicker && dateRangeMode !== 'custom' && (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
          <input
            type="date"
            value={format(selectedDate, 'yyyy-MM-dd')}
            onChange={(e) => {
              setSelectedDate(new Date(e.target.value));
              setShowDatePicker(false);
            }}
            max={format(new Date(), 'yyyy-MM-dd')}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-leaf-400 outline-none text-sm"
          />
        </div>
      )}

      {/* 最新データ & 統計 */}
      {stats && (
        <div className="grid grid-cols-2 gap-2 sm:gap-3 mb-4 sm:mb-6">
          {/* 最新温度 */}
          <div className="bg-orange-50 rounded-lg p-2 sm:p-3">
            <div className="flex items-center gap-1 text-orange-600 text-xs mb-0.5 sm:mb-1">
              <Thermometer className="w-3 h-3" />
              <span>最新温度</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold text-orange-600">
              {stats.latest?.temperature?.toFixed(1)}°C
            </div>
            <div className="text-xs text-gray-500 mt-0.5 hidden sm:block">
              {stats.tempMin}〜{stats.tempMax}°C (平均{stats.tempAvg}°C)
            </div>
          </div>

          {/* 最新湿度 */}
          <div className="bg-blue-50 rounded-lg p-2 sm:p-3">
            <div className="flex items-center gap-1 text-blue-600 text-xs mb-0.5 sm:mb-1">
              <Droplets className="w-3 h-3" />
              <span>最新湿度</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold text-blue-600">
              {stats.latest?.humidity?.toFixed(1)}%
            </div>
            <div className="text-xs text-gray-500 mt-0.5 hidden sm:block">
              {stats.humidMin}〜{stats.humidMax}% (平均{stats.humidAvg}%)
            </div>
          </div>
        </div>
      )}

      {/* グラフ */}
      {filteredData.length > 0 ? (
        <div className="h-48 sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={filteredData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: '#e5e7eb' }}
                interval="preserveStartEnd"
              />
              <YAxis
                yAxisId="temp"
                orientation="left"
                domain={[0, 50]}
                tick={{ fontSize: 9, fill: '#f97316' }}
                tickLine={false}
                axisLine={{ stroke: '#e5e7eb' }}
                tickFormatter={(v) => `${v}°`}
                width={28}
              />
              <YAxis
                yAxisId="humid"
                orientation="right"
                domain={[0, 100]}
                tick={{ fontSize: 9, fill: '#3b82f6' }}
                tickLine={false}
                axisLine={{ stroke: '#e5e7eb' }}
                tickFormatter={(v) => `${v}%`}
                width={30}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ paddingTop: '8px', fontSize: '12px' }}
                formatter={(value) => (
                  <span className="text-xs text-gray-600">
                    {value === 'temperature' ? '温度' : '湿度'}
                  </span>
                )}
              />
              {/* アラートライン */}
              <ReferenceLine yAxisId="temp" y={alerts.tempMin} stroke="#f97316" strokeDasharray="5 5" strokeOpacity={0.5} />
              <ReferenceLine yAxisId="temp" y={alerts.tempMax} stroke="#f97316" strokeDasharray="5 5" strokeOpacity={0.5} />
              <Line
                yAxisId="temp"
                type="monotone"
                dataKey="temperature"
                name="temperature"
                stroke="#f97316"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2 }}
              />
              <Line
                yAxisId="humid"
                type="monotone"
                dataKey="humidity"
                name="humidity"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-48 sm:h-64 flex items-center justify-center text-gray-400">
          <div className="text-center">
            <Calendar className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-2 opacity-50" />
            <p className="text-sm">この期間のデータがありません</p>
          </div>
        </div>
      )}

      {/* 凡例 */}
      <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-gray-100 flex flex-wrap gap-2 sm:gap-4 text-xs text-gray-500">
        <div className="flex items-center gap-1">
          <div className="w-6 sm:w-8 h-0.5 bg-orange-400"></div>
          <span>温度</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-6 sm:w-8 h-0.5 bg-blue-400"></div>
          <span>湿度</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-6 sm:w-8 h-0.5 bg-orange-400 opacity-50"></div>
          <span className="hidden sm:inline">アラート範囲 </span>
          <span>({alerts.tempMin}〜{alerts.tempMax}°C)</span>
        </div>
      </div>
    </div>
  );
};

export default HistoryChart;
