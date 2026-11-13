import { useNavigate } from 'react-router';
import { AuthLayout } from '../components/AuthLayout';
import { SignInForm } from '../components/SignInForm';

export function SignInPage() {
  const navigate = useNavigate();

  return (
    <AuthLayout>
      <SignInForm onSuccess={() => void navigate('/tasks')} />
    </AuthLayout>
  );
}
