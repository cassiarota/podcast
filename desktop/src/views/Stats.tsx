import { useEffect, useMemo, useState } from "react";
import { api, type BookStat, type DailyStat, type StatsSummary } from "../lib/api";
import { useT } from "../lib/i18n";

interface StatsProps {
  onClose: () => void;
}

type Mode = "day" | "month";

export function StatsView({ onClose }: StatsProps) {
  const t = useT();
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [daily, setDaily] = useState<DailyStat[]>([]);
  const [books, setBooks] = useState<BookStat[]>([]);
  const [mode, setMode] = useState<Mode>("day");

  // Last 90 days for "day" mode; last 12 months for "month".
  useEffect(() => {
    const now = Date.now();
    const days = mode === "day" ? 90 : 365;
    const from = now - days * 24 * 3600 * 1000;
    Promise.all([
      api.getStatsSummary().then(setSummary).catch((e) => console.error(e)),
      api
        .getDailyStats(from, now)
        .then(setDaily)
        .catch((e) => console.error(e)),
      api.getPerBookStats().then(setBooks).catch((e) => console.error(e)),
    ]);
  }, [mode]);

  return (
    <div className="stats-view">
      <div className="stats-header">
        <button onClick={onClose}>{t("settings.back")}</button>
        <h1>{t("stats.title")}</h1>
        <div style={{ flex: 1 }} />
        <div className="stats-mode-toggle">
          <button
            className={mode === "day" ? "active" : ""}
            onClick={() => setMode("day")}
          >
            {t("stats.mode.day")}
          </button>
          <button
            className={mode === "month" ? "active" : ""}
            onClick={() => setMode("month")}
          >
            {t("stats.mode.month")}
          </button>
        </div>
      </div>

      <div className="stats-body">
        <SummaryCards summary={summary} t={t} />

        <section className="stats-section">
          <h2>{mode === "day" ? t("stats.heatmap.day") : t("stats.heatmap.month")}</h2>
          {mode === "day" ? (
            <DailyHeatmap daily={daily} />
          ) : (
            <MonthlyBars daily={daily} />
          )}
        </section>

        <section className="stats-section">
          <h2>{t("stats.perBook")}</h2>
          {books.length === 0 ? (
            <div className="stats-empty">{t("stats.perBook.empty")}</div>
          ) : (
            <table className="stats-book-table">
              <thead>
                <tr>
                  <th>{t("stats.book.title")}</th>
                  <th>{t("stats.book.reading")}</th>
                  <th>{t("stats.book.playing")}</th>
                  <th>{t("stats.book.sessions")}</th>
                </tr>
              </thead>
              <tbody>
                {books.map((b) => (
                  <tr key={b.book_id}>
                    <td>{b.title}</td>
                    <td>{fmtDuration(b.reading_ms)}</td>
                    <td>{fmtDuration(b.playing_ms)}</td>
                    <td className="num">{b.sessions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

function SummaryCards({
  summary,
  t,
}: {
  summary: StatsSummary | null;
  t: (k: any) => string;
}) {
  if (!summary) return null;
  return (
    <div className="stats-summary-grid">
      <SummaryCard label={t("stats.today")} value={fmtDuration(
        summary.today_app_ms
      )} />
      <SummaryCard
        label={t("stats.totalReading")}
        value={fmtDuration(summary.total_reading_ms)}
      />
      <SummaryCard
        label={t("stats.totalPlaying")}
        value={fmtDuration(summary.total_playing_ms)}
      />
      <SummaryCard
        label={t("stats.booksListened")}
        value={String(summary.books_listened)}
      />
      <SummaryCard
        label={t("stats.booksRead")}
        value={String(summary.books_read)}
      />
      <SummaryCard
        label={t("stats.totalApp")}
        value={fmtDuration(summary.total_app_ms)}
      />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stats-card">
      <div className="stats-card-label">{label}</div>
      <div className="stats-card-value">{value}</div>
    </div>
  );
}

/**
 * GitHub-style heatmap. ~90 day strip with each cell colored by total
 * usage (max of reading_ms, playing_ms, app_ms).
 */
function DailyHeatmap({ daily }: { daily: DailyStat[] }) {
  const map = useMemo(() => {
    const m = new Map<string, DailyStat>();
    daily.forEach((d) => m.set(d.date, d));
    return m;
  }, [daily]);

  const today = new Date();
  const days = Array.from({ length: 90 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (89 - i));
    return d;
  });

  const max = Math.max(
    1,
    ...daily.map((d) => Math.max(d.app_ms, d.reading_ms, d.playing_ms))
  );

  return (
    <div className="stats-heatmap">
      {days.map((d) => {
        const key = dateKey(d);
        const stat = map.get(key);
        const value = stat
          ? Math.max(stat.app_ms, stat.reading_ms, stat.playing_ms)
          : 0;
        const intensity = value === 0 ? 0 : 0.25 + (value / max) * 0.75;
        const tooltip = stat
          ? `${key}\n阅读 ${fmtDuration(stat.reading_ms)} · 播放 ${fmtDuration(stat.playing_ms)} · 总 ${fmtDuration(stat.app_ms)}`
          : `${key}\n—`;
        return (
          <div
            key={key}
            className="stats-heatmap-cell"
            style={{
              backgroundColor:
                value === 0
                  ? "rgba(245, 230, 211, 0.06)"
                  : `rgba(184, 120, 62, ${intensity.toFixed(2)})`,
            }}
            title={tooltip}
          />
        );
      })}
    </div>
  );
}

function MonthlyBars({ daily }: { daily: DailyStat[] }) {
  const months = useMemo(() => {
    const m = new Map<string, { reading: number; playing: number; app: number }>();
    daily.forEach((d) => {
      const ym = d.date.slice(0, 7); // YYYY-MM
      const cur = m.get(ym) ?? { reading: 0, playing: 0, app: 0 };
      cur.reading += d.reading_ms;
      cur.playing += d.playing_ms;
      cur.app += d.app_ms;
      m.set(ym, cur);
    });
    return Array.from(m.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12);
  }, [daily]);

  const max = Math.max(1, ...months.map(([, v]) => v.app));

  return (
    <div className="stats-monthbars">
      {months.map(([ym, v]) => {
        const h = (v.app / max) * 120;
        return (
          <div key={ym} className="stats-monthbar-col">
            <div className="stats-monthbar-bar" style={{ height: `${h}px` }}>
              <div className="stats-monthbar-tip">{fmtDuration(v.app)}</div>
            </div>
            <div className="stats-monthbar-label">{ym}</div>
          </div>
        );
      })}
      {months.length === 0 && (
        <div className="stats-empty">{t_("stats.perBook.empty")}</div>
      )}
    </div>
  );
}

// Minimal helpers (kept inline)

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h} 小时` : `${h} 小时 ${rem} 分`;
}

function t_(key: string): string {
  // Plain fallback for the rare paths that can't useT() (outside React hooks).
  return key;
}
