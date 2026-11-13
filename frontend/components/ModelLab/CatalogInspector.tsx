"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { CatalogProduct, CatalogStatus } from "@/lib/catalog";
import { missingFields, relativeTime } from "@/lib/beauty";
import { Badge, Empty, LabButton, LabCard, Stat } from "@/components/ui";
import { fmt } from "@/lib/format";

const TOKEN_KEY = "ahm.dev_token";

function readToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function outcomeTone(o: string) {
  if (o === "ok") return "ok" as const;
  if (o.startsWith("denied") || o === "forbidden" || o === "rate_limited") return "error" as const;
  if (o.includes("error")) return "warn" as const;
  return "neutral" as const;
}

export function CatalogInspector() {
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [log, setLog] = useState<{ entries: Record<string, unknown>[]; summary: Record<string, number> } | null>(null);
  const [logErr, setLogErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [token, setToken] = useState<string>(() => (typeof window === "undefined" ? "" : readToken()));
  const [category, setCategory] = useState("");
  const [progress, setProgress] = useState<Record<string, unknown> | null>(null);
  const [perCat, setPerCat] = useState(5);

  const load = useCallback(() => {
    api.catalogStatus().then(setStatus).catch((e) => setErr(String(e.message ?? e)));
    api.catalogProducts({ category: category || undefined, limit: 400 }).then(setProducts).catch(() => setProducts([]));
    api
      .crawlLog(token || null, 150)
      .then((l) => {
        setLog(l);
        setLogErr(null);
      })
      .catch((e) => setLogErr(e instanceof ApiError && e.status === 401 ? "Developer token required to read the crawl log." : String(e.message ?? e)));
  }, [category, token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!status?.refresh_running && !progress) return;
    const t = setInterval(() => {
      api
        .refreshProgress()
        .then((p) => {
          setProgress(p as Record<string, unknown>);
          if (!p.running) load();
        })
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(t);
  }, [status?.refresh_running, progress, load]);

  const saveToken = (v: string) => {
    setToken(v);
    try {
      sessionStorage.setItem(TOKEN_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const refresh = async () => {
    try {
      const r = await api.catalogRefresh(token || null, perCat, category ? [category] : undefined);
      setProgress({ running: r.running, note: r.note });
      setStatus((s) => (s ? { ...s, refresh_running: true } : s));
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    }
  };

  const policy = (status?.policy ?? {}) as Record<string, unknown>;
  const cache = (policy.sitemap_cache ?? {}) as Record<string, unknown>;
  const last = (status?.last_refresh ?? null) as { run_id?: string; status?: string; finished_at?: number; stats?: Record<string, unknown> } | null;
  const withIngredients = products.filter((p) => p.ingredients).length;
  const noPrice = products.filter((p) => p.price == null).length;
  const cats = useMemo(() => Object.keys(status?.by_category ?? {}), [status]);

  return (
    <LabCard title="eCosmetics data inspector" subtitle="Live retailer requests happen ONLY in the refresh job; recommendations search the local catalogue">
      <div className="space-y-3 text-[11px]">
        {err && <div className="rounded border border-rose-800 bg-rose-950/50 px-2 py-1 text-rose-200">{err}</div>}
        <div className="grid gap-3 lg:grid-cols-2">
          <section className="space-y-1.5 rounded border border-zinc-800 p-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300">Local catalogue search (what recommendations use)</h3>
            <div className="grid grid-cols-3 gap-1.5">
              <Stat label="Products" value={status?.products} />
              <Stat label="Stale" value={status?.stale_products} title={`not re-verified within ${status?.stale_after_hours} h`} />
              <Stat label="With ingredients" value={products.length ? `${Math.round((100 * withIngredients) / products.length)}%` : "—"} />
              <Stat label="No listed price" value={noPrice} title="multi-shade products: price loads via disallowed ajax endpoints" />
              <Stat label="Categories" value={cats.length} />
              <Stat label="Source" value="local DB" />
            </div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(status?.by_category ?? {}).map(([k, v]) => (
                <Badge key={k} tone="info">
                  {k} {v}
                </Badge>
              ))}
            </div>
          </section>
          <section className="space-y-1.5 rounded border border-zinc-800 p-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">Live retailer requests (refresh job only)</h3>
            <div className="flex flex-wrap gap-1">
              <Badge tone={status?.crawl_enabled ? "ok" : "error"}>crawl {status?.crawl_enabled ? "enabled" : "disabled"}</Badge>
              <Badge tone={policy.robots_loaded ? "ok" : "skip"}>robots.txt {policy.robots_loaded ? "loaded" : "not loaded in this process"}</Badge>
              <Badge tone={cache.fresh ? "ok" : "skip"}>sitemap cache {cache.cached ? (cache.fresh ? "fresh" : "stale") : "empty"}</Badge>
              {typeof cache.urls === "number" && <Badge>{cache.urls} sitemap URLs</Badge>}
              <Badge>min interval {fmt(policy.min_interval_s as number)} s</Badge>
            </div>
            <p className="break-all text-zinc-500">UA: {String(policy.user_agent ?? "")}</p>
            <p className="text-zinc-500">Blocked: {(policy.blocked as string[] | undefined)?.join(" ")}</p>
            <p className="text-zinc-400">
              Last refresh: {last?.finished_at ? `${relativeTime(last.finished_at)} · ${last.status} · run ${last.run_id}` : last ? `${last.status} (running)` : "never"}
            </p>
            {last?.stats && (
              <pre className="max-h-28 overflow-auto rounded bg-black/60 p-1 font-mono text-[10px] text-zinc-300">
                {JSON.stringify(Object.fromEntries(Object.entries(last.stats).filter(([k]) => k !== "per_category")), null, 1)}
              </pre>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1">
                dev token
                <input type="password" value={token} onChange={(e) => saveToken(e.target.value)} className="w-28 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5" aria-label="Developer token (session only)" />
              </label>
              <label className="flex items-center gap-1">
                per category
                <input type="number" min={1} max={50} value={perCat} onChange={(e) => setPerCat(Number(e.target.value))} className="w-12 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5" />
              </label>
              <LabButton tone="primary" onClick={() => void refresh()} disabled={!!status?.refresh_running || !!(progress && (progress as { running?: boolean }).running)}>
                Run polite refresh
              </LabButton>
              <LabButton onClick={load}>Reload</LabButton>
            </div>
            {progress && <pre className="max-h-20 overflow-auto rounded bg-black/60 p-1 font-mono text-[10px] text-zinc-300">{JSON.stringify(progress, null, 1)}</pre>}
          </section>
        </div>

        <section className="rounded border border-zinc-800 p-2">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Crawl log (every request + outcome)</h3>
            <div className="flex flex-wrap gap-1">
              {Object.entries(log?.summary ?? {}).map(([k, v]) => (
                <Badge key={k} tone={outcomeTone(k)}>
                  {k} {v}
                </Badge>
              ))}
            </div>
          </div>
          {logErr ? (
            <Empty>{logErr}</Empty>
          ) : !log?.entries.length ? (
            <Empty>No requests logged yet.</Empty>
          ) : (
            <div className="max-h-56 overflow-auto">
              <table className="w-full table-fixed text-[10px]">
                <thead className="sticky top-0 bg-zinc-900 text-left text-zinc-500">
                  <tr>
                    <th className="w-20">time</th>
                    <th className="w-14">kind</th>
                    <th className="w-10">http</th>
                    <th className="w-28">outcome</th>
                    <th className="w-12">ms</th>
                    <th>url / error</th>
                  </tr>
                </thead>
                <tbody>
                  {log.entries.map((e) => (
                    <tr key={String(e.id)} className="border-t border-zinc-800/60 align-top">
                      <td className="font-mono text-zinc-500">{new Date(Number(e.at)).toLocaleTimeString()}</td>
                      <td>{String(e.kind ?? "")}</td>
                      <td className="font-mono">{e.status == null ? "—" : String(e.status)}</td>
                      <td>
                        <Badge tone={outcomeTone(String(e.outcome))}>{String(e.outcome)}</Badge>
                      </td>
                      <td className="font-mono">{fmt(e.elapsed_ms as number, 0)}</td>
                      <td className="truncate text-zinc-400" title={String(e.url)}>
                        {String(e.url).replace("https://www.ecosmetics.com", "")}
                        {e.error ? <span className="text-amber-300"> · {String(e.error)}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded border border-zinc-800 p-2">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Catalogue records · metadata validation</h3>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5" aria-label="Filter by category">
              <option value="">all categories</option>
              {cats.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <span className="text-zinc-500">{products.length} records</span>
          </div>
          {!products.length ? (
            <Empty>No products in the local catalogue for this filter.</Empty>
          ) : (
            <div className="max-h-80 overflow-auto">
              <table className="w-full table-fixed text-[10px]">
                <thead className="sticky top-0 bg-zinc-900 text-left text-zinc-500">
                  <tr>
                    <th className="w-[30%]">product</th>
                    <th className="w-16">price</th>
                    <th className="w-14">complete</th>
                    <th className="w-20">verified</th>
                    <th>missing fields · parse warnings</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.product_id} className="border-t border-zinc-800/60 align-top">
                      <td className="truncate">
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-cyan-300 hover:underline" title={p.name}>
                          {p.brand ? `${p.brand} · ` : ""}
                          {p.name}
                        </a>
                        <div className="text-zinc-500">{p.categories.join(", ")}</div>
                      </td>
                      <td className="font-mono">{p.price == null ? <span className="text-amber-300">{p.price_status}</span> : `${p.price.toFixed(2)} ${p.currency ?? ""}`}</td>
                      <td className="font-mono">{(p.completeness * 100).toFixed(0)}%</td>
                      <td>
                        {relativeTime(p.last_verified)}
                        {p.stale && <Badge tone="warn">stale</Badge>}
                      </td>
                      <td className="text-zinc-400">
                        {missingFields(p).join(", ") || <span className="text-emerald-400">none</span>}
                        {p.parse_warnings.length > 0 && <div className="text-amber-300">{p.parse_warnings.join(" · ")}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </LabCard>
  );
}
