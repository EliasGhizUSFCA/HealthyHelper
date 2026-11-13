import type { Metadata } from "next";
import { ModelLab } from "@/components/ModelLab/ModelLab";

export const metadata: Metadata = { title: "Model Lab · AI Health Mirror" };

export default function LabPage() {
  return <ModelLab />;
}
