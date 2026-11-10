"use client";

import { useEffect, useRef, useState } from "react";
import { REASONS } from "@/lib/format";

type Row = { id: string; t: number; amount: string; memo: string; verdict: "approved" | "blocked" | "error"; note: string };
type Speed = "fast" | "normal" | "slow";
const DELAYS: Record<Speed, [number, number, string]> = {
  fast: [2000, 6000, "Fast (2–6 s)"],
  normal: [8000, 20000, "Normal (8–20 s)"],
  slow: [60000, 120000, "Slow (1–2 min)"],
};

export default function GiftPlatform() {
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<Speed>("fast");
  const [max, setMax] = useState(20);
  const [rows, setRows] = useState<Row[]>([]);
  const live = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const count = useRef(0);
  const speedRef = useRef(speed); speedRef.current = speed;
  const maxRef = useRef(max); maxRef.current = max;

  const approved = rows.filter((r) => r.verdict === "approved");
  const blocked = rows.filter((r) => r.verdict === "blocked");
  const total = approved.reduce((s, r) => s + Number(r.amount), 0);

  async function fire() {
    if (!live.current) return;
    const pin = new URLSearchParams(window.location.search).get("pin");
    let row: Row;
    try {
      const r = await fetch(`/api/gift${pin ? `?pin=${encodeURIComponent(pin)}` : ""}`, { method: "POST" });
      const j = await r.json();
      if (j.status) {
        const ok = j.status !== "rejected";
        row = { id: j.requestId, t: Date.now(), amount: j.amountNear, memo: j.memo, verdict: ok ? "approved" : "blocked", note: ok ? "Within limits — forwarded to the agent" : REASONS[j.reason] ?? j.reason ?? "Rejected" };
      } else {
        row = { id: j.requestId ?? String(Date.now()), t: Date.now(), amount: j.amountNear ?? "?", memo: j.memo ?? "", verdict: "error", note: j.error ?? "Request failed" };
      }
    } catch {
      row = { id: String(Date.now()), t: Date.now(), amount: "?", memo: "", verdict: "error", note: "Network error" };
    }
    setRows((p) => [row, ...p].slice(0, 60));
    count.current += 1;
    if (count.current >= maxRef.current) return stop();
    const [lo, hi] = DELAYS[speedRef.current];
    timer.current = setTimeout(fire, lo + Math.random() * (hi - lo));
  }

  function start() { count.current = 0; live.current = true; setRunning(true); fire(); }
  function stop() { live.current = false; setRunning(false); clearTimeout(timer.current); }
  useEffect(() => () => { live.current = false; clearTimeout(timer.current); }, []);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xl font-semibold tracking-tight">Gift Platform <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-xs text-[var(--muted)]">demo</span></div>
          <div className="mt-1 text-sm text-[var(--muted)]">A mock platform that asks BILA to pay gifts on its own. BILA approves what fits the agent&apos;s limits and blocks the rest.</div>
        </div>
        <a href="/" className="text-sm text-[var(--muted)] underline">Open dashboard</a>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section>
          <div className="card flex flex-wrap items-center gap-3 p-4">
            <button onClick={running ? stop : start} className="rounded-lg px-4 py-2 text-sm font-semibold" style={{ background: running ? "#2a2a40" : "var(--bila)" }}>
              {running ? "Stop" : "Start requests"}
            </button>
            <select value={speed} onChange={(e) => setSpeed(e.target.value as Speed)} className="rounded-lg border border-[var(--line)] bg-transparent px-3 py-2 text-sm">
              {(Object.keys(DELAYS) as Speed[]).map((k) => <option key={k} value={k} className="bg-[#0f0f1a]">{DELAYS[k][2]}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm text-[var(--muted)]">Stop after
              <input type="number" min={1} max={100} value={max} onChange={(e) => setMax(Math.max(1, Number(e.target.value) || 1))} className="w-16 rounded-lg border border-[var(--line)] bg-transparent px-2 py-1 text-white" />
              requests
            </label>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="card p-4"><div className="text-xs uppercase tracking-wider text-[var(--muted)]">Approved</div><div className="mt-1 text-2xl font-semibold text-emerald-300">{approved.length}</div></div>
            <div className="card p-4"><div className="text-xs uppercase tracking-wider text-[var(--muted)]">Blocked</div><div className="mt-1 text-2xl font-semibold text-red-300">{blocked.length}</div></div>
            <div className="card p-4"><div className="text-xs uppercase tracking-wider text-[var(--muted)]">Requested OK</div><div className="mt-1 text-2xl font-semibold">{total.toFixed(2)}<span className="text-sm text-[var(--muted)]"> NEAR</span></div></div>
          </div>

          <div className="card mt-4 divide-y divide-[var(--line)]">
            {rows.length === 0 && <div className="p-6 text-sm text-[var(--muted)]">Nothing yet. Press Start.</div>}
            {rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 p-4 text-sm">
                <div>
                  <div className="font-medium">{r.memo || "Gift"} · {r.amount} NEAR</div>
                  <div className="text-xs text-[var(--muted)]">{new Date(r.t).toLocaleTimeString()} · {r.note}</div>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs ${r.verdict === "approved" ? "bg-emerald-500/15 text-emerald-300" : r.verdict === "blocked" ? "bg-red-500/15 text-red-300" : "bg-amber-500/15 text-amber-300"}`}>{r.verdict}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="hidden lg:block">
          <div className="card overflow-hidden" style={{ height: 720 }}>
            <iframe src="/" title="BILA dashboard" className="h-full w-full border-0" />
          </div>
        </section>
      </div>
    </main>
  );
}
