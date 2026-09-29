import { beforeEach } from "vitest";

import {
  createIntegrationDatabase,
  integrationDatabaseUrl,
  truncateIntegrationDatabase,
} from "./database";

export {
  createIntegrationDatabase,
  integrationDatabaseUrl,
  truncateIntegrationDatabase,
};

beforeEach(async () => {
  await truncateIntegrationDatabase();
});
