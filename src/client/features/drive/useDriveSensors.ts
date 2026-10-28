import { MouseSensor, useSensor, useSensors } from "@dnd-kit/core";
import {
  LongPressDragSensor,
  type LongPressDragOptions,
} from "./longPressDragSensor";

// useSensor는 옵션 객체가 바뀌면 센서를 새로 만들고, 그러면 끌기·놓기 내부 컨텍스트가 바뀌어 모든 행이
// 다시 그려진다. 검색어를 칠 때마다 이 공급자가 다시 그려지므로 옵션을 렌더 밖에 둔다.
// @dnd-kit/core@6.3.1 dist/core.esm.js (`useSensor`, `useCombineActivators`)
const MOUSE_SENSOR_OPTIONS = { activationConstraint: { distance: 5 } };
const TOUCH_SENSOR_OPTIONS: LongPressDragOptions = {
  delay: 250,
  tolerance: 5,
  distance: 10,
};

/**
 * 드라이브 목록 끌기 센서.
 *
 * 마우스(펜 포함)는 5px 움직이면 끌기가 시작된다. 터치는 0.25초 눌러 둔 채 10px 넘게 움직여야
 * 시작한다(`LongPressDragSensor`). 포인터 센서는 터치로 5px만 움직여도 끌기를 시작해, 목록을 쓸어
 * 스크롤하는 손가락 밑의 행이 골라지고 끌려 다닌다. 움직이지 않고 계속 누르면 끌기 대신 행의 길게
 * 누르기 메뉴가 열린다.
 */
export function useDriveSensors(): ReturnType<typeof useSensors> {
  return useSensors(
    useSensor(MouseSensor, MOUSE_SENSOR_OPTIONS),
    useSensor(LongPressDragSensor, TOUCH_SENSOR_OPTIONS),
  );
}
