import { Suspense } from "react";
import { CredentialsForm } from "../credentials-form";

export const metadata = { title: "Create account | FIRE Planner" };

export default function SignUpPage() {
  return (
    <Suspense>
      <CredentialsForm mode="sign-up" />
    </Suspense>
  );
}
