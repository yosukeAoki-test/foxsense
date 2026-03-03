import { useOutletContext, useNavigate } from 'react-router-dom';
import CropManagement from '../components/CropManagement';

export default function CropsPage() {
  const { mockData, selectedDevice } = useOutletContext();
  const navigate = useNavigate();
  return (
    <CropManagement
      historyData={mockData?.history || []}
      latestData={selectedDevice ? mockData?.latest?.[selectedDevice.id] : null}
      alerts={mockData?.alerts}
      onClose={() => navigate('/')}
    />
  );
}
