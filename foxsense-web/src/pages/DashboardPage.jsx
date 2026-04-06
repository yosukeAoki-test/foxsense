import { useOutletContext, useNavigate } from 'react-router-dom';
import { Radio, Plus } from 'lucide-react';
import DeviceList from '../components/DeviceList';
import Dashboard from '../components/Dashboard';

export default function DashboardPage() {
  const {
    mockData,
    parentDevices,
    selectedDevice,
    setSelectedDevice,
    handleDeleteChild,
    handleUpdateDevice,
  } = useOutletContext();
  const navigate = useNavigate();

  if (!mockData) {
    if (parentDevices.length === 0) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-4">
          <div className="text-center max-w-sm">
            <Radio className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-700 mb-2">親機が未登録です</h2>
            <p className="text-gray-500 text-sm mb-6">デバイス管理から親機を登録してください</p>
            <button
              onClick={() => navigate('/devices')}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white rounded-xl font-medium shadow-lg shadow-orange-500/30 mx-auto"
            >
              <Plus className="w-4 h-4" />
              デバイス管理
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-leaf-600 text-xl">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      <div className="lg:col-span-1 fade-in fade-in-delay-1">
        <DeviceList
          parent={mockData.parent}
          children={mockData.children}
          selectedDevice={selectedDevice}
          onSelectDevice={setSelectedDevice}
          latestData={mockData.latest}
          onAddChild={() => navigate('/devices')}
          onDeleteChild={handleDeleteChild}
        />
      </div>
      <div className="lg:col-span-3 fade-in fade-in-delay-2">
        {selectedDevice && (
          <Dashboard
            device={selectedDevice}
            latestData={mockData.latest[selectedDevice.id]}
            historyData={mockData.historyByDevice?.[selectedDevice.id] || mockData.history}
            alerts={mockData.alerts}
            isParent={selectedDevice.id === mockData.parent.id}
            onDelete={handleDeleteChild}
            onUpdate={handleUpdateDevice}
          />
        )}
      </div>
    </div>
  );
}
