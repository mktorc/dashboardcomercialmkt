import { createFileRoute } from "@tanstack/react-router";
import { OAuthConsent, consentRouteOptions } from "@/components/oauth-consent";

export const Route = createFileRoute("/oauth/consent")({
  ...consentRouteOptions,
  component: Consent,
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  return <OAuthConsent details={details} authorizationId={authorization_id} />;
}
