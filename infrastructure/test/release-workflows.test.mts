import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "../..");
const workflow = (name: string) =>
  parse(readFileSync(resolve(root, ".github/workflows", name), "utf8"));
const ci = workflow("ci.yml");
const release = workflow("publish-containers.yml");

describe("container release boundary", () => {
  it("separates runtime credentials from migration and provisioning", () => {
    const { services } = parse(
      readFileSync(
        resolve(root, "infrastructure/compose.preview.yaml"),
        "utf8",
      ),
    );
    expect(services.api.environment.DATABASE_URL).toBe(
      `postgresql://chronelle_runtime:\${RUNTIME_DATABASE_PASSWORD:?Set RUNTIME_DATABASE_PASSWORD}@postgres:5432/chronelle`,
    );
    expect(services.api.environment).not.toHaveProperty("POSTGRES_PASSWORD");
    expect(services.api.environment).not.toHaveProperty("PGPASSWORD");
    expect(services.migrate.environment.DATABASE_URL).toContain("chronelle:");
    expect(services.api.depends_on["runtime-role"].condition).toBe(
      "service_completed_successfully",
    );
    expect(services["runtime-role"].depends_on.migrate.condition).toBe(
      "service_completed_successfully",
    );
  });

  it("makes manual release validation non-publishing by default", () => {
    expect(release.on.workflow_dispatch.inputs.dry_run).toMatchObject({
      type: "boolean",
      default: true,
    });
    expect(release.jobs.publish.env.PUBLISH_IMAGES).toBe(
      `\${{ github.event_name != 'workflow_dispatch' || !inputs.dry_run }}`,
    );
    const publishingSteps = release.jobs.publish.steps.filter(
      (step: { uses?: string; run?: string }) =>
        step.uses?.startsWith("docker/login-action@") ||
        step.run?.includes("docker push"),
    );
    expect(publishingSteps).toHaveLength(2);
    for (const step of publishingSteps)
      expect(step.if).toBe("env.PUBLISH_IMAGES == 'true'");
  });

  it("keeps development database and preview ingress private by default", () => {
    const local = parse(readFileSync(resolve(root, "compose.yaml"), "utf8"));
    const preview = parse(
      readFileSync(
        resolve(root, "infrastructure/compose.preview.yaml"),
        "utf8",
      ),
    );
    expect(local.services.postgres.ports).toEqual([
      `127.0.0.1:\${POSTGRES_PORT:-5432}:5432`,
    ]);
    expect(preview.services.postgres.ports).toBeUndefined();
    expect(preview.services.api.ports).toBeUndefined();
    expect(preview.services.api.environment.ENABLE_DEVELOPMENT_AUTH).toBe(
      `\${ENABLE_DEVELOPMENT_AUTH:-false}`,
    );
    expect(preview.services.web.ports).toEqual([
      `127.0.0.1:\${WEB_PORT:-3000}:3000`,
    ]);
    expect(preview.services.web.networks).toEqual(["default", "ingress"]);
    expect(preview.networks.default.internal).toBe(true);
    expect(preview.services.api.depends_on["runtime-role"].condition).toBe(
      "service_completed_successfully",
    );
    expect(preview.services.migrate.healthcheck.disable).toBe(true);
  });

  it("validates the caller revision with the same CI gates", () => {
    expect(ci.on.workflow_call).toBeDefined();
    expect(release.jobs.validate).toMatchObject({
      uses: "./.github/workflows/ci.yml",
      with: { retain_images: true },
    });
    for (const name of ["quality", "browser", "containers"]) {
      const job = ci.jobs[name];
      expect(job["continue-on-error"]).toBeUndefined();
      expect(job.if).toBeUndefined();
      const checkout = job.steps.find((step: { uses?: string }) =>
        step.uses?.startsWith("actions/checkout@"),
      );
      expect(checkout.with?.ref).toBeUndefined();
      expect(
        job.steps.every(
          (step: { "continue-on-error"?: boolean }) =>
            !step["continue-on-error"],
        ),
      ).toBe(true);
    }
  });

  it("requires successful validation before a job can publish", () => {
    const publisher = release.jobs.publish;
    expect(publisher.needs).toBe("validate");
    expect(publisher.if).toBeUndefined();
    expect(publisher["continue-on-error"]).toBeUndefined();
    expect(ci.jobs.browser.needs).toBe("quality");
    expect(ci.jobs.containers.needs).toBe("quality");
    expect(
      ci.jobs.quality.steps.some(
        (step: { run?: string }) => step.run === "pnpm check",
      ),
    ).toBe(true);
    expect(
      ci.jobs.browser.steps.some(
        (step: { run?: string }) => step.run === "pnpm test:e2e",
      ),
    ).toBe(true);
    expect(
      ci.jobs.containers.steps.some(
        (step: { run?: string }) =>
          step.run === "node infrastructure/scripts/check-containers.mjs",
      ),
    ).toBe(true);
  });

  it("publishes validated image artifacts without another build", () => {
    const steps = release.jobs.publish.steps;
    const download = steps.find((step: { uses?: string }) =>
      step.uses?.startsWith("actions/download-artifact@"),
    );
    expect(download.with).toEqual({
      name: `runtime-images-\${{ github.sha }}`,
    });
    expect(
      steps.some(
        (step: { uses?: string; run?: string }) =>
          step.uses?.startsWith("docker/build-push-action@") ||
          /docker (?:build|buildx)/u.test(step.run ?? ""),
      ),
    ).toBe(false);
    const commands = steps
      .map((step: { run?: string }) => step.run ?? "")
      .join("\n");
    expect(commands).toContain("docker load --input runtime-images.tar");
    expect(commands).toContain(`sha-\${GITHUB_SHA}`);
    const containerSteps = ci.jobs.containers.steps;
    const smoke = containerSteps.findIndex((step: { run?: string }) =>
      step.run?.includes("check-containers.mjs"),
    );
    const upload = containerSteps.findIndex((step: { uses?: string }) =>
      step.uses?.startsWith("actions/upload-artifact@"),
    );
    expect(upload).toBeGreaterThan(smoke);
    expect(containerSteps[upload]).toMatchObject({
      if: "inputs.retain_images",
      with: {
        name: `runtime-images-\${{ github.sha }}`,
        path: "runtime-images.tar",
        "if-no-files-found": "error",
      },
    });
  });

  it("limits registry writes to the publishing job and pins actions", () => {
    expect(ci.permissions).toEqual({ contents: "read" });
    expect(release.permissions).toEqual({ contents: "read" });
    expect(release.jobs.publish.permissions).toEqual({
      contents: "read",
      packages: "write",
    });
    for (const document of [ci, release]) {
      for (const job of Object.values(document.jobs) as {
        steps?: { uses?: string }[];
      }[]) {
        for (const step of job.steps ?? []) {
          if (step.uses) expect(step.uses).toMatch(/^[^@]+@[0-9a-f]{40}$/u);
        }
      }
    }
  });
});
