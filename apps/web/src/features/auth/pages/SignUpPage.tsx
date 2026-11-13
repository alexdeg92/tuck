import { useNavigate } from 'react-router';
import { AuthLayout } from '../components/AuthLayout';
import { SignUpForm } from '../components/SignUpForm';

export function SignUpPage() {
  const navigate = useNavigate();

  return (
    <AuthLayout>
      <SignUpForm onSuccess={() => void navigate('/tasks')} />
    </AuthLayout>
  );
}
