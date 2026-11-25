import { requireContext } from "@/lib/auth/context";

export default async function DashboardPage() {
  await requireContext();
  return <h1 className="text-2xl font-semibold">Dashboard</h1>;
}
