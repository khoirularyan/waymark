import Link from "next/link";
import { ArrowUpRight, BatteryMedium, MapPinned, Radio } from "lucide-react";
import { Header } from "../components/brand";
import { ResumeLiveBanner } from "../components/resume-live-banner";

interface MetricProps {
  icon: React.ReactNode;
  value: string;
  label: string;
}

function Metric({ icon, value, label }: MetricProps) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <span className="text-brand">{icon}</span>
      <p className="mt-4 font-semibold">{value}</p>
      <p className="text-xs text-white/50">{label}</p>
    </div>
  );
}

export default function Home() {
  return (
    <main>
      <ResumeLiveBanner />
      <Header />

      <section className="mx-auto grid max-w-7xl gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[1.05fr_.95fr] lg:py-28">
        <div className="max-w-2xl">
          <p className="mb-6 text-sm font-semibold uppercase tracking-[.16em] text-brand">
            Live outdoor tracking
          </p>
          <h1 className="text-5xl font-semibold leading-[.98] tracking-[-.065em] sm:text-7xl">
            Every journey,
            <br />
            in sight.
          </h1>
          <p className="mt-7 max-w-lg text-lg leading-8 text-[#666]">
            Share a private live location link from the trail. Friends and
            family see exactly where you are—without the noise of a fitness app.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              href="/live/demo-trail-2026"
              className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-3 font-medium text-white transition-opacity hover:opacity-90"
            >
              View live demo <ArrowUpRight size={17} />
            </Link>
            <Link
              href="/dashboard"
              className="rounded-full border border-[#ddd] px-5 py-3 font-medium transition-colors hover:bg-neutral-50"
            >
              Open runner dashboard
            </Link>
          </div>
        </div>

        <div className="relative min-h-80 overflow-hidden rounded-2xl bg-ink p-7 text-white">
          <div className="absolute -right-24 -top-24 size-80 rounded-full border-[42px] border-brand/80" />
          <div className="relative">
            <p className="text-sm text-white/55">Now tracking</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">
              Mount Rinjani
              <br />
              Training Run
            </h2>
            <div className="mt-16 grid grid-cols-3 gap-3">
              <Metric
                icon={<MapPinned size={17} />}
                value="12.4 km"
                label="covered"
              />
              <Metric
                icon={<BatteryMedium size={17} />}
                value="82%"
                label="battery"
              />
              <Metric
                icon={<Radio size={17} />}
                value="3"
                label="watching"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-[#eaeaea] bg-[#fafafa]">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 sm:grid-cols-3 sm:px-8">
          <p className="text-sm leading-6 text-[#666]">
            <b className="block text-ink">Simple by design</b>
            No feeds, kudos, or fitness clutter.
          </p>
          <p className="text-sm leading-6 text-[#666]">
            <b className="block text-ink">Built for the outdoors</b>
            Designed around the map, signal, and battery.
          </p>
          <p className="text-sm leading-6 text-[#666]">
            <b className="block text-ink">Share with confidence</b>
            Private links you can stop at any time.
          </p>
        </div>
      </section>
    </main>
  );
}
