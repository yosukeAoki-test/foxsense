import { Thermometer, Droplets, Battery, ChevronRight, Radio, Wifi, Plus, Trash2 } from 'lucide-react';

const DeviceList = ({ parent, children, selectedDevice, onSelectDevice, latestData, onAddChild, onDeleteChild }) => {
  const handleDelete = (e, deviceId) => {
    e.stopPropagation(); // 親のonClickが発火しないように
    if (onDeleteChild) {
      onDeleteChild(deviceId);
    }
  };

  const renderDeviceCard = (device, isParent = false) => {
    const data = latestData[device.id];
    const isSelected = selectedDevice?.id === device.id;

    return (
      <div
        key={device.id}
        className={`relative group w-full p-3 sm:p-4 rounded-xl text-left transition-all cursor-pointer ${
          isSelected
            ? 'bg-gradient-to-r from-leaf-50 to-leaf-100 border-2 border-leaf-300'
            : 'bg-white/50 hover:bg-white border-2 border-transparent'
        }`}
        onClick={() => onSelectDevice(device)}
      >
        {/* 削除ボタン（子機のみ、モバイルでは常に表示） */}
        {!isParent && (
          <button
            onClick={(e) => handleDelete(e, device.id)}
            className="absolute top-2 right-2 p-1.5 rounded-lg bg-white/80 text-gray-400 hover:text-red-500 hover:bg-red-50 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-all shadow-sm"
            title="子機を削除"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}

        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0 pr-6">
            {/* デバイス名とステータス */}
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  device.isOnline ? 'bg-leaf-500' : 'bg-gray-300'
                }`}
              />
              <span className="font-medium text-gray-800 truncate text-sm">
                {device.name}
              </span>
              {isParent && (
                <span className="px-1.5 py-0.5 bg-blue-100 text-blue-600 text-xs rounded-md flex-shrink-0">
                  親機
                </span>
              )}
            </div>

            {/* 場所 */}
            {device.location && (
              <div className="text-xs text-gray-400 mt-0.5 truncate">
                {device.location}
              </div>
            )}

            {/* センサーデータ */}
            <div className="flex items-center gap-3 mt-2 text-sm">
              <div className="flex items-center gap-1 text-orange-500">
                <Thermometer className="w-3.5 h-3.5" />
                <span>{data?.temperature?.toFixed(1) || '--'}°C</span>
              </div>
              <div className="flex items-center gap-1 text-blue-500">
                <Droplets className="w-3.5 h-3.5" />
                <span>{data?.humidity?.toFixed(1) || '--'}%</span>
              </div>
            </div>

            {/* デバイス情報 */}
            <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
              <div className="flex items-center gap-1">
                <Battery className="w-3 h-3" />
                <span>{device.battery}%</span>
              </div>
              {isParent ? (
                <div className="flex items-center gap-1">
                  <Wifi className="w-3 h-3" />
                  <span>LTE {device.signal}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <Radio className="w-3 h-3" />
                  <span>{device.rssi} dBm</span>
                </div>
              )}
            </div>
          </div>

          <ChevronRight
            className={`w-5 h-5 flex-shrink-0 transition-colors ${
              isSelected ? 'text-leaf-500' : 'text-gray-300'
            }`}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="card p-3 sm:p-4">
      {/* 親機セクション */}
      <div className="mb-3 sm:mb-4">
        <h3 className="font-bold text-gray-800 mb-2 sm:mb-3 px-2 flex items-center gap-2 text-sm sm:text-base">
          <Wifi className="w-4 h-4 text-blue-500" />
          親機
        </h3>
        {renderDeviceCard(parent, true)}
      </div>

      {/* 区切り線 */}
      <div className="border-t border-gray-100 my-3 sm:my-4"></div>

      {/* 子機セクション */}
      <div>
        <h3 className="font-bold text-gray-800 mb-2 sm:mb-3 px-2 flex items-center gap-2 text-sm sm:text-base">
          <Radio className="w-4 h-4 text-leaf-500" />
          子機
          <span className="text-xs font-normal text-gray-400">
            ({children.length}台)
          </span>
        </h3>

        {children.length > 0 ? (
          <div className="space-y-2">
            {children.map((device) => renderDeviceCard(device, false))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-400">
            <Radio className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">子機が登録されていません</p>
            <button
              onClick={onAddChild}
              className="mt-3 text-sm text-leaf-600 hover:text-leaf-700 font-medium"
            >
              + 子機を追加
            </button>
          </div>
        )}
      </div>

      {/* 子機追加ボタン */}
      {children.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <button
            onClick={onAddChild}
            className="w-full py-2.5 text-sm text-leaf-600 hover:text-leaf-700 hover:bg-leaf-50 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            子機を追加
          </button>
        </div>
      )}
    </div>
  );
};

export default DeviceList;
