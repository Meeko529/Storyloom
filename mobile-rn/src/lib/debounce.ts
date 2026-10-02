/**
 * 去抖与节流。
 *
 * 自动保存要的是「停止输入后存一次」，用去抖；但去抖有个必须处理的场合 ——
 * 用户切后台、关页面、失焦时不能等那段时间，必须立刻把待存的执行掉，
 * 所以这里返回的函数带 `flush` / `cancel`。
 */

type Debounced<T extends unknown[]> = ((...args: T) => void) & {
  /** 立刻执行挂起的调用（若有），并清掉挂起状态。 */
  flush: () => void;
  /** 丢弃挂起的调用，不再执行。 */
  cancel: () => void;
  /** 是否还有挂起未执行的调用。 */
  pending: () => boolean;
};

/**
 * 去抖：连续调用时只执行最后一次，等待 `wait` 毫秒无新调用后执行。
 *
 * `pending()` 供「卸载前还有没落盘的东西」这类判断用；带这个方法后
 * 挂起的参数也需要被记住，所以内部多存一份 `lastArgs`。
 */
export function debounce<T extends unknown[]>(fn: (...args: T) => void, wait: number): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: T | null = null;

  const run = () => {
    timer = null;
    if (!lastArgs) return;
    const args = lastArgs;
    lastArgs = null;
    fn(...args);
  };

  const debounced = ((...args: T) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, wait);
  }) as Debounced<T>;

  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    run();
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };
  debounced.pending = () => timer !== null;

  return debounced;
}

/**
 * 每帧最多执行一次：第一次调用立刻执行，帧内的后续调用合并到下一帧。
 *
 * 适合"跟着内容变、但不需要每个中间态都处理"的场合（如滚动联动高亮），
 * 它的代价低于去抖，因为它不会把第一次执行也推迟。
 */
export function throttleRAF<T extends unknown[]>(fn: (...args: T) => void): Debounced<T> {
  let frame: number | null = null;
  let lastArgs: T | null = null;

  const run = () => {
    frame = null;
    if (!lastArgs) return;
    const args = lastArgs;
    lastArgs = null;
    fn(...args);
  };

  const throttled = ((...args: T) => {
    lastArgs = args;
    if (frame === null) {
      frame = requestAnimationFrame(run);
    }
  }) as Debounced<T>;

  throttled.flush = () => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    run();
  };
  throttled.cancel = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    lastArgs = null;
  };
  throttled.pending = () => frame !== null;

  return throttled;
}