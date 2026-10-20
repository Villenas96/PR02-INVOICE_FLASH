BEGIN;

DROP TABLE IF EXISTS "ai_confirmation";
DROP TABLE IF EXISTS "ai_connection";
DROP TABLE IF EXISTS "oauth_access_token";
DROP TABLE IF EXISTS "oauth_refresh_token";
DROP TABLE IF EXISTS "oauth_consent";
DROP TABLE IF EXISTS "oauth_client_resource";
DROP TABLE IF EXISTS "oauth_client_assertion";
DROP TABLE IF EXISTS "oauth_resource";
DROP TABLE IF EXISTS "oauth_client";
DROP TABLE IF EXISTS "jwks";
DROP TYPE IF EXISTS "ai_confirmation_action";
DROP TYPE IF EXISTS "ai_connection_status";

COMMIT;
