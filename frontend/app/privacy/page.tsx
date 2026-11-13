import { SiteNav } from "@/components/SiteNav";
import { DeleteAllData } from "@/components/History/DeleteAllData";

export const metadata = { title: "Privacy · AI Health Mirror" };

export default function PrivacyPage() {
  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
        <SiteNav current="/privacy" />
      </header>
      <main id="main" className="mx-auto max-w-3xl px-6 pb-16 text-slate-700">
        <h1 className="text-3xl font-semibold text-slate-900">Privacy &amp; data retention</h1>
        <p className="mt-3">This page describes what this application does with camera data. It has not been assessed for HIPAA compliance or as a medical device, and makes no such claims.</p>
        <h2 className="mt-8 text-xl font-semibold text-slate-900">What happens by default</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>The camera starts only after you press &ldquo;Start camera&rdquo;. A &ldquo;Camera active&rdquo; indicator and a stop button are always visible while it runs.</li>
          <li>Face landmark detection runs locally in your browser (MediaPipe, self-hosted WebAssembly).</li>
          <li>No video is recorded. No frame leaves your device unless you turn on &ldquo;Send cropped regions to the analysis server&rdquo;.</li>
        </ul>
        <h2 className="mt-8 text-xl font-semibold text-slate-900">If you opt in to analysis</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Small JPEG crops (≤160 px) of the lips, eyes, nose and cheek/forehead skin are sent over the WebSocket a few times per second.</li>
          <li>The server processes them in memory and discards them. Raw images are not written to disk or logs.</li>
          <li>Recent classifier scores for your session are kept in server memory to smooth results, and dropped when the session ends or is deleted.</li>
          <li>Chat messages are sent to the server and (if configured) to an LLM provider to generate a reply; they are not logged by default.</li>
        </ul>
        <h2 className="mt-8 text-xl font-semibold text-slate-900">Session comparisons (separate consent)</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Only when you press &ldquo;Save snapshot&rdquo; and confirm the consent dialog, aligned region crops and their observations are stored on the server under a random pseudonymous ID kept in this browser.</li>
          <li>Images are never used to train models. Training on user images would require a separate consent that this application does not request.</li>
          <li>You can delete every stored snapshot below. Deletion removes database rows and image files.</li>
        </ul>
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">Delete my data</h2>
          <DeleteAllData />
        </div>
      </main>
    </div>
  );
}
