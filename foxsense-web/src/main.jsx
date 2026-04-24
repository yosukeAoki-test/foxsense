import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import Login from './components/Login.jsx'
import Register from './components/Register.jsx'
import AdminPage from './components/AdminPage.jsx'
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx'
import ForgotPassword from './components/ForgotPassword.jsx'
import ResetPassword from './components/ResetPassword.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import DevicesPage from './pages/DevicesPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import CropsPage from './pages/CropsPage.jsx'
import SatellitePage from './pages/SatellitePage.jsx'
import TokushohoPage from './pages/TokushohoPage.jsx'
import FoxCoinSuccessPage from './pages/FoxCoinSuccessPage.jsx'
import ReceiptPage from './pages/ReceiptPage.jsx'
import LineCallbackPage from './pages/LineCallbackPage.jsx'

// 認証が必要なルートを保護するコンポーネント
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-leaf-200 border-t-leaf-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-leaf-600">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

// ADMIN 権限が必要なルート
const AdminRoute = ({ children }) => {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
    </div>
  );

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role !== 'ADMIN') return <Navigate to="/" replace />;

  return children;
};

// 認証済みユーザーがアクセスできないルート（ログイン・登録）
const PublicOnlyRoute = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-leaf-200 border-t-leaf-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-leaf-600">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return children;
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* 認証済みユーザーはリダイレクト */}
          <Route
            path="/login"
            element={
              <PublicOnlyRoute>
                <Login />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/register"
            element={
              <PublicOnlyRoute>
                <Register />
              </PublicOnlyRoute>
            }
          />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/tokushoho" element={<TokushohoPage />} />
          <Route path="/receipt/:purchaseId" element={<ReceiptPage />} />
          <Route path="/auth/line/callback" element={<LineCallbackPage />} />

          {/* 認証が必要なルート */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <App />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="devices" element={<DevicesPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="crops" element={<CropsPage />} />
            <Route path="satellite" element={<SatellitePage />} />
          </Route>
          {/* FoxCoin 購入完了 */}
          <Route
            path="/foxcoins/success"
            element={
              <ProtectedRoute>
                <FoxCoinSuccessPage />
              </ProtectedRoute>
            }
          />

          {/* 管理画面 */}
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <AdminPage />
              </AdminRoute>
            }
          />

          {/* 404 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
