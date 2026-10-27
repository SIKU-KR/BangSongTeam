import { z } from "zod";
import { IdSchema } from "./id";

/** 다른 탭에 알리는 저장본의 종류. IndexedDB의 프레젠테이션·폴더·보관함 곡 저장소와 짝을 이룬다 */
export const StorageChangeKindSchema = z.enum([
  "presentations",
  "folders",
  "decks",
]);
export type StorageChangeKind = z.infer<typeof StorageChangeKindSchema>;

/**
 * 탭이 IndexedDB에 쓰거나 지운 저장본을 같은 브라우저의 다른 탭에 알리는 메시지(BroadcastChannel
 * `chiton:storage`). 받는 탭은 메시지의 id로 저장본을 다시 읽을 뿐 다른 내용은 믿지 않는다.
 *
 * 다른 배포판의 탭이 보낸 값일 수 있어 이 스키마로 걸러 맞지 않으면 버린다. 모르는 판(`v`)과
 * 종류도 버리므로, 메시지 모양을 바꾸면 `v`를 올려 이전 판의 탭이 잘못 읽지 않게 한다.
 */
export const StorageChangeSchema = z.object({
  v: z.literal(1),
  userId: IdSchema,
  kind: StorageChangeKindSchema,
  ids: z.array(IdSchema),
});
export type StorageChange = z.infer<typeof StorageChangeSchema>;
