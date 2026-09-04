'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useWebMcp } from './useWebMcp';

export default function DialogIndexApp() {
  const frame = useRef<HTMLIFrameElement>(null);
  const changed = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ type: 'dialog-index:refresh' }, window.location.origin);
  }, []);
  const webmcp = useWebMcp(changed);

  useEffect(() => {
    const notify = () => frame.current?.contentWindow?.postMessage({ type: 'dialog-index:webmcp', status: webmcp }, window.location.origin);
    const receive = (event: MessageEvent) => { if (event.origin === window.location.origin && event.data?.type === 'dialog-index:ui-ready') notify(); };
    window.addEventListener('message', receive);
    notify();
    return () => window.removeEventListener('message', receive);
  }, [webmcp]);

  return <iframe
    ref={frame}
    className="tank-frame"
    src="/dialog_index_tank_verified.html"
    title="Dialog Index"
    onLoad={() => frame.current?.contentWindow?.postMessage({ type: 'dialog-index:webmcp', status: webmcp }, window.location.origin)}
  />;
}
