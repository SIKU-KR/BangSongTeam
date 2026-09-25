import React, { useEffect, useState } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { cn } from "cn";
import { Alert, AlertDescription } from "#components/ui/alert";
import { Button } from "#components/ui/button";
import { Checkbox } from "#components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#components/ui/dialog";
import { Input } from "#components/ui/input";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "#components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "#components/ui/toggle-group";
import { BACKGROUND_TAGS, BACKGROUND_UPLOAD_LIMITS } from "#shared";
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
 * 관리자 배경 올리기. 올린 배경은 곧바로 모든 사용자의 기본 제공 배경이 된다.
 *
 * 브라우저에서 먼저 열어 보고(재생 가능 여부·해상도·길이, 영상은 포스터 생성)
 * 출처·라이선스를 적고 재배포 가능 여부를 확인한 뒤에만 올린다.
 */
export function BackgroundUploadDialog({
  isOpen,
  onClose,
}: BackgroundUploadDialogProps): React.JSX.Element | null {
  const [selection, setSelection] = useState<Selection>({ status: "empty" });
  const [title, setTitle] = useState("");
  const [license, setLicense] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [acceptedRights, setAcceptedRights] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const upload = useUploadBackground();

  const previewFile =
    selection.status === "ready"
      ? (selection.probed.poster ?? selection.file)
      : undefined;
  const previewUrl = useObjectUrl(previewFile);

  const reset = (): void => {
    setSelection({ status: "empty" });
    setTitle("");
    setLicense("");
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
    const problem = checkBackgroundFile(file);
    if (problem) {
      setSelection({ status: "invalid", message: problem });
      return;
    }
    setSelection({ status: "probing", file });
    setTitle((current) => current || titleFromFileName(file.name));
    try {
      const probed = await probeBackgroundFile(file);
      setSelection({ status: "ready", file, probed });
    } catch (err) {
      setSelection({
        status: "invalid",
        message: err instanceof Error ? err.message : "파일을 열 수 없습니다",
      });
    }
  };

  const canSubmit =
    selection.status === "ready" &&
    title.trim().length > 0 &&
    license.trim().length > 0 &&
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
        license: license.trim(),
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
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        data-testid="bg-upload-dialog"
        className="max-h-9/10 overflow-y-auto sm:max-w-lg"
      >
        <form onSubmit={(e) => void submit(e)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>배경 올리기</DialogTitle>
            <DialogDescription className="text-xs">
              MP4(H.264) 영상이나 JPEG·PNG·WebP 이미지, 파일당{" "}
              {formatBytes(BACKGROUND_UPLOAD_LIMITS.maxFileBytes)}까지. 올린
              배경은 모든 사용자에게 기본 제공 배경으로 보입니다.
            </DialogDescription>
          </DialogHeader>

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
            className={cn(
              "block cursor-pointer overflow-hidden rounded-xl border-2 border-dashed transition-colors",
              isDragging ? "border-primary bg-accent" : "hover:border-ring",
            )}
          >
            <Input
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
                  className="absolute inset-0 size-full object-cover"
                />
                <span className="absolute bottom-2 left-2 rounded-sm bg-black/70 px-2 py-0.5 font-mono text-2xs text-white">
                  {selection.probed.width}×{selection.probed.height}
                  {selection.probed.kind === "video"
                    ? ` · ${selection.probed.durationSec}초`
                    : " · 이미지"}
                  {` · ${formatBytes(selection.file.size)}`}
                </span>
                <span className="absolute top-2 right-2 rounded-sm bg-black/70 px-2 py-0.5 text-2xs text-white">
                  다른 파일 고르기
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <span className="text-sm font-semibold">
                  {selection.status === "probing"
                    ? "파일을 확인하는 중…"
                    : "여기로 끌어 놓거나 눌러서 파일 고르기"}
                </span>
                <span className="text-2xs text-muted-foreground">
                  권장 해상도 {BACKGROUND_UPLOAD_LIMITS.recommendedWidth}×
                  {BACKGROUND_UPLOAD_LIMITS.recommendedHeight} · 영상 소리는
                  송출에서 항상 꺼집니다
                </span>
              </div>
            )}
          </label>

          {selection.status === "invalid" && (
            <FieldError>{selection.message}</FieldError>
          )}
          {selection.status === "ready" && selection.probed.isLowResolution && (
            <Alert data-testid="bg-upload-low-res">
              <TriangleAlertIcon />
              <AlertDescription>
                {BACKGROUND_UPLOAD_LIMITS.recommendedWidth}×
                {BACKGROUND_UPLOAD_LIMITS.recommendedHeight}보다 작습니다. 올릴
                수는 있지만 송출 화면에서 확대되어 흐려 보일 수 있습니다.
              </AlertDescription>
            </Alert>
          )}

          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="bg-upload-title-input">배경 제목</FieldLabel>
              <Input
                id="bg-upload-title-input"
                type="text"
                value={title}
                maxLength={BACKGROUND_UPLOAD_LIMITS.maxTitleLength}
                placeholder="예: 본당 성탄 배경"
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="bg-upload-license-input">
                출처·라이선스
              </FieldLabel>
              <Input
                id="bg-upload-license-input"
                type="text"
                data-testid="bg-upload-license-input"
                value={license}
                maxLength={BACKGROUND_UPLOAD_LIMITS.maxLicenseLength}
                placeholder="예: Pexels License — 작가명, 자체 제작 (CC0)"
                onChange={(e) => setLicense(e.target.value)}
              />
            </Field>

            <FieldSet>
              <FieldLegend variant="label">분위기 태그 (선택)</FieldLegend>
              <ToggleGroup
                multiple
                variant="outline"
                size="sm"
                value={tags}
                onValueChange={(next) => setTags(next)}
                className="flex-wrap"
              >
                {BACKGROUND_TAGS.map((tag) => (
                  <ToggleGroupItem key={tag} value={tag}>
                    {tag}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </FieldSet>

            <Field orientation="horizontal">
              <Checkbox
                id="bg-upload-rights"
                data-testid="bg-upload-rights-checkbox"
                checked={acceptedRights}
                onCheckedChange={(checked) => setAcceptedRights(checked)}
              />
              <FieldContent>
                <FieldLabel htmlFor="bg-upload-rights">
                  모든 사용자에게 배포해도 되는 라이선스를 확인했습니다
                </FieldLabel>
                <FieldDescription>
                  확인되지 않은 파일은 올리지 않습니다.
                </FieldDescription>
              </FieldContent>
            </Field>
          </FieldGroup>

          {upload.error && (
            <FieldError>{describeApiError(upload.error)}</FieldError>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={close}
              disabled={upload.isPending}
            >
              취소
            </Button>
            <Button
              type="submit"
              data-testid="bg-upload-submit"
              disabled={!canSubmit}
            >
              {upload.isPending ? "올리는 중…" : "올리기"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
