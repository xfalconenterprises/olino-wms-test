import axios from 'axios';

// Same-origin API: the backend serves this app in production, and Vite proxies /api in development
const api = axios.create({
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('wms_token');
  if (token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Login attempts report their own 401 errors on the login screen
const LOGIN_PATHS = ['/api/auth/login', '/api/auth/badge-login'];

// Handle 401 globally — clear token and redirect to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const isLoginAttempt = LOGIN_PATHS.includes(error.config?.url);
    if (error.response?.status === 401 && !isLoginAttempt) {
      localStorage.removeItem('wms_token');
      localStorage.removeItem('wms_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
