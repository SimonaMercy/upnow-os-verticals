import { Suspense } from 'react';
import { RegisterForm } from "@/components/auth/RegisterForm";

export default function RegisterTenantPage() {
  return (
    <Suspense>
      <RegisterForm
        role="customer"
        title="Sign up as a Customer"
      />
    </Suspense>
  );
}
