"use client";

import { useEffect, useState } from "react";
import { Cloud, CloudRain, CloudSun, Sun, Wind, Droplets } from "lucide-react";

interface WeatherCardProps {
  latitude?: number;
  longitude?: number;
}

interface WeatherInfo {
  temp: number;
  humidity: number;
  windSpeed: number;
  condition: string;
  weatherCode: number;
}

function getWeatherDescription(code: number): { text: string; icon: string } {
  if (code === 0) return { text: "Cerah", icon: "sun" };
  if (code === 1 || code === 2) return { text: "Cerah Berawan", icon: "cloud-sun" };
  if (code === 3) return { text: "Berawan Tebal", icon: "cloud" };
  if (code >= 45 && code <= 48) return { text: "Berkabut", icon: "cloud" };
  if (code >= 51 && code <= 67) return { text: "Hujan Gerimis", icon: "rain" };
  if (code >= 71 && code <= 77) return { text: "Hujan Dingin / Es", icon: "rain" };
  if (code >= 80 && code <= 82) return { text: "Hujan Lebat", icon: "rain" };
  if (code >= 95) return { text: "Badai Petir", icon: "rain" };
  return { text: "Berawan", icon: "cloud" };
}

export function WeatherCard({ latitude, longitude }: WeatherCardProps) {
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (latitude == null || longitude == null) return;

    let isMounted = true;
    const fetchWeather = async () => {
      try {
        setLoading(true);
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        const current = data.current;
        if (current && isMounted) {
          const desc = getWeatherDescription(current.weather_code);
          setWeather({
            temp: Math.round(current.temperature_2m),
            humidity: Math.round(current.relative_humidity_2m),
            windSpeed: Math.round(current.wind_speed_10m),
            condition: desc.text,
            weatherCode: current.weather_code,
          });
        }
      } catch (_) {
        // Silently ignore if offline
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchWeather();
    // Refresh weather every 10 minutes
    const interval = setInterval(fetchWeather, 10 * 60 * 1000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [latitude, longitude]);

  if (!latitude || !longitude || (!weather && !loading)) {
    return null;
  }

  const renderIcon = (code: number) => {
    if (code === 0) return <Sun size={20} className="text-amber-500 animate-spin-slow" />;
    if (code <= 2) return <CloudSun size={20} className="text-amber-500" />;
    if (code >= 51) return <CloudRain size={20} className="text-blue-500" />;
    return <Cloud size={20} className="text-neutral-500" />;
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-neutral-200/80 dark:border-slate-700/60 bg-white dark:bg-slate-800/80 px-3.5 py-2.5 shadow-xs transition-colors">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400">
        {weather ? renderIcon(weather.weatherCode) : <CloudSun size={20} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-neutral-900 dark:text-white">
            {weather ? `${weather.temp}°C` : "—"}
          </span>
          <span className="text-xs font-medium text-neutral-600 dark:text-slate-300 truncate">
            {weather?.condition ?? "Memuat cuaca..."}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-[11px] text-neutral-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1">
            <Droplets size={12} className="text-sky-500" />
            {weather?.humidity ?? "—"}%
          </span>
          <span className="inline-flex items-center gap-1">
            <Wind size={12} className="text-neutral-400 dark:text-slate-500" />
            {weather?.windSpeed ?? "—"} km/h
          </span>
        </div>
      </div>
    </div>
  );
}
