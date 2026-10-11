import {
  ProviderSchema,
  type Resource,
} from "../../../packages/shared/src/index.js";
import { config } from "./config.js";
import { AppError, assert, seal, unseal } from "./security.js";
import { transaction, resource, now, type Store } from "./store.js";
import { testProvider, verifyPinnedModel } from "./providers.js";

export async function jobProgress(
  store: Store,
  scope: string,
  id: string,
  progress: Record<string, unknown>,
) {
  return transaction(store, scope, async (tx) => {
    const job = await tx.get(id);
    assert(job && job.data.status !== "canceled", "Operation canceled", 409);
    tx.update(job, { ...job.data, progress });
  });
}
export async function prepareProvider(
  store: Store,
  scope: string,
  job: Resource,
) {
  const settings = ProviderSchema.parse(unseal(job.data.secret));
  const controller = new AbortController();
  const cancellation = setInterval(
    () =>
      void store.get(scope, job.id).then((j) => {
        if (j?.data.status === "canceled") controller.abort();
      }),
    1000,
  );
  try {
    if (settings.provider === "local") {
      let installed = false;
      if (settings.model === "qwen3:4b") {
        try {
          await verifyPinnedModel(settings);
          installed = true;
        } catch {
          /* Pull missing/pin-mismatched models, then verify again. */
        }
      } else {
        const tags = (await fetch(
          (settings.baseUrl || config.ollama) + "/api/tags",
          { signal: AbortSignal.timeout(5000) },
        ).then((r) => r.json())) as any;
        installed = tags.models?.some((m: any) => m.name === settings.model);
      }
      if (!installed) {
        await jobProgress(store, scope, job.id, {
          message: "Downloading local model",
        });
        const response = await fetch(
          (settings.baseUrl || config.ollama) + "/api/pull",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: settings.model, stream: true }),
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(1800000),
            ]),
          },
        );
        assert(
          response.ok && response.body,
          "Local AI is unavailable. Start Ollama and retry.",
          502,
        );
        const reader = response.body
          .pipeThrough(new TextDecoderStream())
          .getReader();
        let pending = "",
          last = 0;
        const report = async (line: string) => {
          const p = JSON.parse(line);
          assert(
            !p.error,
            "Model download failed. Check model availability and retry.",
            502,
          );
          if (Date.now() - last > 500 || p.status === "success") {
            last = Date.now();
            await jobProgress(store, scope, job.id, {
              message: p.status,
              completed: p.completed,
              total: p.total,
            });
          }
        };
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            pending += value;
            let i;
            while ((i = pending.indexOf("\n")) >= 0) {
              const line = pending.slice(0, i);
              pending = pending.slice(i + 1);
              if (line.trim()) await report(line);
            }
          }
          if (pending.trim()) await report(pending);
        } finally {
          await reader.cancel();
        }
      }
    }
    await jobProgress(store, scope, job.id, {
      message: "Testing connection and structured output",
    });
    const tested = await testProvider(
      settings,
      AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(settings.timeoutSeconds * 1000),
      ]),
    );
    await transaction(store, scope, async (tx) => {
      const current = await tx.get(job.id),
        workspace = await tx.get("workspace");
      assert(
        current?.data.status !== "canceled" &&
          workspace?.data.onboarding?.providerJobId === job.id,
        "Provider preparation was replaced",
        409,
      );
      const member = await store.get("global", `${job.data.actor}:${scope}`);
      assert(
        member?.data.role === "owner",
        "Owner permission is no longer available",
        403,
      );
      const previous = await tx.get("provider");
      const data = {
        settings: { ...settings, apiKey: undefined },
        secret: settings.apiKey ? seal(settings.apiKey) : null,
        testedAt: now(),
      };
      if (previous) tx.update(previous, data);
      else tx.put(resource(scope, "provider", "AI provider", data, "provider"));
      tx.update(current!, {
        ...current!.data,
        status: "succeeded",
        tokens: tested.tokens,
        progress: { message: "AI is ready" },
      });
    });
  } catch (e) {
    // Ollama not running shows up as a bare network error.
    if (
      settings.provider === "local" &&
      e instanceof TypeError &&
      e.message === "fetch failed"
    )
      throw new AppError(
        502,
        "Local AI is unavailable. Start Ollama and retry.",
      );
    throw e;
  } finally {
    clearInterval(cancellation);
  }
}
