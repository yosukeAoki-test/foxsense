import { Thermometer, Droplets } from 'lucide-react';

const GaugeCard = ({ type, value, min, max, alertMin, alertMax }) => {
  const isTemperature = type === 'temperature';
  const label = isTemperature ? '温度' : '湿度';
  const unit = isTemperature ? '°C' : '%';
  const Icon = isTemperature ? Thermometer : Droplets;

  // ゲージの計算
  const range = max - min;
  const percentage = Math.max(0, Math.min(100, ((value - min) / range) * 100));
  const circumference = 2 * Math.PI * 45; // r=45
  const strokeDashoffset = circumference - (percentage / 100) * circumference * 0.75; // 270度分

  // アラート状態の判定
  const isAlert = value < alertMin || value > alertMax;
  const alertColor = isAlert ? 'text-red-500' : '';

  // グラデーションカラー
  const gradientId = isTemperature ? 'tempGradient' : 'humidGradient';
  const gradientColors = isTemperature
    ? ['#3b82f6', '#22c55e', '#f97316', '#ef4444']
    : ['#f97316', '#22c55e', '#3b82f6'];

  return (
    <div className="card card-hover p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-3 sm:mb-4">
        <div className={`p-1.5 sm:p-2 rounded-lg ${isTemperature ? 'bg-orange-100' : 'bg-blue-100'}`}>
          <Icon className={`w-4 h-4 sm:w-5 sm:h-5 ${isTemperature ? 'text-orange-500' : 'text-blue-500'}`} />
        </div>
        <span className="font-medium text-gray-700 text-sm sm:text-base">{label}</span>
      </div>

      <div className="relative flex justify-center">
        <svg width="140" height="120" viewBox="0 0 140 120" className="w-[120px] h-[100px] sm:w-[140px] sm:h-[120px]">
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
              {gradientColors.map((color, i) => (
                <stop
                  key={i}
                  offset={`${(i / (gradientColors.length - 1)) * 100}%`}
                  stopColor={color}
                />
              ))}
            </linearGradient>
          </defs>

          {/* 背景円弧 */}
          <path
            d="M 20 100 A 50 50 0 1 1 120 100"
            fill="none"
            stroke="#e5e7eb"
            strokeWidth="12"
            strokeLinecap="round"
          />

          {/* 値の円弧 */}
          <path
            d="M 20 100 A 50 50 0 1 1 120 100"
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={circumference * 0.75}
            strokeDashoffset={strokeDashoffset}
            className="gauge-animated"
            style={{ transformOrigin: '70px 70px' }}
          />
        </svg>

        {/* 中央の値表示 */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pt-2 sm:pt-4">
          <span className={`text-3xl sm:text-4xl font-bold ${alertColor || 'text-gray-800'}`}>
            {value?.toFixed(1) || '--'}
          </span>
          <span className="text-base sm:text-lg text-gray-500">{unit}</span>
        </div>
      </div>

      {/* 範囲表示 */}
      <div className="flex justify-between text-xs text-gray-400 mt-1 sm:mt-2 px-2">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>

      {/* アラート範囲 */}
      <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-gray-100">
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">警告範囲</span>
          <span className={`font-medium ${isAlert ? 'text-red-500' : 'text-leaf-600'}`}>
            {alertMin}{unit} 〜 {alertMax}{unit}
          </span>
        </div>
      </div>
    </div>
  );
};

export default GaugeCard;
