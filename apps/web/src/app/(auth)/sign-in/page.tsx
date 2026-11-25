import { Suspense } from "react";
import { CredentialsForm } from "../credentials-form";

export const metadata = { title: "Sign in | FIRE Planner" };

export default function SignInPage() {
  return (
    <Suspense>
      <CredentialsForm mode="sign-in" />
    </Suspense>
  );
}
