import { Suspense } from 'react';
import { RegisterForm } from "@/components/auth/RegisterForm";

export default function RegisterServiceProviderPage() {
  return (
    <Suspense>
      <RegisterForm
        role="service_provider"
        title="Sign up as a Service Provider"
      />
    </Suspense>
  );
}
