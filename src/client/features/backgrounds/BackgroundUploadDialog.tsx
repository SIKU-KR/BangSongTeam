import React, { useEffect, useState } from "react";
import {
  BACKGROUND_TAGS,
  BACKGROUND_UPLOAD_LIMITS,
  type BackgroundStorageUsage,
} from "#shared";
import { useUploadBackground } from "../../lib/api/backgroundQueries";
import { describeApiError } from "../../lib/api/request";
import {
  checkBackgroundFile,
  formatBytes,
  probeBackgroundFile,
  type ProbedBackgroundFile,
} from "./probeBackgroundFile";

export interface BackgroundUploadDialogProps {
  isOpen: boolean;
  usage: BackgroundStorageUsage | null;
  onClose: () => void;
}

const ACCEPT = "video/mp4,image/jpeg,image/png,image/webp";

type Selection =
  | { status: "empty" }
  | { status: "probing"; file: File }
  | { status: "ready"; file: File; probed: ProbedBackgroundFile }
  | { status: "invalid"; message: string };

function titleFromFileName(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .slice(0, BACKGROUND_UPLOAD_LIMITS.maxTitleLength);
}

function useObjectUrl(file: File | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!file) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

/**
 * 커스텀 배경 올리기.
 *
 * 브라우저에서 먼저 열어 보고(재생 가능 여부·해상도·길이, 영상은 포스터 생성) 권리
 * 확인 동의를 받은 뒤에만 올린다.
 */
export function BackgroundUploadDialog({
  isOpen,
  usage,
  onClose,
}: BackgroundUploadDialogProps): React.JSX.Element | null {
  const [selection, setSelection] = useState<Selection>({ status: "empty" });
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [acceptedRights, setAcceptedRights] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const upload = useUploadBackground();

  const previewFile =
    selection.status === "ready"
      ? (selection.probed.poster ?? selection.file)
      : undefined;
  const previewUrl = useObjectUrl(previewFile);

  if (!isOpen) return null;

  const reset = (): void => {
    setSelection({ status: "empty" });
    setTitle("");
    setTags([]);
    setAcceptedRights(false);
    upload.reset();
  };

  const close = (): void => {
    if (upload.isPending) return;
    reset();
    onClose();
  };

  const selectFile = async (file: File): Promise<void> => {
    upload.reset();
    const problem = checkBackgroundFile(file, usage);
    if (problem) {
      setSelection({ status: "invalid", message: problem });
      return;
    }
    setSelection({ status: "probing", file });
    setTitle((current) => current || titleFromFileName(file.name));
    try {
      const probed = await probeBackgroundFile(file);
      const posterBytes = probed.poster?.size ?? 0;
      const posterProblem =
        usage && usage.usedBytes + file.size + posterBytes > usage.limitBytes
          ? "저장 공간이 부족합니다. 쓰지 않는 배경을 지운 뒤 다시 올려 주세요"
          : null;
      setSelection(
        posterProblem
          ? { status: "invalid", message: posterProblem }
          : { status: "ready", file, probed },
      );
    } catch (err) {
      setSelection({
        status: "invalid",
        message: err instanceof Error ? err.message : "파일을 열 수 없습니다",
      });
    }
  };

  const toggleTag = (tag: string): void => {
    setTags((current) =>
      current.includes(tag)
        ? current.filter((t) => t !== tag)
        : [...current, tag],
    );
  };

  const canSubmit =
    selection.status === "ready" &&
    title.trim().length > 0 &&
    acceptedRights &&
    !upload.isPending;

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!canSubmit || selection.status !== "ready") return;
    try {
      await upload.mutateAsync({
        file: selection.file,
        poster: selection.probed.poster,
        title: title.trim(),
        tags,
        durationSec: selection.probed.durationSec,
      });
      reset();
      onClose();
    } catch (error) {
      void error;
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bg-upload-title"
      data-testid="bg-upload-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
    >
      <form
        onSubmit={(e) => void submit(e)}
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 shadow-xl dark:shadow-2xl space-y-5 text-zinc-900 dark:text-zinc-100"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="bg-upload-title" className="text-base font-bold">
              내 배경 올리기
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              MP4(H.264) 영상이나 JPEG·PNG·WebP 이미지, 파일당{" "}
              {formatBytes(BACKGROUND_UPLOAD_LIMITS.maxFileBytes)}까지. 올린
              배경은 나만 쓸 수 있습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="닫기"
            className="p-1 rounded-lg text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800 cursor-pointer"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) void selectFile(file);
          }}
          className={`block rounded-xl border-2 border-dashed overflow-hidden cursor-pointer transition-colors ${
            isDragging
              ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30"
              : "border-zinc-300 dark:border-zinc-700 hover:border-emerald-500/60"
          }`}
        >
          <input
            type="file"
            accept={ACCEPT}
            data-testid="bg-upload-file-input"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void selectFile(file);
              e.target.value = "";
            }}
          />
          {selection.status === "ready" && previewUrl ? (
            <div className="relative aspect-video bg-black">
              <img
                src={previewUrl}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
              />
              <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/70 text-[11px] text-zinc-100 font-mono">
                {selection.probed.width}×{selection.probed.height}
                {selection.probed.kind === "video"
                  ? ` · ${selection.probed.durationSec}초`
                  : " · 이미지"}
                {` · ${formatBytes(selection.file.size)}`}
              </span>
              <span className="absolute top-2 right-2 px-2 py-0.5 rounded bg-black/70 text-[11px] text-zinc-100">
                다른 파일 고르기
              </span>
            </div>
          ) : (
            <div className="py-10 px-4 flex flex-col items-center gap-2 text-center">
              <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                {selection.status === "probing"
                  ? "파일을 확인하는 중…"
                  : "여기로 끌어 놓거나 눌러서 파일 고르기"}
              </span>
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                권장 해상도 {BACKGROUND_UPLOAD_LIMITS.recommendedWidth}×
                {BACKGROUND_UPLOAD_LIMITS.recommendedHeight} · 영상 소리는
                송출에서 항상 꺼집니다
              </span>
            </div>
          )}
        </label>

        {selection.status === "invalid" && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {selection.message}
          </p>
        )}
        {selection.status === "ready" && selection.probed.isLowResolution && (
          <p
            data-testid="bg-upload-low-res"
            className="text-xs text-amber-700 dark:text-amber-400"
          >
            {BACKGROUND_UPLOAD_LIMITS.recommendedWidth}×
            {BACKGROUND_UPLOAD_LIMITS.recommendedHeight}보다 작습니다. 올릴 수는
            있지만 송출 화면에서 확대되어 흐려 보일 수 있습니다.
          </p>
        )}

        <div>
          <label
            htmlFor="bg-upload-title-input"
            className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1"
          >
            배경 제목
          </label>
          <input
            id="bg-upload-title-input"
            type="text"
            value={title}
            maxLength={BACKGROUND_UPLOAD_LIMITS.maxTitleLength}
            placeholder="예: 본당 성탄 배경"
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 focus:border-emerald-500 rounded-xl px-3.5 py-2 text-xs focus:outline-none"
          />
        </div>

        <div>
          <span className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
            분위기 태그 (선택)
          </span>
          <div className="flex flex-wrap gap-1.5">
            {BACKGROUND_TAGS.map((tag) => {
              const active = tags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleTag(tag)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors ${
                    active
                      ? "bg-emerald-600 text-white"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex items-start gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            data-testid="bg-upload-rights-checkbox"
            checked={acceptedRights}
            onChange={(e) => setAcceptedRights(e.target.checked)}
            className="mt-0.5 accent-emerald-600"
          />
          <span>
            <span className="font-semibold">
              내가 권리를 가졌거나 사용 허락을 받은 파일입니다.
            </span>{" "}
            권리 침해 신고가 들어오면 운영자가 내릴 수 있습니다.
          </span>
        </label>

        {upload.error && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {describeApiError(upload.error)}
          </p>
        )}

        <div className="flex items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            onClick={close}
            disabled={upload.isPending}
            className="px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 cursor-pointer disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="submit"
            data-testid="bg-upload-submit"
            disabled={!canSubmit}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {upload.isPending ? "올리는 중…" : "올리기"}
          </button>
        </div>
      </form>
    </div>
  );
}
