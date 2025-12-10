/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Sentry from "@sentry/nextjs";

/**
 * safeFetch - JSON.parse 실패, API 오류 등을 자동으로 Sentry로 보고하는 fetch wrapper
 */
export async function safeFetch<T = any>(
  url: string,
  options?: RequestInit
): Promise<T> {
  let res: Response | null = null;

  try {
    res = await fetch(url, options);
  } catch (networkError: any) {
    // 네트워크 에러 (DNS, CORS, 타임아웃 등)
    Sentry.captureException(networkError, {
      extra: {
        url,
        options,
        type: "network-error",
      },
    });
    throw networkError;
  }

  const text = await res.text();

  // HTTP error status (400, 500 등)
  if (!res.ok) {
    const error = new Error(`HTTP ${res.status} for ${url}`);

    Sentry.captureException(error, {
      extra: {
        url,
        status: res.status,
        responseSnippet: text.slice(0, 500),
        options,
        type: "http-error",
      },
    });

    throw error;
  }

  try {
    return JSON.parse(text) as Promise<T>;
  } catch (parseError) {
    Sentry.captureException(parseError, {
      extra: {
        url,
        status: res.status,
        responseSnippet: text.slice(0, 500),
        options,
        type: "json-parse-error",
      },
    });
    throw parseError;
  }
}
