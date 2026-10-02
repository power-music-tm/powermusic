import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import AuthLayout, { AuthError, AuthField, AuthSubmitButton } from '../../components/auth/AuthLayout';
import { RedirectIfAuthenticated } from '../../components/auth/RequireAuth';

export default function AdminLogin() {
  const { signIn, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { profile } = await signIn(email.trim(), password);

      if (profile?.role !== 'admin') {
        await signOut();
        setError('This account does not have admin access. Managers should use the submission portal login.');
        return;
      }

      navigate(from, { replace: true });
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <RedirectIfAuthenticated role="admin">
      <AuthLayout
        title="Admin sign in"
        subtitle="Sign in to access the Power Music dashboard."
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <AuthError message={error} />

          <AuthField
            id="admin-email"
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />

          <AuthField
            id="admin-password"
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />

          <AuthSubmitButton loading={loading}>Sign in</AuthSubmitButton>
        </form>
      </AuthLayout>
    </RedirectIfAuthenticated>
  );
}

function formatAuthError(error) {
  if (!error?.message) return 'Unable to sign in. Please try again.';

  const message = error.message.toLowerCase();

  if (message.includes('invalid login credentials')) {
    return 'Incorrect email or password.';
  }

  if (message.includes('email not confirmed')) {
    return 'Please confirm your email before signing in.';
  }

  return error.message;
}
