/**
 * GaugeCard（改：文字のみのシンプル表示）
 * 最新の温度/湿度を、ゲージなしのテキストだけで表示する。
 * props は従来互換（type, value, alertMin, alertMax）。min/max は未使用。
 */
const GaugeCard = ({ type, value, alertMin, alertMax }) => {
  const isTemperature = type === 'temperature';
  const label = isTemperature ? '温度' : '湿度';
  const unit = isTemperature ? '°C' : '%';

  const hasValue = typeof value === 'number' && !Number.isNaN(value);
  const isAlert = hasValue && (value < alertMin || value > alertMax);

  return (
    <div className="card p-5 sm:p-6">
      <div className="text-xs sm:text-sm text-gray-500">{label}</div>

      <div className="mt-1 flex items-baseline gap-1">
        <span
          className={`text-4xl sm:text-5xl font-semibold tracking-tight tabular-nums ${
            isAlert ? 'text-red-500' : 'text-gray-900'
          }`}
        >
          {hasValue ? value.toFixed(1) : '--'}
        </span>
        <span className="text-lg sm:text-xl text-gray-400 font-medium">{unit}</span>
      </div>

      <div className="mt-3 text-xs text-gray-400">
        警告範囲{' '}
        <span className={isAlert ? 'text-red-500 font-medium' : 'text-leaf-600 font-medium'}>
          {alertMin}〜{alertMax}{unit}
        </span>
      </div>
    </div>
  );
};

export default GaugeCard;
