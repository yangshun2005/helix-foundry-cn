import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { api } from "./api";
import { useWorkspace } from "./ui";
import { useSetupAction } from "./setup-components";
import { ConnectionForm } from "./connection-form";
import type {
  HostingProvider,
  HostingOptions,
  HostedConnection,
} from "../../../packages/shared/src";

export type HostingStatus = {
  provider: HostingProvider;
  name: string;
  configured: boolean;
  accounts: { id: string; name: string }[];
};
export const providerNames: Record<HostingProvider, string> = {
  neon: "Neon",
  supabase: "Supabase",
  planetscale: "PlanetScale",
};
export function useHosting() {
  const { id } = useWorkspace();
  return useQuery({
    queryKey: [id, "hosting"],
    queryFn: () => api<HostingStatus[]>(`/workspaces/${id}/hosting`),
  });
}

export function HostingConnect({
  provider,
  onImported,
  onDirect,
}: {
  provider: HostingProvider;
  onImported: () => void | Promise<void>;
  onDirect: (kind: string) => void;
}) {
  const { id } = useWorkspace(),
    status = useHosting(),
    action = useSetupAction();
  const current = status.data?.find((s) => s.provider === provider);
  const query = new URLSearchParams(window.location.search);
  const [account, setAccount] = useState<string | null>(
    query.get("hosting") === provider && query.get("workspace") === id
      ? query.get("account")
      : null,
  );
  const [path, setPath] = useState<string[]>([]),
    [names, setNames] = useState<string[]>([]);
  const [apiKey, setApiKey] = useState(""),
    [password, setPassword] = useState("");
  const [serviceTokenId, setServiceTokenId] = useState("");
  const [tokenEntry, setTokenEntry] = useState(false),
    [connection, setConnection] = useState<HostedConnection | null>(null);
  const selectedAccount = account ?? current?.accounts[0]?.id ?? "";
  const tokenLabel =
    provider === "planetscale"
      ? "Service token"
      : provider === "supabase"
        ? "Personal access token"
        : "API key";
  const tokenHelp =
    provider === "planetscale"
      ? "https://planetscale.com/docs/api/service-tokens"
      : provider === "supabase"
        ? "https://supabase.com/dashboard/account/tokens"
        : "https://neon.com/docs/manage/api-keys";
  const changeAccount = () => {
    setAccount("");
    setPath([]);
    setNames([]);
    setPassword("");
    setApiKey("");
    setServiceTokenId("");
    setTokenEntry(true);
  };
  const options = useQuery({
    queryKey: [id, "hosting-options", provider, selectedAccount, path],
    enabled: !!selectedAccount,
    queryFn: () =>
      api<HostingOptions>(`/workspaces/${id}/hosting/${provider}/options`, {
        accountId: selectedAccount,
        path,
      }),
    retry: false,
  });
  const authorize = () =>
    action.run(async () => {
      const result = await api(
        `/workspaces/${id}/hosting/${provider}/authorize`,
        {
          returnTo:
            window.location.pathname === "/onboarding"
              ? "onboarding"
              : "sources",
        },
      );
      window.location.assign(result.url);
    });
  if (connection)
    return (
      <>
        <button
          className="text-button back-link"
          onClick={() => setConnection(null)}
        >
          <ChevronLeft size={14} /> Change database
        </button>
        <ConnectionForm
          kind={connection.kind}
          initialConnection={connection}
          onImported={onImported}
        />
      </>
    );
  if (status.isPending)
    return (
      <p role="status" className="muted">
        Loading connection options…
      </p>
    );
  if (status.error)
    return (
      <div role="alert">
        <p>Connection options could not be loaded.</p>
        <button className="button" onClick={() => status.refetch()}>
          Retry
        </button>
      </div>
    );
  return (
    <div className="hosting-flow">
      {query.get("hosting_error") && query.get("hosting") === provider && (
        <p className="error-box" role="alert">
          Provider sign-in wasn’t completed. Try again or connect directly.
        </p>
      )}
      {!selectedAccount ? (
        <>
          <p className="muted">
            Connect your {providerNames[provider]} account, then choose a
            database.
          </p>
          {current?.configured ? (
            <button
              className="button primary"
              disabled={action.pending}
              onClick={authorize}
            >
              Continue with {providerNames[provider]} <ArrowRight size={15} />
            </button>
          ) : null}
          <>
            {!current?.configured || tokenEntry ? (
              <form
                className="hosting-token"
                onSubmit={(e) => {
                  e.preventDefault();
                  action.run(async () => {
                    const result = await api(
                      `/workspaces/${id}/hosting/${provider}/token`,
                      provider === "planetscale"
                        ? { serviceTokenId, serviceToken: apiKey }
                        : { apiKey },
                    );
                    setAccount(result.account.id);
                    setApiKey("");
                    setServiceTokenId("");
                    setPath([]);
                    setNames([]);
                  });
                }}
              >
                {provider === "planetscale" && (
                  <label>
                    Service token ID
                    <input
                      required
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={serviceTokenId}
                      onChange={(e) => setServiceTokenId(e.target.value)}
                    />
                  </label>
                )}
                <label>
                  {tokenLabel}
                  <input
                    required
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </label>
                <p className="muted small">
                  <a href={tokenHelp} target="_blank" rel="noopener noreferrer">
                    {provider === "planetscale"
                      ? "Get a service token"
                      : provider === "supabase"
                        ? "Get a personal access token"
                        : "Get an API key"}
                  </a>
                  {provider === "planetscale" &&
                    " in PlanetScale → Settings → Service tokens. Grant access to the databases you want to import."}
                </p>
                <button
                  className="button primary"
                  disabled={
                    action.pending ||
                    !apiKey.trim() ||
                    (provider === "planetscale" && !serviceTokenId.trim())
                  }
                >
                  {action.pending ? "Connecting…" : "Connect account"}
                  <ArrowRight size={15} />
                </button>
              </form>
            ) : (
              <button
                className="text-button"
                onClick={() => setTokenEntry(true)}
              >
                {provider === "planetscale"
                  ? "Use a service token instead"
                  : "Use an API key instead"}
              </button>
            )}
          </>
        </>
      ) : (
        <>
          {path.length > 0 && (
            <button
              className="text-button back-link"
              disabled={action.pending}
              onClick={() => {
                setPath(path.slice(0, -1));
                setNames(names.slice(0, -1));
                setPassword("");
              }}
            >
              <ChevronLeft size={14} /> Back
            </button>
          )}
          {names.length > 0 && (
            <p className="muted small">{names.join(" / ")}</p>
          )}
          {options.isPending ? (
            <p role="status" className="muted">
              Finding your databases…
            </p>
          ) : options.error ? (
            <div role="alert">
              <p className="error-text">{options.error.message}</p>
              <button className="button" onClick={() => options.refetch()}>
                Retry
              </button>
            </div>
          ) : (
            <>
              <h3>{options.data?.title}</h3>
              {options.data?.ready ? (
                <form
                  className="hosting-token"
                  onSubmit={(e) => {
                    e.preventDefault();
                    action.run(async () => {
                      setConnection(
                        await api<HostedConnection>(
                          `/workspaces/${id}/hosting/${provider}/connect`,
                          {
                            accountId: selectedAccount,
                            path,
                            ...(password ? { password } : {}),
                          },
                        ),
                      );
                      setPassword("");
                    });
                  }}
                >
                  {options.data.needsPassword && (
                    <>
                      <p className="muted small">
                        Supabase requires this project’s database password for a
                        direct connection.
                      </p>
                      <label>
                        Database password
                        <input
                          type="password"
                          required
                          autoComplete="off"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                      </label>
                    </>
                  )}
                  <button className="button primary" disabled={action.pending}>
                    {action.pending
                      ? "Connecting to your database…"
                      : "Find tables"}
                    <ArrowRight size={15} />
                  </button>
                </form>
              ) : (
                <div className="hosting-resource-list">
                  {options.data?.options.length === 0 && (
                    <p className="muted">
                      No databases are available with this account’s
                      permissions. Connect another account or use a direct
                      connection.
                    </p>
                  )}
                  {options.data?.options.map((option) => (
                    <button
                      className="hosting-resource"
                      key={option.id}
                      onClick={() => {
                        setPath([...path, option.id]);
                        setNames([...names, option.name]);
                      }}
                    >
                      <span>
                        <strong>{option.name}</strong>
                        {option.description && (
                          <small>{option.description}</small>
                        )}
                      </span>
                      <ArrowRight size={15} />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
      {selectedAccount && (
        <button
          className="text-button"
          disabled={action.pending}
          onClick={changeAccount}
        >
          Connect another account
        </button>
      )}
      <div className="hosting-alternatives">
        <button className="text-button" onClick={() => onDirect("postgres")}>
          Connect {provider === "planetscale" ? "PostgreSQL" : "directly"}
          {provider === "planetscale" ? " directly" : " with a URL"}
        </button>
        {provider === "planetscale" && (
          <button className="text-button" onClick={() => onDirect("mysql")}>
            Connect MySQL directly
          </button>
        )}
      </div>
      {action.error && (
        <p className="error-box" role="alert">
          {action.error}
        </p>
      )}
    </div>
  );
}
