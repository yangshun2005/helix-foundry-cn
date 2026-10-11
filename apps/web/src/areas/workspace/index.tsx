// Workspace essentials area: route components lazy-loaded by main.tsx.
import SettingsPage from "../../settings";
import Proposals from "../../review";
import { Page } from "../../kit";
export { HomePage } from "./home";

// /settings (?tab=models|team|developer)
export function WorkspaceSettingsPage() {
  return (
    <Page>
      <SettingsPage />
    </Page>
  );
}
// /proposals (?selected=<proposalId>)
export function ProposalsPage() {
  return (
    <Page>
      <Proposals />
    </Page>
  );
}
