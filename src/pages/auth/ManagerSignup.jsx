import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import AuthLayout, { AuthError, AuthField, AuthSubmitButton } from '../../components/auth/AuthLayout';
import { RedirectIfAuthenticated } from '../../components/auth/RequireAuth';

export default function ManagerSignup() {
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      const { session, user } = await signUp(email.trim(), password, fullName.trim());

      if (!session && user) {
        setError('Account created. Check your email to confirm your address, then sign in.');
        return;
      }

      navigate('/submit', { replace: true });
    } catch (err) {
      setError(formatSignupError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <RedirectIfAuthenticated role="manager">
      <AuthLayout
        title="Create manager account"
        subtitle="Register to access the submission form."
        footer={
          <>
            Already have an account?{' '}
            <Link
              to="/submit/login"
              className="font-semibold text-[var(--color-brand-accent)] hover:text-[var(--color-brand-accent-hover)]"
            >
              Sign in
            </Link>
          </>
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <AuthError message={error} />

          <AuthField
            id="manager-full-name"
            label="Full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
          />

          <AuthField
            id="manager-signup-email"
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />

          <AuthField
            id="manager-signup-password"
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />

          <AuthField
            id="manager-signup-confirm"
            label="Confirm password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />

          <p className="text-xs text-[var(--color-text-muted)]">
            Use at least 8 characters. You will stay signed in on this device until you log out.
          </p>

          <AuthSubmitButton loading={loading}>Create account</AuthSubmitButton>
        </form>
      </AuthLayout>
    </RedirectIfAuthenticated>
  );
}

function formatSignupError(error) {
  if (!error?.message) return 'Unable to create account. Please try again.';

  const message = error.message.toLowerCase();

  if (message.includes('already registered')) {
    return 'An account with this email already exists. Try signing in instead.';
  }

  if (message.includes('password')) {
    return error.message;
  }

  return error.message;
}
