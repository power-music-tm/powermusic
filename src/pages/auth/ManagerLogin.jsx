import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import AuthLayout, { AuthError, AuthField, AuthSubmitButton } from '../../components/auth/AuthLayout';
import { RedirectIfAuthenticated } from '../../components/auth/RequireAuth';

export default function ManagerLogin() {
  const { signIn, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || '/submit';

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

      if (profile?.role === 'admin') {
        navigate('/', { replace: true });
        return;
      }

      if (profile?.role !== 'manager') {
        await signOut();
        setError('This account is not authorized to access the submission form.');
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
    <RedirectIfAuthenticated role="manager">
      <AuthLayout
        title="Manager sign in"
        subtitle="Sign in to submit add or remove requests."
        footer={
          <>
            Need an account?{' '}
            <Link
              to="/submit/signup"
              className="font-semibold text-[var(--color-brand-accent)] hover:text-[var(--color-brand-accent-hover)]"
            >
              Create one
            </Link>
          </>
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <AuthError message={error} />

          <AuthField
            id="manager-email"
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />

          <AuthField
            id="manager-password"
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
