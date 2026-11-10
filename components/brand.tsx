import { MapPin } from "lucide-react";
import Link from "next/link";

interface BrandProps {
  dark?: boolean;
}

export function Brand({ dark = false }: BrandProps) {
  return (
    <Link
      href="/"
      className={`inline-flex items-center gap-2 font-semibold tracking-[-0.04em] ${
        dark ? "text-white" : "text-ink"
      }`}
    >
      <span className="grid size-8 place-items-center rounded-full bg-brand text-white">
        <MapPin size={18} strokeWidth={2.5} />
      </span>
      <span className="text-xl">waymark</span>
    </Link>
  );
}

interface HeaderProps {
  action?: string;
}

export function Header({ action = "Runner dashboard" }: HeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-[#EAEAEA] bg-white px-5 py-4 sm:px-8">
      <Brand />
      <nav className="flex items-center gap-5 text-sm">
        <Link
          href="/live/demo-trail-2026"
          className="hidden text-[#858585] transition-colors hover:text-ink sm:block"
        >
          Live demo
        </Link>
        <Link
          href="/dashboard"
          className="rounded-full bg-ink px-4 py-2 font-medium text-white transition-opacity hover:opacity-90"
        >
          {action}
        </Link>
      </nav>
    </header>
  );
}
