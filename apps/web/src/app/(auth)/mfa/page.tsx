import { Suspense } from "react";
import { MfaForm } from "./mfa-form";

export const metadata = { title: "Two-step verification | FIRE Planner" };

export default function MfaPage() {
  return (
    <Suspense>
      <MfaForm />
    </Suspense>
  );
}
