import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";

export default function Home() {
  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <SiteNav current="/" />
      </header>
      <main id="main" className="mx-auto max-w-5xl px-6 pb-16">
        <section className="py-10">
          <p className="text-sm font-medium uppercase tracking-wider text-sky-700">Wellness education · not a medical device</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">An AI mirror that shows its work.</h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-600">
            AI Health Mirror describes <em>visible</em> features — such as lips that look dry or eyes that look red — and explains how uncertain those
            observations are. It never diagnoses. Every step of the computer vision and language pipeline is inspectable in the Model Lab.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/mirror" className="rounded-lg bg-sky-700 px-5 py-3 text-base font-medium text-white hover:bg-sky-800">
              Open Health Mirror
            </Link>
            <Link href="/lab" className="rounded-lg border border-slate-300 bg-white px-5 py-3 text-base font-medium text-slate-800 hover:bg-slate-50">
              Open Model Lab
            </Link>
          </div>
        </section>
        <section className="grid gap-6 md:grid-cols-2">
          <article className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-xl font-semibold text-slate-900">Health Mirror</h2>
            <p className="mt-2 text-slate-600">
              A calm, accessible view: camera preview, positioning guidance, plain-language observations with their uncertainty, and an assistant that
              asks follow-up questions instead of jumping to conclusions. No health score, ever.
            </p>
          </article>
          <article className="rounded-xl border border-zinc-800 bg-zinc-950 p-6 text-zinc-200">
            <h2 className="text-xl font-semibold text-zinc-50">Model Lab</h2>
            <p className="mt-2 text-zinc-400">
              A developer dashboard: live landmark overlays, the exact tensors each classifier receives, class probabilities, Grad-CAM attribution maps,
              per-stage pipeline timing, and the structured evidence passed to the LLM with its validation trace.
            </p>
          </article>
        </section>
        <section className="mt-10 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-xl font-semibold text-slate-900">Privacy by default</h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-slate-600">
            <li>The camera only starts when you press a button, and a visible indicator shows when it is on.</li>
            <li>Face landmarks are computed in your browser. Nothing is uploaded until you opt in.</li>
            <li>With consent, only small cropped regions are sent for analysis; frames are not recorded or stored.</li>
            <li>Session comparisons store images only with separate, explicit consent — and you can delete them at any time.</li>
          </ul>
          <Link href="/privacy" className="mt-4 inline-block text-sky-700 underline">
            Read the data retention policy
          </Link>
        </section>
        <p className="mt-10 text-sm text-slate-500">
          This application is for wellness education and visual observation only. It cannot determine dehydration, infection, illness or any medical
          condition. If you are worried about your health, talk to a qualified healthcare professional.
        </p>
      </main>
    </div>
  );
}
