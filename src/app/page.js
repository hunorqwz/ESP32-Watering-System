import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from './api/auth/[...nextauth]/route';
import DashboardClient from './DashboardClient';

export default async function Page() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect('/login');
  }

  const apiToken = process.env.API_ACCESS_TOKEN || '';
  return <DashboardClient apiToken={apiToken} />;
}

export const dynamic = 'force-dynamic';
