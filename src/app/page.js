import DashboardClient from './DashboardClient';

export default async function Page() {
  const apiToken = process.env.API_ACCESS_TOKEN || '';
  return <DashboardClient apiToken={apiToken} />;
}

export const dynamic = 'force-dynamic';
