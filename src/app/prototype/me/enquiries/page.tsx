import { EnquiriesView } from '@/prototype/views/customer/Enquiries';

export default async function Page({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { open } = await searchParams;
  return <EnquiriesView openId={typeof open === 'string' ? open : undefined} />;
}
