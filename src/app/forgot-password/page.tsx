"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Password-based auth was replaced with OTP-only login. This page redirects
// to the login page where users can sign in via a one-time code.
export default function ForgotPasswordPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/login"); }, [router]);
  return null;
}
