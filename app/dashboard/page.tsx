import {
  BatteryMedium,
  Copy,
  MapPin,
  Navigation,
  Radio,
  Share2,
  Wifi,
} from "lucide-react";
import { Header } from "../../components/brand";

interface StatusProps {
  icon: React.ReactNode;
  title: string;
  value: string;
}

function Status({ icon, title, value }: StatusProps) {
  return (
    <div className="rounded-xl bg-[#f7f7f7] p-3">
      <span className="text-brand">{icon}</span>
      <p className="mt-4 text-xs text-[#858585]">{title}</p>
      <p className="font-medium text-ink">{value}</p>
    </div>
  );
}

export default function Dashboard() {
  return (
    <main className="min-h-screen bg-[#fbfbfa]">
      <Header action="View public page" />

      <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
        <p className="text-sm font-semibold uppercase tracking-[.14em] text-brand">
          Runner dashboard
        </p>

        <div className="mt-3 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-4xl font-semibold tracking-[-.05em]">
              Ready when you are.
            </h1>
            <p className="mt-2 text-[#777]">
              Start a lightweight live tracking session from your phone.
            </p>
          </div>
          <button className="inline-flex items-center justify-center gap-2 rounded-full bg-brand px-6 py-3.5 font-semibold text-white transition-opacity hover:opacity-90">
            <Navigation size={17} fill="currentColor" /> Start tracking
          </button>
        </div>

        <section className="mt-10 grid gap-4 md:grid-cols-[1.5fr_1fr]">
          <div className="rounded-2xl border border-[#eaeaea] bg-white p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#858585]">Tracking status</p>
                <h2 className="mt-1 text-2xl font-semibold">Not tracking</h2>
              </div>
              <span className="rounded-full bg-[#f2f2f2] px-3 py-1.5 text-xs font-semibold text-[#666]">
                OFFLINE
              </span>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <Status icon={<MapPin />} title="GPS" value="Ready" />
              <Status icon={<Wifi />} title="Internet" value="Connected" />
              <Status
                icon={<BatteryMedium />}
                title="Battery"
                value="82%"
              />
            </div>
          </div>

          <div className="rounded-2xl bg-ink p-6 text-white">
            <p className="text-sm text-white/55">Today’s session</p>
            <p className="mt-5 text-4xl font-semibold tracking-tight">—</p>
            <p className="mt-1 text-sm text-white/50">No active session</p>
            <p className="mt-8 text-xs leading-5 text-white/55">
              Tracking uses a battery-conscious location interval and continues
              via foreground service.
            </p>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-[#eaeaea] bg-white p-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <p className="text-sm text-[#858585]">Upcoming route</p>
              <h2 className="mt-1 text-xl font-semibold">
                Mount Rinjani Training Run
              </h2>
              <p className="mt-1 text-sm text-[#858585]">
                GPX route · 22.8 km · 1,240 m elevation
              </p>
            </div>
            <button className="rounded-full border border-[#ddd] px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50">
              Manage route
            </button>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-dashed border-[#d8d8d8] bg-white p-6">
          <div className="flex gap-3">
            <span className="text-brand">
              <Share2 size={20} />
            </span>
            <div>
              <p className="font-semibold">Your share link will appear here</p>
              <p className="mt-1 text-sm text-[#858585]">
                Start tracking to create a private link for friends and family.
              </p>
            </div>
            <Copy className="ml-auto text-[#bbb]" size={18} />
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-3 flex items-center gap-2">
            <Radio size={16} className="text-brand" />
            <h2 className="font-semibold">Spectators</h2>
          </div>
          <p className="rounded-xl border border-[#eaeaea] bg-white p-5 text-sm text-[#858585]">
            Active viewers will appear here while you’re live. Viewer names remain
            private to you.
          </p>
        </section>
      </div>
    </main>
  );
}
