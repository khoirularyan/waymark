import { LiveTrackerView } from "../../../components/live-tracker-view";
import { getSession } from "../../../lib/tracking-store";

interface LivePageProps {
  params: Promise<{ token: string }>;
}

export default async function LivePage({ params }: LivePageProps) {
  const { token } = await params;
  const session = await getSession(token);

  return <LiveTrackerView token={token} initialSession={session ?? null} />;
}
