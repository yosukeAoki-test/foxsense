import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi } from '../api/client';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // 初期化時にセッションを確認
  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('foxsense_access_token');
      const savedUser = localStorage.getItem('foxsense_user');

      if (token && savedUser) {
        try {
          // トークンの有効性を確認
          const response = await authApi.me();
          setUser(response.data.user);
          localStorage.setItem('foxsense_user', JSON.stringify(response.data.user));
        } catch (error) {
          // トークンが無効な場合はクリア
          console.error('Session validation failed:', error);
          localStorage.removeItem('foxsense_access_token');
          localStorage.removeItem('foxsense_user');
        }
      }
      setIsLoading(false);
    };

    initAuth();
  }, []);

  // ユーザー登録
  const register = useCallback(async (email, password, name) => {
    const response = await authApi.register({ email, password, name });
    const userData = response.data.user;
    setUser(userData);
    localStorage.setItem('foxsense_user', JSON.stringify(userData));
    return userData;
  }, []);

  // ログイン
  const login = useCallback(async (email, password) => {
    const response = await authApi.login(email, password);
    const userData = response.data.user;
    setUser(userData);
    localStorage.setItem('foxsense_user', JSON.stringify(userData));
    return userData;
  }, []);

  // ログアウト
  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch (error) {
      console.error('Logout error:', error);
    }
    setUser(null);
    localStorage.removeItem('foxsense_user');
    localStorage.removeItem('foxsense_access_token');
  }, []);

  // ユーザー情報更新
  const refreshUser = useCallback(async () => {
    try {
      const response = await authApi.me();
      const userData = response.data.user;
      setUser(userData);
      localStorage.setItem('foxsense_user', JSON.stringify(userData));
      return userData;
    } catch (error) {
      console.error('Failed to refresh user:', error);
      throw error;
    }
  }, []);

  const isAuthenticated = !!user;

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      isAuthenticated,
      register,
      login,
      logout,
      refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;
