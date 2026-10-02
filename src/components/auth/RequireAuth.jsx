import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

function AuthLoading() {
  return (
    <div className="min-h-screen bg-[var(--color-surface-bg)] flex items-center justify-center">
      <div className="h-8 w-8 rounded-full border-2 border-[var(--color-brand-accent)] border-t-transparent animate-spin" />
    </div>
  );
}

export default function RequireAdmin({ children }) {
  const { user, isAdmin, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <AuthLoading />;
  }

  if (!user) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }

  if (!isAdmin) {
    return <Navigate to="/submit" replace />;
  }

  return children;
}

export function RequireManager({ children }) {
  const { user, role, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <AuthLoading />;
  }

  if (!user) {
    return <Navigate to="/submit/login" replace state={{ from: location.pathname }} />;
  }

  if (role !== 'manager' && role !== 'admin') {
    return <Navigate to="/admin/login" replace />;
  }

  return children;
}

export function RedirectIfAuthenticated({ children, role }) {
  const { user, isAdmin, isManager, loading } = useAuth();
  const location = useLocation();
  const from = location.state?.from;

  if (loading) {
    return <AuthLoading />;
  }

  if (!user) {
    return children;
  }

  if (role === 'admin') {
    if (isAdmin) {
      return <Navigate to={from || '/'} replace />;
    }
    if (isManager) {
      return <Navigate to="/submit" replace />;
    }
  }

  if (role === 'manager' && (isManager || isAdmin)) {
    return <Navigate to={from || '/submit'} replace />;
  }

  return children;
}
