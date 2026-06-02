import { Suspense } from 'react';
import { CustomerRegisterForm } from '@/components/auth/CustomerRegisterForm';

export default function RegisterCustomerPage() {
  return (
    <Suspense>
      <CustomerRegisterForm />
    </Suspense>
  );
}
