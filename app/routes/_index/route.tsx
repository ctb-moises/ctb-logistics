import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

// Embedded-only app: requests coming from the admin carry ?shop=..., anything else goes to login.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  throw redirect("/auth/login");
};
