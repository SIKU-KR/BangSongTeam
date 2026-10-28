import { MouseSensor, useSensor, useSensors } from "@dnd-kit/core";
import {
  LongPressDragSensor,
  type LongPressDragOptions,
} from "./longPressDragSensor";

// useSensor는 옵션 객체가 바뀌면 센서를 새로 만들고, 그러면 끌기·놓기 내부 컨텍스트가 바뀌어 모든 행과
// 썸네일이 다시 그려진다. 드라이브 공급자는 검색어를 칠 때마다, 썸네일 창은 가사를 고칠 때마다 다시
// 그려지므로 옵션을 렌더 밖에 둔다.
// @dnd-kit/core@6.3.1 dist/core.esm.js (`useSensor`, `useCombineActivators`)
const MOUSE_SENSOR_OPTIONS = { activationConstraint: { distance: 5 } };
const TOUCH_SENSOR_OPTIONS: LongPressDragOptions = {
  delay: 250,
  tolerance: 5,
  distance: 10,
};

/**
 * 드라이브 목록과 슬라이드 썸네일 창이 함께 쓰는 끌기 센서.
 *
 * 마우스(펜 포함)는 5px 움직이면 끌기가 시작된다. 터치는 0.25초 눌러 둔 채 10px 넘게 움직여야
 * 시작한다(`LongPressDragSensor`). 포인터 센서는 터치로 5px만 움직여도 끌기를 시작해, 목록을 쓸어
 * 스크롤하는 손가락 밑의 항목이 골라지고 끌려 다닌다. 움직이지 않고 계속 누르면 끌기 대신 항목의 길게
 * 누르기 메뉴가 열린다.
 *
 * `touch`를 끄면 마우스로만 끈다.
 */
export function useDragSensors({
  touch = true,
}: { touch?: boolean } = {}): ReturnType<typeof useSensors> {
  const mouseSensor = useSensor(MouseSensor, MOUSE_SENSOR_OPTIONS);
  const touchSensor = useSensor(LongPressDragSensor, TOUCH_SENSOR_OPTIONS);
  return useSensors(mouseSensor, touch ? touchSensor : null);
}
