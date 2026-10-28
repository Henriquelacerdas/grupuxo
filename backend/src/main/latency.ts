import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import { LatencyMeasurement, noLatency, type LatencyObserver, type LatencyScope } from "../latency.ts";

/** AsyncLocalStorage isola inclusive operações concorrentes; nenhum contador fica compartilhado entre mensagens. */
export function latencyRuntime(
  publish: (report: ReturnType<LatencyMeasurement["report"]>) => void,
  clock: () => number = () => performance.now(),
  wallNow: () => number = () => Date.now(),
): { observer: LatencyObserver; scope: LatencyScope } {
  const context = new AsyncLocalStorage<{ measurement: LatencyMeasurement; invocationStartedAt: number }>();
  const current = (): LatencyObserver => context.getStore()?.measurement ?? noLatency;
  return {
    observer: {
      start: (stage) => current().start(stage), add: (counter, amount) => current().add(counter, amount),
      outcome: (value) => current().outcome(value), attempt: (sample) => current().attempt(sample),
    },
    scope: { wallNow, invocationStartedAt: () => context.getStore()?.invocationStartedAt ?? wallNow(), run: (kind, operation) => {
      const measurement = new LatencyMeasurement(kind, clock);
      const invocationStartedAt = context.getStore()?.invocationStartedAt ?? wallNow();
      return context.run({ measurement, invocationStartedAt }, async () => {
        const stop = measurement.start("totalMs");
        try { return await operation(measurement); }
        catch (error) { measurement.outcome("failure"); throw error; }
        finally {
          stop();
          // Observabilidade nunca transforma um sucesso em retry nem esconde a falha original.
          try { publish(measurement.report()); } catch { /* destino de log indisponível */ }
        }
      });
    } },
  };
}

export const whatsappLatency = latencyRuntime((report) => { process.stdout.write(`${JSON.stringify(report)}\n`); });
