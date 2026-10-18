import type { Metadata } from "next";
import { MappingReport } from "../components/report/MappingReport";

export const metadata: Metadata = {
  title: "Mapping report",
};

export default function ReportPage() {
  return (
    <main className="flex-1 bg-zinc-100 print:bg-white">
      <MappingReport />
    </main>
  );
}
