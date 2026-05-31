import { useJobsStore } from "../state/jobs";
import { format, useT } from "../lib/i18n";

/** Floating button (top-right) showing the running task count. */
export function JobsButton() {
  const t = useT();
  const pendingCount = useJobsStore((s) => s.pending.length);
  const activeCount = useJobsStore((s) => s.active.length);
  const togglePanel = useJobsStore((s) => s.togglePanel);
  const total = pendingCount + activeCount;
  if (total === 0) return null;
  return (
    <button className="jobs-button" onClick={togglePanel} title={t("jobs.openPanel")}>
      ▶ {format(t("jobs.button"), { n: total })}
    </button>
  );
}

export function JobsPanel() {
  const t = useT();
  const open = useJobsStore((s) => s.open);
  const setOpen = useJobsStore((s) => s.setOpen);
  const pending = useJobsStore((s) => s.pending);
  const active = useJobsStore((s) => s.active);
  const done = useJobsStore((s) => s.done);
  const toggleChapter = useJobsStore((s) => s.toggleChapter);
  const setAllChapters = useJobsStore((s) => s.setAllChapters);
  const removePending = useJobsStore((s) => s.removePending);
  const startPending = useJobsStore((s) => s.startPending);
  const startAllPending = useJobsStore((s) => s.startAllPending);

  if (!open) return null;
  return (
    <div className="jobs-backdrop" onClick={() => setOpen(false)}>
      <div className="jobs-panel" onClick={(e) => e.stopPropagation()}>
        <div className="jobs-panel-header">
          <h2>{t("jobs.title")}</h2>
          <div style={{ flex: 1 }} />
          <button onClick={() => setOpen(false)}>{t("library.actions.close")}</button>
        </div>

        {pending.length === 0 && active.length === 0 && done.length === 0 && (
          <div className="jobs-empty">{t("jobs.empty")}</div>
        )}

        {pending.length > 0 && (
          <section className="jobs-section">
            <div className="jobs-section-header">
              <h3>{t("jobs.pending")}</h3>
              <button className="primary" onClick={() => startAllPending()}>
                ▶ {format(t("jobs.startAll"), { n: pending.length })}
              </button>
            </div>
            {pending.map((p) => {
              const total = p.chapters.length;
              const sel = p.chapters.filter((c) => c.checked).length;
              return (
                <div key={p.id} className="jobs-pending-row">
                  <div className="jobs-pending-head">
                    <div className="jobs-pending-title">{p.title}</div>
                    <div className="jobs-pending-meta">
                      {p.starting
                        ? "正在启动…"
                        : p.chaptersLoaded
                        ? format(t("jobs.chaptersSelected"), { sel, total })
                        : t("jobs.loadingChapters")}
                    </div>
                    <button
                      className="primary"
                      disabled={sel === 0 || !!p.starting}
                      onClick={() => startPending(p.id)}
                    >
                      {sel === total
                        ? t("jobs.startWhole")
                        : format(t("jobs.startSelected"), { n: sel })}
                    </button>
                    <button onClick={() => removePending(p.id)} disabled={!!p.starting}>
                      {t("library.actions.cancel")}
                    </button>
                  </div>
                  {p.chaptersLoaded && total > 0 && (
                    <div className="jobs-chapter-toolbar">
                      <button
                        className="ghost"
                        onClick={() => setAllChapters(p.id, true)}
                      >
                        {t("jobs.selectAll")}
                      </button>
                      <button
                        className="ghost"
                        onClick={() => setAllChapters(p.id, false)}
                      >
                        {t("jobs.selectNone")}
                      </button>
                    </div>
                  )}
                  {p.chaptersLoaded && (
                    <div className="jobs-chapter-list">
                      {p.chapters.map((c) => (
                        <label key={c.id} className="jobs-chapter-row">
                          <input
                            type="checkbox"
                            checked={c.checked}
                            onChange={(e) => toggleChapter(p.id, c.id, e.target.checked)}
                          />
                          <span>{c.title}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {active.length > 0 && (
          <section className="jobs-section">
            <h3>{t("jobs.active")}</h3>
            {active.map((a) => (
              <div key={a.id} className="jobs-active-row">
                <div className="jobs-active-label">
                  <span>{a.title}</span>
                  <span className="jobs-active-pct">
                    {Math.round(a.progress * 100)}%
                  </span>
                </div>
                <div className="jobs-active-bar">
                  <div
                    className="jobs-active-fill"
                    style={{ width: `${a.progress * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </section>
        )}

        {done.length > 0 && (
          <section className="jobs-section">
            <h3>{t("jobs.done")}</h3>
            {done.slice(0, 6).map((d) => (
              <div key={d.id} className={`jobs-done-row jobs-done-${d.status}`}>
                {d.status === "done" ? "✓" : "✗"} {d.title}
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
