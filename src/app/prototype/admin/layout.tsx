import { AdminShell } from '@/prototype/shell';

export default function PrototypeAdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
