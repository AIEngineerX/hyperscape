import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultDockerManager,
  DEFAULT_DEV_POSTGRES_PASSWORD,
} from "../docker-manager";

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
}

describe("createDefaultDockerManager", () => {
  afterEach(() => {
    resetEnv();
    vi.restoreAllMocks();
  });

  it("uses development default password when POSTGRES_PASSWORD is missing", async () => {
    delete process.env.POSTGRES_PASSWORD;
    process.env.NODE_ENV = "development";

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const manager = createDefaultDockerManager();

    await expect(manager.getConnectionString()).resolves.toContain(
      `:${DEFAULT_DEV_POSTGRES_PASSWORD}@`,
    );
    expect(warnSpy).toHaveBeenCalledWith(
      `[Database] POSTGRES_PASSWORD not set. Using default development password (${DEFAULT_DEV_POSTGRES_PASSWORD}).`,
    );
  });

  it("uses explicit postgres environment values when provided", async () => {
    process.env.NODE_ENV = "development";
    process.env.POSTGRES_CONTAINER = "my-postgres";
    process.env.POSTGRES_USER = "dev_user";
    process.env.POSTGRES_PASSWORD = "dev_password";
    process.env.POSTGRES_DB = "dev_db";
    process.env.POSTGRES_PORT = "6543";

    const manager = createDefaultDockerManager();
    await expect(manager.getConnectionString()).resolves.toBe(
      "postgresql://dev_user:dev_password@localhost:6543/dev_db",
    );
  });

  it("throws in production when POSTGRES_PASSWORD is missing", () => {
    delete process.env.POSTGRES_PASSWORD;
    process.env.NODE_ENV = "production";

    expect(() => createDefaultDockerManager()).toThrow(
      "POSTGRES_PASSWORD is required in production when using local PostgreSQL.",
    );
  });
});
