import { useOutletContext, useNavigate } from 'react-router-dom';
import DeviceRegistration from '../components/DeviceRegistration';

export default function DevicesPage() {
  const { handleDeviceRefresh } = useOutletContext();
  const navigate = useNavigate();
  return (
    <DeviceRegistration
      onClose={() => navigate('/')}
      onRefresh={handleDeviceRefresh}
    />
  );
}
