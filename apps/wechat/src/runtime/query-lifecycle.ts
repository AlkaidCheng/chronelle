export interface QueryLifecycleTarget {
  setFocused(focused: boolean): void;
  setOnline(online: boolean): void;
}

export interface QueryLifecycleSource {
  getOnline(): Promise<boolean>;
  onHide(listener: () => void): () => void;
  onNetworkChange(listener: (online: boolean) => void): () => void;
  onShow(listener: () => void): () => void;
}

/** Binds Mini Program lifecycle signals to TanStack Query without React state. */
export function bindQueryLifecycle(
  source: QueryLifecycleSource,
  target: QueryLifecycleTarget,
): () => void {
  let active = true;
  const show = () => target.setFocused(true);
  const hide = () => target.setFocused(false);
  const network = (online: boolean) => target.setOnline(online);

  const unsubscribeShow = source.onShow(show);
  const unsubscribeHide = source.onHide(hide);
  const unsubscribeNetwork = source.onNetworkChange(network);
  void source.getOnline().then((online) => {
    if (active) target.setOnline(online);
  });

  return () => {
    active = false;
    unsubscribeShow();
    unsubscribeHide();
    unsubscribeNetwork();
  };
}
