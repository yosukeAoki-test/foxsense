import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const LineCallbackPage = () => {
  const [searchParams] = useSearchParams();
  const { lineLogin } = useAuth();
  const navigate = useNavigate();
  const called = useRef(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;

    const code = searchParams.get('code');
    if (!code) {
      navigate('/login', { replace: true });
      return;
    }

    const redirectUri = `${window.location.origin}/auth/line/callback`;
    lineLogin(code, redirectUri)
      .then(() => navigate('/', { replace: true }))
      .catch(() => navigate('/login?error=line', { replace: true }));
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-[#06C755]/30 border-t-[#06C755] rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-600">LINEログイン処理中...</p>
      </div>
    </div>
  );
};

export default LineCallbackPage;
