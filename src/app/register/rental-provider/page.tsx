import { Suspense } from 'react';
import { RegisterForm } from "@/components/auth/RegisterForm";

export default function RegisterRentalProviderPage() {
  return (
    <Suspense>
      <RegisterForm
        role="rental_provider"
        title="Sign up as a Rental Provider"
      />
    </Suspense>
  );
}
