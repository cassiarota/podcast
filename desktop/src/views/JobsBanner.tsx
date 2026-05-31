import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useLibraryStore } from "../state/library";
import { useT, format } from "../lib/i18n";

interface JobUpdate {
  jobId: string;
  bookId?: string;
  title: string;
  progress: number;
  status: "running" | "done" | "failed";
}

/**
 * Top-of-screen banner that subscribes to the Rust-side `tts:progress` and
 * `tts:done` Tauri events. Multiple concurrent jobs are tolerated — each gets
 * its own row.
 */
export function JobsBanner() {
  const t = useT();
  const books = useLibraryStore((s) => s.books);
  const [jobs, setJobs] = useState<Record<string, JobUpdate>>({});

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    (async () => {
      const off1 = await listen<{ job_id: string; book_id?: string; progress: number }>(
        "tts:progress",
        (e) => {
          const { job_id, book_id, progress } = e.payload;
          const title = books.find((b) => b.id === book_id)?.title ?? job_id.slice(0, 6);
          setJobs((prev) => ({
            ...prev,
            [job_id]: { jobId: job_id, bookId: book_id, title, progress, status: "running" },
          }));
        }
      );
      const off2 = await listen<{ job_id: string; status: string }>("tts:done", (e) => {
        const { job_id, status } = e.payload;
        setJobs((prev) => {
          const cur = prev[job_id];
          if (!cur) return prev;
          return { ...prev, [job_id]: { ...cur, progress: 1, status: status === "completed" ? "done" : "failed" } };
        });
        // Auto-clear after 4 seconds.
        setTimeout(() => {
          setJobs((prev) => {
            const { [job_id]: _, ...rest } = prev;
            return rest;
          });
        }, 4000);
      });
      unlisteners.push(off1, off2);
    })();
    return () => {
      unlisteners.forEach((u) => u());
    };
  }, [books]);

  const entries = Object.values(jobs);
  if (entries.length === 0) return null;

  return (
    <div className="jobs-banner">
      {entries.map((j) => (
        <div key={j.jobId} className={`jobs-row jobs-row-${j.status}`}>
          <div className="jobs-row-label">
            {j.status === "done"
              ? format(t("library.jobDone"), { title: j.title })
              : format(t("library.jobProgress"), {
                  title: j.title,
                  percent: Math.round(j.progress * 100),
                })}
          </div>
          <div className="jobs-row-bar">
            <div
              className="jobs-row-fill"
              style={{ width: `${Math.max(0, Math.min(1, j.progress)) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
