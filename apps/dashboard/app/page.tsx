"use client";

import { useCallback, useEffect, useState } from "react";
import { CONTRACT, DEFAULT_OWNER, loadAll, type Agent, type Owner, type Payment } from "@/lib/chain";
import { fmtNear, fmtTime, pct } from "@/lib/format";

type Tab = "overview" | "agents" | "transactions";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-5">
      <div className="text-xs uppercase tracking-wider text-[var(--muted)]">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-[var(--muted)]">{sub}</div>}
    </div>
  );
}

function Bar({ label, spent, limit }: { label: string; spent: string; limit: string }) {
  const p = pct(spent, limit);
  return (
    <div>
      <div className="flex justify-between text-xs text-[var(--muted)]">
        <span>{label}</span>
        <span>{fmtNear(spent)} / {fmtNear(limit)} NEAR</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-[#1b1b2c]">
        <div className="h-2 rounded-full" style={{ width: `${p}%`, background: p > 85 ? "#ff5c5c" : "var(--bila)" }} />
      </div>
    </div>
  );
}

function Status({ s }: { s: string }) {
  const c: Record<string, string> = {
    active: "bg-emerald-500/15 text-emerald-300", settled: "bg-emerald-500/15 text-emerald-300",
    paused: "bg-amber-500/15 text-amber-300", pending: "bg-amber-500/15 text-amber-300",
    revoked: "bg-red-500/15 text-red-300", failed: "bg-red-500/15 text-red-300", expired: "bg-red-500/15 text-red-300",
  };
  return <span className={`rounded-full px-2.5 py-0.5 text-xs ${c[s] ?? "bg-white/10"}`}>{s}</span>;
}

function AgentCard({ a }: { a: Agent }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">{a.name}</div>
          <div className="text-xs text-[var(--muted)]">{a.account}</div>
        </div>
        <Status s={a.status} />
      </div>
      <div className="mt-5 space-y-3">
        <Bar label="Today" spent={a.budget.spent_today} limit={a.policy.daily_limit} />
        <Bar label="This week" spent={a.budget.spent_this_week} limit={a.policy.weekly_limit} />
        <Bar label="This month" spent={a.budget.spent_this_month} limit={a.policy.monthly_limit} />
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
        <div><div className="text-xs text-[var(--muted)]">Per payment</div>{fmtNear(a.policy.max_transaction)} NEAR</div>
        <div><div className="text-xs text-[var(--muted)]">Payments</div>{a.payment_count}</div>
        <div><div className="text-xs text-[var(--muted)]">Blocked</div>{a.rejected_count}</div>
      </div>
      <div className="mt-3 text-xs text-[var(--muted)]">
        Recipients: {a.policy.allowed_recipients ? a.policy.allowed_recipients.join(", ") : "any (except itself and the contract)"}
      </div>
    </div>
  );
}

function PaymentsTable({ payments, agents }: { payments: Payment[]; agents: Agent[] }) {
  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? `Agent ${id}`;
  if (!payments.length) return <div className="card p-6 text-sm text-[var(--muted)]">No payments yet.</div>;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wider text-[var(--muted)]">
          <tr><th className="p-4">When</th><th className="p-4">Agent</th><th className="p-4">To</th><th className="p-4">Amount</th><th className="p-4">Memo</th><th className="p-4">Status</th></tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id} className="border-t border-[var(--line)]">
              <td className="p-4 whitespace-nowrap">{fmtTime(p.created_at)}</td>
              <td className="p-4">{name(p.agent_id)}</td>
              <td className="p-4">{p.recipient}</td>
              <td className="p-4 whitespace-nowrap">{fmtNear(p.amount)} NEAR</td>
              <td className="p-4 text-[var(--muted)]">{p.memo ?? "—"}</td>
              <td className="p-4"><Status s={p.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Page() {
  const [tab, setTab] = useState<Tab>("overview");
  const [ownerId, setOwnerId] = useState(DEFAULT_OWNER);
  const [input, setInput] = useState(DEFAULT_OWNER);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const d = await loadAll(ownerId);
      setOwner(d.owner); setAgents(d.agents); setPayments(d.payments); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [ownerId]);

  useEffect(() => {
    setLoading(true); refresh();
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, [refresh]);

  const tabs: Tab[] = ["overview", "agents", "transactions"];

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/bila-logo.jpg" alt="BILA" className="h-10 w-10 rounded-lg" />
          <div>
            <div className="text-xl font-semibold tracking-tight">BILA</div>
            <div className="text-xs text-[var(--muted)]">Your agents. Your money. Your rules.</div>
          </div>
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setOwnerId(input.trim()); }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="owner account"
            className="w-64 rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm outline-none focus:border-[var(--bila)]" />
          <button className="rounded-lg px-4 py-2 text-sm font-medium" style={{ background: "var(--bila)" }}>View</button>
        </form>
      </header>

      <nav className="mt-6 flex gap-1 border-b border-[var(--line)]">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm capitalize ${tab === t ? "border-b-2 border-[var(--bila)] text-white" : "text-[var(--muted)]"}`}>
            {t}
          </button>
        ))}
      </nav>

      <div className="mt-6 space-y-6">
        {err && <div className="card border-red-500/40 p-4 text-sm text-red-300">Could not read the chain: {err}</div>}
        {loading && !err && <div className="text-sm text-[var(--muted)]">Reading the chain…</div>}
        {!loading && !err && !owner && (
          <div className="card p-6 text-sm text-[var(--muted)]">{ownerId} has no treasury on this contract yet.</div>
        )}

        {owner && tab === "overview" && (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat label="Treasury" value={`${fmtNear(owner.balance)} NEAR`} />
              <Stat label="Available" value={`${fmtNear(owner.available)} NEAR`} sub="can be withdrawn" />
              <Stat label="Reserved" value={`${fmtNear(owner.reserved)} NEAR`} sub="locked for in-flight payments" />
              <Stat label="Settled" value={`${fmtNear(owner.total_settled)} NEAR`} sub="paid out by agents" />
            </div>
            <h2 className="text-sm uppercase tracking-wider text-[var(--muted)]">Agents</h2>
            <div className="grid gap-4 md:grid-cols-2">{agents.map((a) => <AgentCard key={a.id} a={a} />)}</div>
            <h2 className="text-sm uppercase tracking-wider text-[var(--muted)]">Recent payments</h2>
            <PaymentsTable payments={payments.slice(0, 5)} agents={agents} />
          </>
        )}
        {owner && tab === "agents" && (
          <div className="grid gap-4 md:grid-cols-2">{agents.map((a) => <AgentCard key={a.id} a={a} />)}</div>
        )}
        {owner && tab === "transactions" && <PaymentsTable payments={payments} agents={agents} />}
      </div>

      <footer className="mt-12 text-xs text-[var(--muted)]">
        Reading live from <span className="text-white">{CONTRACT}</span> on NEAR testnet. Limits are enforced by the contract, not by this page.
      </footer>
    </main>
  );
}
