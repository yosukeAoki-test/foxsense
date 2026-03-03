import { useOutletContext, useNavigate } from 'react-router-dom';
import SettingsModal from '../components/SettingsModal';

export default function SettingsPage() {
  const { mockData, selectedParent, handleSaveAlerts } = useOutletContext();
  const navigate = useNavigate();

  const onSaveAlerts = async (newAlerts) => {
    await handleSaveAlerts(newAlerts);
    navigate('/');
  };

  return (
    <SettingsModal
      alerts={mockData?.alerts}
      parentDevice={selectedParent}
      onClose={() => navigate('/')}
      onSaveAlerts={onSaveAlerts}
    />
  );
}
