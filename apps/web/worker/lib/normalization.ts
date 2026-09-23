import {
  buildNormalizationMessages,
  extractModelText,
  isPlausiblyComplete,
  pickPopularRoot,
  suggestMaxTokens,
  verifyNormalization,
  type NormalizationMessage,
} from "@repo/shared";
import { applyCanonical, getNormalizationInput } from "@repo/db";

/**
 * 가사 정규화 모델 (PRD 7.1). 고정이다 — 바꾸면 정규화 품질을 다시 검증해야 한다.
 */
export const NORMALIZATION_MODEL = "@cf/qwen/qwen3.8-27b" as const;

export interface ModelOutput {
  text: string;
  /** `length`면 출력이 잘렸다 */
  finishReason: string | null;
}

/** 모델 호출. 테스트에서는 가짜로 바꾼다 */
export type ModelRunner = (input: {
  messages: NormalizationMessage[];
  maxTokens: number;
}) => Promise<ModelOutput>;

/**
 * Workers AI 바인딩으로 모델을 부른다.
 *
 * - `temperature: 0` — 같은 입력에 같은 대표 가사
 * - `chat_template_kwargs.enable_thinking: false` — 사고 모드 끔 (TECH_SPEC §6.2).
 *   모델 템플릿이 이를 무시해도 `extractModelText`가 `<think>`를 걷어낸다
 * - `gatewayId`가 있으면 AI Gateway를 거친다 — 호출 로그·요청 제한·월 비용 상한
 *   (PRD 9장 LLM 호출 비용). 상한에 닿아 호출이 실패하면 최다 등록 버전으로 떨어진다
 */
export function createWorkersAiRunner(ai: Ai, gatewayId?: string): ModelRunner {
  return async ({ messages, maxTokens }) => {
    const result = await ai.run(
      NORMALIZATION_MODEL,
      {
        messages,
        temperature: 0,
        max_tokens: maxTokens,
        chat_template_kwargs: { enable_thinking: false },
      },
      gatewayId ? { gateway: { id: gatewayId } } : undefined,
    );

    const choice = result?.choices?.[0];
    // 일부 Workers AI 모델은 OpenAI 호환 형식 대신 `{ response }`를 준다
    const legacy = (result as unknown as { response?: unknown })?.response;
    return {
      text:
        typeof choice?.message?.content === "string"
          ? choice.message.content
          : typeof legacy === "string"
            ? legacy
            : "",
      finishReason: choice?.finish_reason ?? null,
    };
  };
}

export type NormalizationOutcome =
  /** LLM 결과가 검증을 통과해 대표 가사가 됐다 */
  | { kind: "llm" }
  /** LLM 결과를 버리고 최다 등록 버전을 썼다 */
  | { kind: "popular_root"; reason: string }
  | { kind: "skipped_locked" }
  | { kind: "skipped_single" }
  /** 모델을 기다리는 사이 새 버전이 들어와 쓰지 않았다 (다음 정규화가 맡는다) */
  | { kind: "stale" }
  | { kind: "missing" };

/**
 * 한 곡의 루트 버전들로 대표 가사를 만든다 (PRD 4.8, TECH_SPEC §6.1).
 *
 * 1. 잠긴 곡·버전 1개인 곡은 건너뛴다
 * 2. 모델로 후보를 만든다
 * 3. 후보의 모든 줄이 입력 버전에 있는지(`verifyNormalization`), 곡을 거의 다
 *    담았는지(`isPlausiblyComplete`) 확인한다
 * 4. 하나라도 어긋나거나 모델 호출이 실패하면 LLM 출력을 버리고 최다 등록 버전을 쓴다
 */
export async function normalizeCatalog(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  catalogId: string,
  runner: ModelRunner,
): Promise<NormalizationOutcome> {
  const input = await getNormalizationInput(db, catalogId);
  if (!input) return { kind: "missing" };
  if (input.catalog.status === "locked") return { kind: "skipped_locked" };
  if (input.versions.length < 2) return { kind: "skipped_single" };

  const lyrics = input.versions.map((v) => v.lyrics);

  let candidate: string | null = null;
  let rejection = "";
  try {
    const output = await runner({
      messages: buildNormalizationMessages(lyrics),
      maxTokens: suggestMaxTokens(lyrics),
    });
    const text = extractModelText(output.text);

    if (output.finishReason === "length") rejection = "output truncated";
    else if (!text) rejection = "empty output";
    else if (!verifyNormalization(text, lyrics))
      rejection = "hallucinated line";
    else if (!isPlausiblyComplete(text, lyrics))
      rejection = "incomplete output";
    else candidate = text;
  } catch (err) {
    rejection = `model error: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (candidate) {
    const wrote = await applyCanonical(db, catalogId, {
      canonical: candidate,
      source: "llm",
      expected: input.revision,
    });
    return wrote ? { kind: "llm" } : { kind: "stale" };
  }

  const fallback = pickPopularRoot(input.versions);
  if (!fallback) return { kind: "missing" };
  const wrote = await applyCanonical(db, catalogId, {
    canonical: fallback,
    source: "popular_root",
    expected: input.revision,
  });
  return wrote
    ? { kind: "popular_root", reason: rejection }
    : { kind: "stale" };
}
