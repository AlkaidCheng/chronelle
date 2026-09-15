import { notFound } from "next/navigation";

import { DevelopmentSignInForm } from "./development-sign-in-form";

/**
 * The development sign-in exists only where the web server is told so, the
 * same way the API registers its route only behind an explicit flag.
 */
export default function DevelopmentSignInPage() {
  if (process.env.WEB_DEVELOPMENT_SIGN_IN !== "true") notFound();
  return <DevelopmentSignInForm />;
}
