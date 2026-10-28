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
 * `pulled`는 저장본이 아니라 보낸 탭이 서버에서 내 데이터를 다시 받았다는 알림이고 `ids`는 비어 있다.
 * 받는 탭은 다시 받기를 그만큼 미룬다.
 *
 * 다른 배포판의 탭이 보낸 값일 수 있어 이 스키마로 걸러 맞지 않으면 버린다. 모르는 판(`v`)과
 * 종류도 버리므로, 메시지 모양을 바꾸면 `v`를 올려 이전 판의 탭이 잘못 읽지 않게 한다. 종류를 더하는
 * 것은 모양을 바꾸는 것이 아니다. 이전 판의 탭은 모르는 종류를 버린다.
 */
export const StorageChangeSchema = z.object({
  v: z.literal(1),
  userId: IdSchema,
  kind: z.union([StorageChangeKindSchema, z.literal("pulled")]),
  ids: z.array(IdSchema),
});
export type StorageChange = z.infer<typeof StorageChangeSchema>;
