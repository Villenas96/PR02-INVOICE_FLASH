import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq, isNull } from "drizzle-orm";

import { createDatabase, type Database } from "@/db/index";
import { companies } from "@/db/schema/company";
import { ApiError, apiErrorResponse, toApiError } from "@/lib/api/errors";
import { logSafe } from "@/lib/log";
import {
  type CompanyContext,
  ResourceNotFoundError,
  resolveCompanyContext,
} from "@/services/context";
import { type PrivateBucket, storeCompanyLogo } from "@/services/storage";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MAX_REPLACEMENT_ATTEMPTS = 3;
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
const SUPPORTED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/svg+xml",
]);
const SVG_ACTIVE_ELEMENT_PATTERN =
  /<\s*(?:(?:[a-z_][\w.-]*):)?(?:animate|animatecolor|animatemotion|animatetransform|audio|embed|foreignobject|iframe|object|script|set|style|video)\b/i;
const SVG_EVENT_HANDLER_PATTERN =
  /\s(?:(?:[a-z_][\w.-]*):)?on[a-z][\w.-]*\s*=/i;

interface CompanyLogoRow {
  id: string;
  logoKey: string | null;
}

function requestIdFrom(request: Request): {
  requestId: string;
  propagatedRequestId?: string;
} {
  const supplied = request.headers.get("x-request-id");
  if (supplied && REQUEST_ID_PATTERN.test(supplied)) {
    return { requestId: supplied, propagatedRequestId: supplied };
  }
  return { requestId: crypto.randomUUID() };
}

function withRequestId(response: Response, requestId: string): Response {
  response.headers.set("x-request-id", requestId);
  return response;
}

function validationError(message: string, status = 400): ApiError {
  return new ApiError("validation_error", status, message, {
    logo: message,
  });
}

function assertRequestSize(request: Request): void {
  const rawContentLength = request.headers.get("content-length");
  if (!rawContentLength) {
    return;
  }

  const contentLength = Number(rawContentLength);
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_LOGO_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
  ) {
    throw validationError("El logotipo no puede superar 2 MiB.", 413);
  }
}

async function logoFileFrom(request: Request): Promise<File> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw validationError(
      "Envía el logotipo como formulario multipart válido.",
    );
  }

  const logos = formData.getAll("logo");
  if (logos.length !== 1 || !(logos[0] instanceof File)) {
    throw validationError("Adjunta un único archivo en el campo «logo».");
  }

  return logos[0];
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function chunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

function isStructurallyValidPng(bytes: Uint8Array): boolean {
  if (
    bytes.length < 45 ||
    !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
  ) {
    return false;
  }

  let position: number = PNG_SIGNATURE.length;
  let chunkIndex = 0;
  let hasImageData = false;

  while (position + 12 <= bytes.length) {
    const dataLength = readUint32(bytes, position);
    const type = chunkType(bytes, position + 4);
    const chunkEnd = position + 12 + dataLength;

    if (
      !/^[A-Za-z]{4}$/.test(type) ||
      dataLength > MAX_LOGO_BYTES ||
      chunkEnd > bytes.length
    ) {
      return false;
    }

    if (chunkIndex === 0) {
      if (
        type !== "IHDR" ||
        dataLength !== 13 ||
        readUint32(bytes, position + 8) === 0 ||
        readUint32(bytes, position + 12) === 0
      ) {
        return false;
      }

      const compressionMethod = bytes[position + 18];
      const filterMethod = bytes[position + 19];
      const interlaceMethod = bytes[position + 20];
      const bitDepth = bytes[position + 16];
      const colorType = bytes[position + 17];
      const validBitDepth =
        (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth)) ||
        (colorType === 2 && [8, 16].includes(bitDepth)) ||
        (colorType === 3 && [1, 2, 4, 8].includes(bitDepth)) ||
        ((colorType === 4 || colorType === 6) && [8, 16].includes(bitDepth));
      if (
        !validBitDepth ||
        compressionMethod !== 0 ||
        filterMethod !== 0 ||
        (interlaceMethod !== 0 && interlaceMethod !== 1)
      ) {
        return false;
      }
    }

    if (type === "IHDR" && chunkIndex !== 0) {
      return false;
    }
    if (type === "IDAT" && dataLength > 0) {
      hasImageData = true;
    }
    if (type === "IEND") {
      return dataLength === 0 && hasImageData && chunkEnd === bytes.length;
    }

    position = chunkEnd;
    chunkIndex += 1;
  }

  return false;
}

function isStructurallyValidJpeg(bytes: Uint8Array): boolean {
  if (
    bytes.length < 16 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  ) {
    return false;
  }

  let position = 2;
  let hasStartOfFrame = false;

  while (position < bytes.length - 2) {
    if (bytes[position] !== 0xff) {
      return false;
    }
    while (bytes[position] === 0xff) {
      position += 1;
    }

    const marker = bytes[position];
    position += 1;

    if (marker === 0xda) {
      return hasStartOfFrame;
    }
    if (
      marker === 0x00 ||
      marker === 0xd8 ||
      marker === 0xd9 ||
      position + 2 > bytes.length
    ) {
      return false;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    const segmentLength = bytes[position] * 256 + bytes[position + 1];
    if (segmentLength < 2 || position + segmentLength > bytes.length) {
      return false;
    }

    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 8) {
        return false;
      }
      const height = bytes[position + 3] * 256 + bytes[position + 4];
      const width = bytes[position + 5] * 256 + bytes[position + 6];
      if (width === 0 || height === 0) {
        return false;
      }
      hasStartOfFrame = true;
    }

    position += segmentLength;
  }

  return false;
}

function removeSvgComments(source: string): string | null {
  const withoutComments = source.replace(/<!--[\s\S]*?-->/g, "");
  return withoutComments.includes("<!--") || withoutComments.includes("-->")
    ? null
    : withoutComments;
}

function hasOnlyLocalSvgReferences(source: string): boolean {
  const hrefTokens = source.match(/\b(?:xlink:)?href\s*=/gi) ?? [];
  const hrefs = [...source.matchAll(/\b(?:xlink:)?href\s*=\s*(["'])(.*?)\1/gi)];
  if (
    hrefTokens.length !== hrefs.length ||
    hrefs.some((match) => !/^#[A-Za-z_][\w:.-]*$/.test(match[2].trim()))
  ) {
    return false;
  }

  const urlTokens = source.match(/\burl\s*\(/gi) ?? [];
  const urls = [...source.matchAll(/\burl\s*\(\s*(["']?)(.*?)\1\s*\)/gi)];
  if (
    urlTokens.length !== urls.length ||
    urls.some((match) => !/^#[A-Za-z_][\w:.-]*$/.test(match[2].trim()))
  ) {
    return false;
  }

  const referenceAttributes = [
    ...source.matchAll(
      /\b(?:action|formaction|poster|src)\s*=\s*(["'])(.*?)\1/gi,
    ),
  ];
  const referenceTokens =
    source.match(/\b(?:action|formaction|poster|src)\s*=/gi) ?? [];
  return (
    referenceTokens.length === referenceAttributes.length &&
    !referenceAttributes.some(
      (match) => !/^#[A-Za-z_][\w:.-]*$/.test(match[2].trim()),
    )
  );
}

function hasValidSvgRoot(source: string): boolean {
  const explicitlyClosed = /^<svg(?:\s|>)[\s\S]*<\/svg>\s*$/i.test(source);
  const selfClosing = /^<svg(?:\s[^>]*)?\/>\s*$/i.test(source);
  return explicitlyClosed || selfClosing;
}

function isSafeSvg(bytes: Uint8Array): boolean {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }

  if (
    source.includes("\0") ||
    source.includes("&") ||
    /<!\s*(?:doctype|entity)\b/i.test(source) ||
    /\bxml:base\s*=/i.test(source) ||
    SVG_ACTIVE_ELEMENT_PATTERN.test(source) ||
    SVG_EVENT_HANDLER_PATTERN.test(source) ||
    /(?:@import|expression\s*\()/i.test(source)
  ) {
    return false;
  }

  const withoutComments = removeSvgComments(source);
  if (!withoutComments) {
    return false;
  }

  const normalized = withoutComments
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^<\?xml(?:\s[^?]*)?\?>\s*/i, "");

  if (
    normalized.includes("<?") ||
    !hasValidSvgRoot(normalized) ||
    !hasOnlyLocalSvgReferences(normalized)
  ) {
    return false;
  }

  return true;
}

function validateLogoBytes(contentType: string, bytes: Uint8Array): void {
  const valid =
    (contentType === "image/png" && isStructurallyValidPng(bytes)) ||
    (contentType === "image/jpeg" && isStructurallyValidJpeg(bytes)) ||
    (contentType === "image/svg+xml" && isSafeSvg(bytes));

  if (!valid) {
    throw validationError(
      "El contenido del archivo no es un PNG, JPEG o SVG seguro y válido.",
    );
  }
}

async function privateBucket(): Promise<PrivateBucket> {
  const { env } = await getCloudflareContext({ async: true });
  const bucket = (
    env as CloudflareEnv & {
      STORAGE_BUCKET?: PrivateBucket;
    }
  ).STORAGE_BUCKET;

  if (!bucket) {
    throw new Error("STORAGE_BUCKET no está configurado.");
  }
  return bucket;
}

async function loadCompanyLogo(
  database: Database,
  context: CompanyContext,
): Promise<CompanyLogoRow> {
  const [company] = await database
    .select({ id: companies.id, logoKey: companies.logoKey })
    .from(companies)
    .where(
      and(
        eq(companies.id, context.companyId),
        eq(companies.userId, context.userId),
      ),
    )
    .limit(1);

  if (!company) {
    throw new ResourceNotFoundError();
  }
  return company;
}

function expectedLogoKeyCondition(logoKey: string | null) {
  return logoKey === null
    ? isNull(companies.logoKey)
    : eq(companies.logoKey, logoKey);
}

async function compareAndSwapLogo(
  database: Database,
  context: CompanyContext,
  expectedLogoKey: string | null,
  nextLogoKey: string | null,
): Promise<boolean> {
  const [updated] = await database
    .update(companies)
    .set({ logoKey: nextLogoKey, updatedAt: new Date() })
    .where(
      and(
        eq(companies.id, context.companyId),
        eq(companies.userId, context.userId),
        expectedLogoKeyCondition(expectedLogoKey),
      ),
    )
    .returning({ id: companies.id });

  return Boolean(updated);
}

function isCompanyScopedLogoKey(companyId: string, key: string): boolean {
  const prefix = `companies/${companyId}/logos/`;
  return key.startsWith(prefix) && !key.includes("..");
}

async function deleteCompanyObject(
  bucket: PrivateBucket,
  companyId: string,
  key: string,
  requestId: string,
  event: string,
): Promise<void> {
  if (!isCompanyScopedLogoKey(companyId, key)) {
    logSafe("warn", `${event}.scope_rejected`, {
      request_id: requestId,
    });
    return;
  }

  try {
    await bucket.delete(key);
  } catch (error) {
    logSafe("warn", `${event}.r2_cleanup_failed`, {
      request_id: requestId,
      error_type: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

async function persistReplacement(
  database: Database,
  context: CompanyContext,
  initialLogoKey: string | null,
  newLogoKey: string,
): Promise<string | null> {
  let previousLogoKey = initialLogoKey;

  for (let attempt = 0; attempt < MAX_REPLACEMENT_ATTEMPTS; attempt += 1) {
    if (
      await compareAndSwapLogo(database, context, previousLogoKey, newLogoKey)
    ) {
      return previousLogoKey;
    }
    previousLogoKey = (await loadCompanyLogo(database, context)).logoKey;
  }

  throw new ApiError(
    "conflict",
    409,
    "El logotipo ha cambiado durante la actualización. Inténtalo de nuevo.",
  );
}

function routeErrorResponse(
  error: unknown,
  requestId: string,
  propagatedRequestId?: string,
): Response {
  const apiError = toApiError(error);
  logSafe(apiError.status >= 500 ? "error" : "warn", "company.logo_failed", {
    request_id: requestId,
    error_code: apiError.code,
    error_type: error instanceof Error ? error.name : "UnknownError",
  });

  return withRequestId(
    apiErrorResponse(apiError, propagatedRequestId),
    requestId,
  );
}

export async function PUT(request: Request): Promise<Response> {
  const { requestId, propagatedRequestId } = requestIdFrom(request);
  let uploadedKey: string | undefined;
  let uploadedKeyCommitted = false;
  let bucket: PrivateBucket | undefined;
  let companyId: string | undefined;

  try {
    assertRequestSize(request);
    const context = await resolveCompanyContext(request);
    companyId = context.companyId;
    const file = await logoFileFrom(request);

    if (!SUPPORTED_CONTENT_TYPES.has(file.type)) {
      throw validationError("El logotipo debe ser PNG, JPEG o SVG.");
    }
    if (file.size === 0) {
      throw validationError("El archivo del logotipo está vacío.");
    }
    if (file.size > MAX_LOGO_BYTES) {
      throw validationError("El logotipo no puede superar 2 MiB.", 413);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_LOGO_BYTES) {
      throw validationError("El logotipo no puede superar 2 MiB.", 413);
    }
    validateLogoBytes(file.type, bytes);

    const database = createDatabase();
    const companyPromise = loadCompanyLogo(database, context);
    const bucketPromise = privateBucket();
    const [company, resolvedBucket] = await Promise.all([
      companyPromise,
      bucketPromise,
    ]);
    bucket = resolvedBucket;
    uploadedKey = await storeCompanyLogo(
      bucket,
      context.companyId,
      bytes,
      file.type,
    );
    const replacedKey = await persistReplacement(
      database,
      context,
      company.logoKey,
      uploadedKey,
    );
    uploadedKeyCommitted = true;

    if (replacedKey && replacedKey !== uploadedKey) {
      await deleteCompanyObject(
        bucket,
        context.companyId,
        replacedKey,
        requestId,
        "company.logo_replace",
      );
    }

    logSafe("info", "company.logo_uploaded", {
      request_id: requestId,
      content_type: file.type,
      byte_length: bytes.byteLength,
    });
    return withRequestId(Response.json({ logo_key: uploadedKey }), requestId);
  } catch (error) {
    if (bucket && uploadedKey && companyId && !uploadedKeyCommitted) {
      await deleteCompanyObject(
        bucket,
        companyId,
        uploadedKey,
        requestId,
        "company.logo_rollback",
      );
    }
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const { requestId, propagatedRequestId } = requestIdFrom(request);

  try {
    const context = await resolveCompanyContext(request);
    const database = createDatabase();

    for (let attempt = 0; attempt < MAX_REPLACEMENT_ATTEMPTS; attempt += 1) {
      const company = await loadCompanyLogo(database, context);
      if (!company.logoKey) {
        return withRequestId(new Response(null, { status: 204 }), requestId);
      }

      const bucket = await privateBucket();
      if (await compareAndSwapLogo(database, context, company.logoKey, null)) {
        await deleteCompanyObject(
          bucket,
          context.companyId,
          company.logoKey,
          requestId,
          "company.logo_delete",
        );
        logSafe("info", "company.logo_deleted", {
          request_id: requestId,
        });
        return withRequestId(new Response(null, { status: 204 }), requestId);
      }
    }

    throw new ApiError(
      "conflict",
      409,
      "El logotipo ha cambiado durante el borrado. Inténtalo de nuevo.",
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}
